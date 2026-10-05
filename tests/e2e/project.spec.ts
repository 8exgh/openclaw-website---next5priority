import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { projectDb, hash } from "../../src/lib/project-store";
import { E2E, mailsTo, resetSite, setSmtpMode } from "./helpers";

// Wait for post-response delivery before the next test resets the shared log.
test.afterEach(async ({ request }) => {
  await request.post("/api/jobs/notify", {
    headers: { "x-claw-key": E2E.clawKey },
  });
});

const editorEmail = "developer@example.test",
  readerEmail = "reader@example.test";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
function db() {
  return projectDb(path.resolve(E2E.dbFile));
}
test.beforeEach(() => {
  resetSite();
  const connection = db();
  for (const table of [
    "project_outbox",
    "item_links",
    "followers",
    "comments",
    "attachments",
    "tasks",
    "user_sessions",
    "login_codes",
    "users",
    "api_keys",
    "events",
  ])
    connection.prepare(`DELETE FROM ${table}`).run();
  connection.prepare("UPDATE project_sequences SET value=0").run();
  for (const [id, email, role, name] of [
    ["owner", E2E.ownerEmail, "admin", "Alex Morgan"],
    ["dev", editorEmail, "edit", "Sam Lee"],
    ["reader", readerEmail, "read", "Taylor Kim"],
  ])
    connection
      .prepare(
        "INSERT INTO users (id,email,role,name,created_at) VALUES (?,?,?,?,?)",
      )
      .run(id, email, role, name, new Date().toISOString());
  connection.close();
});
async function login(page: Page, email = E2E.ownerEmail, entryPath = "/") {
  await page.goto(entryPath);
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect
    .poll(
      () =>
        mailsTo(email).findLast((m) => /login code/.test(m.subject))?.subject,
    )
    .toMatch(/\d{6}/);
  const mail = mailsTo(email).findLast((m) => /login code/.test(m.subject))!;
  await page.getByLabel("Six-digit code").fill(mail.subject.match(/\d{6}/)![0]);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "View" })).toBeVisible();
}
async function sessionHeaders(page: Page) {
  // Chromium accepts Secure cookies on loopback HTTP, while Playwright's
  // separate HTTP client does not. Forward the real login cookie explicitly.
  return {
    Cookie: (await page.context().cookies())
      .map((c) => `${c.name}=${c.value}`)
      .join("; "),
  };
}
async function create(page: Page, data: Record<string, unknown>) {
  const response = await page.request.post("/api/project", {
    headers: await sessionHeaders(page),
    data,
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()).detail.task;
}
const dialog = (page: Page) => page.getByRole("dialog");
const close = (page: Page) =>
  dialog(page).getByRole("button", { name: "Close dialog" }).click();
async function showNextFive(page: Page) {
  await page
    .getByRole("navigation", { name: "View", exact: true })
    .getByRole("button", { name: "List", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "List sections" })
    .getByRole("button", { name: /^Next 5/ })
    .click();
}
async function selectSeverities(page: Page, values: string[]) {
  const group = page.getByRole("group", { name: "Severity", exact: true });
  for (const value of ["P1", "P2", "P3", "P4"])
    await group
      .getByRole("checkbox", { name: value, exact: true })
      .setChecked(values.includes(value));
}
async function showBacklog(
  page: Page,
  ticketClass = "all",
  severities = ["P1", "P2", "P3", "P4"],
) {
  await page
    .getByRole("navigation", { name: "View", exact: true })
    .getByRole("button", { name: "List", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "List sections" })
    .getByRole("button", { name: /^Backlog/ })
    .click();
  await page
    .getByRole("button", { name: "Reset filters", exact: true })
    .click();
  await page
    .getByLabel("Ticket class", { exact: true })
    .selectOption(ticketClass);
  await selectSeverities(page, severities);
}

test("login reports mail failures, retries successfully, and retains a delivered code after a failed resend", async ({
  page,
}) => {
  await page.goto("/bugs/p1-p2");
  await page.getByLabel("Work email").fill(E2E.ownerEmail);
  setSmtpMode("fail");
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "We couldn't send a login code" }),
  ).toBeVisible();
  await expect(page.getByLabel("Work email")).toBeVisible();
  await expect(page.getByLabel("Six-digit code")).toHaveCount(0);
  const codeRow = () => {
    const connection = db();
    try {
      return connection
        .prepare("SELECT code_hash,expires_at FROM login_codes WHERE email=?")
        .get(E2E.ownerEmail);
    } finally {
      connection.close();
    }
  };
  expect(codeRow()).toBeUndefined();
  expect(mailsTo(E2E.ownerEmail)).toHaveLength(0);
  setSmtpMode("ok");
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByLabel("Six-digit code")).toBeVisible();
  const delivered = codeRow();
  expect(delivered).toBeTruthy();
  const mail = mailsTo(E2E.ownerEmail).findLast((message) =>
    /login code/.test(message.subject),
  )!;
  setSmtpMode("fail");
  const response = await page.request.post("/api/auth/request-code", {
    data: { email: E2E.ownerEmail },
  });
  expect(response.status()).toBe(503);
  expect(codeRow()).toEqual(delivered);
  expect(mailsTo(E2E.ownerEmail)).toHaveLength(1);
  setSmtpMode("ok");
  await page.getByLabel("Six-digit code").fill(mail.subject.match(/\d{6}/)![0]);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "View" })).toBeVisible();
  await expect(page).toHaveURL(/\/backlog\?/);
});

test("Next 5 stays separate from Backlog; features reorder and move with capacity enforced on server", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("button", { name: "New feature" }).click();
  await dialog(page)
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Customer dashboard");
  await dialog(page)
    .getByRole("textbox", { name: "Description", exact: true })
    .fill("Show recent activity.\nKeep the layout simple.");
  await dialog(page)
    .getByRole("combobox", { name: "Priority", exact: true })
    .selectOption("P1");
  await dialog(page).getByRole("button", { name: "Create feature" }).click();
  await expect(dialog(page).locator(".detail-toolbar .priority")).toHaveText(
    "P1",
  );
  await dialog(page).getByRole("button", { name: "Edit item" }).click();
  await dialog(page)
    .getByRole("combobox", { name: "Priority", exact: true })
    .selectOption("P2");
  await dialog(page).getByRole("button", { name: "Save changes" }).click();
  await expect(dialog(page).locator(".detail-toolbar .priority")).toHaveText(
    "P2",
  );
  await expect(
    dialog(page).getByText("Show recent activity.\nKeep the layout simple.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    dialog(page).getByRole("textbox", { name: "Description", exact: true }),
  ).toHaveCount(0);
  await close(page);
  const backlog = page.getByRole("region", { name: "Backlog", exact: true });
  await backlog.getByRole("button", { name: "To Next 5" }).click();
  for (let i = 2; i <= 5; i++)
    await create(page, { title: `Feature ${i}`, sectionId: "next-five" });
  const waiting = await create(page, { title: "Waiting feature" });
  const bug = await create(page, {
    title: "Separate bug",
    kind: "bug",
    priority: "P2",
  });
  await page.reload();
  await showNextFive(page);
  const next = page.getByRole("region", { name: "Next 5 features" });
  await expect(
    next.getByLabel("Priority for Customer dashboard", { exact: true }),
  ).toHaveValue("P2");
  await next
    .getByLabel("Priority for Customer dashboard", { exact: true })
    .selectOption("P4");
  await expect(next.getByText("5 / 5")).toBeVisible();
  await expect(page.getByText(bug.title, { exact: true })).toHaveCount(0);
  await expect(
    next.getByRole("button", { name: "Add feature", exact: false }),
  ).toBeDisabled();
  const sixth = await page.request.post("/api/v1/tasks", {
    headers: await sessionHeaders(page),
    data: { title: "Sixth", sectionId: "next-five" },
  });
  expect(sixth.status()).toBe(409);
  const moveFull = await page.request.patch("/api/project", {
    headers: await sessionHeaders(page),
    data: { id: waiting.id, sectionId: "next-five" },
  });
  expect(moveFull.status()).toBe(409);
  await next
    .getByRole("button", { name: "Move Feature 5 up", exact: true })
    .click();
  await expect(next.locator(".task-title")).toHaveText([
    "Customer dashboard",
    "Feature 2",
    "Feature 3",
    "Feature 5",
    "Feature 4",
  ]);
  await next
    .getByRole("button", { name: "To backlog", exact: true })
    .first()
    .click();
  await expect(next.getByText("4 / 5")).toBeVisible();
  await showBacklog(page);
  await backlog
    .locator(".task-row")
    .filter({ hasText: "Waiting feature" })
    .getByRole("button", { name: "To Next 5" })
    .click();
  await showNextFive(page);
  await expect(next.getByText("5 / 5")).toBeVisible();
  await page.reload();
  await expect(next.locator(".task-title")).toHaveText([
    "Feature 2",
    "Feature 3",
    "Feature 5",
    "Feature 4",
    "Waiting feature",
  ]);
  await page.screenshot({
    path: ".playwright/features-desktop.png",
    fullPage: true,
  });
  await showBacklog(page);
  await backlog
    .getByRole("button", { name: "Customer dashboard", exact: true })
    .click();
  await dialog(page).getByRole("button", { name: "Add subtask" }).click();
  await dialog(page)
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Dashboard API");
  await dialog(page)
    .getByRole("combobox", { name: "State", exact: true })
    .selectOption("in_review");
  await dialog(page).getByRole("button", { name: "Create feature" }).click();
  await expect(
    dialog(page).getByRole("heading", { name: "Dashboard API" }),
  ).toBeVisible();
  await close(page);
  await backlog
    .locator(".task-title")
    .filter({ hasText: "Customer dashboard" })
    .click();
  await expect(
    dialog(page).getByLabel("State for Customer dashboard", { exact: true }),
  ).toHaveValue("needs_review");
  await dialog(page)
    .getByLabel("State for Customer dashboard", { exact: true })
    .selectOption("in_qa");
  await expect(
    dialog(page).getByLabel("State for Dashboard API", { exact: true }),
  ).toHaveValue("in_review");
  await dialog(page)
    .getByLabel("State for Dashboard API", { exact: true })
    .selectOption("in_progress");
  await expect(
    dialog(page).getByLabel("State for Dashboard API", { exact: true }),
  ).toHaveValue("in_progress");
  await expect(
    dialog(page).getByLabel("State for Customer dashboard", { exact: true }),
  ).toHaveValue("in_qa");
});

test("bugs support multiline details, assignments, comments, inline images, downloads and causal links", async ({
  page,
}) => {
  await login(page);
  const feature = await create(page, { title: "CSV export" });
  await page.reload();
  await showBacklog(page, "bug", ["P1", "P2"]);
  await page.getByRole("button", { name: "Report a bug" }).click();
  await dialog(page)
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Export loses accents");
  await dialog(page)
    .getByRole("textbox", { name: "Description", exact: true })
    .fill("Export a name with accents.\nExpected: René\nActual: Ren?");
  await dialog(page)
    .getByRole("combobox", { name: "Priority", exact: true })
    .selectOption("P1");
  await dialog(page)
    .getByRole("combobox", { name: "Implementor", exact: true })
    .selectOption("dev");
  await dialog(page)
    .getByRole("combobox", { name: "Reviewer", exact: true })
    .selectOption("reader");
  await dialog(page)
    .getByLabel("Attach files", { exact: true })
    .setInputFiles([
      { name: "reproduction.png", mimeType: "image/png", buffer: png },
    ]);
  await dialog(page).getByRole("button", { name: "Create bug" }).click();
  await expect(
    dialog(page).getByText(/SAV-000001 · BUG TRACKER/),
  ).toBeVisible();
  await expect(
    dialog(page).getByRole("img", { name: "reproduction.png", exact: true }),
  ).toBeVisible();
  expect(
    await dialog(page)
      .getByRole("img", { name: "reproduction.png", exact: true })
      .evaluate(
        (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
      ),
  ).toBeTruthy();
  await dialog(page)
    .getByRole("button", { name: "Edit item", exact: true })
    .click();
  await dialog(page)
    .getByRole("textbox", { name: "Description", exact: true })
    .fill("Updated reproduction\nStill broken on export.");
  await dialog(page)
    .getByRole("combobox", { name: "State", exact: true })
    .selectOption("in_qa");
  await dialog(page).getByRole("button", { name: "Save changes" }).click();
  await expect(
    dialog(page).getByRole("textbox", { name: "Description", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog(page).getByText("Updated reproduction\nStill broken on export.", {
      exact: true,
    }),
  ).toBeVisible();
  await dialog(page)
    .getByRole("textbox", { name: "Add a comment", exact: true })
    .fill("Tested in QA.\nHere is the evidence.");
  await dialog(page)
    .getByLabel("Attach files", { exact: true })
    .setInputFiles([
      { name: "qa.png", mimeType: "image/png", buffer: png },
      {
        name: "sample.html",
        mimeType: "text/html",
        buffer: Buffer.from("<script>alert('untrusted')</script>"),
      },
    ]);
  await dialog(page).getByRole("button", { name: "Post comment" }).click();
  await expect(
    dialog(page).getByRole("img", { name: "qa.png", exact: true }),
  ).toBeVisible();
  await expect(
    dialog(page).getByText("Tested in QA.\nHere is the evidence.", {
      exact: true,
    }),
  ).toBeVisible();
  const href = await dialog(page)
    .getByRole("link", { name: /sample.html/ })
    .getAttribute("href");
  const download = await page.request.get(href!, {
    headers: await sessionHeaders(page),
  });
  expect(download.headers()["content-type"]).toBe("application/octet-stream");
  expect(download.headers()["content-disposition"]).toContain("attachment;");
  expect(download.headers()["x-content-type-options"]).toBe("nosniff");
  expect(await download.text()).toContain("<script>");
  await dialog(page)
    .getByRole("combobox", { name: "Relationship", exact: true })
    .selectOption("caused_by");
  await dialog(page)
    .getByRole("combobox", { name: "Link to item", exact: true })
    .fill("csv exp");
  await dialog(page).getByRole("option", { name: /CSV export/ }).click();
  await dialog(page)
    .getByRole("button", { name: "Add link", exact: true })
    .click();
  await expect(dialog(page).locator(".link-card")).toContainText("Caused by");
  await page.screenshot({
    path: ".playwright/bug-details.png",
    fullPage: true,
  });
  await dialog(page)
    .getByRole("button", { name: "CSV export", exact: true })
    .click();
  await expect(dialog(page).locator(".link-card")).toContainText("Causes");
  await close(page);
  await showBacklog(page, "bug", ["P1", "P2"]);
  await expect(
    page.getByRole("region", { name: "Backlog", exact: true }),
  ).toContainText("Export loses accents");
  await page.getByLabel("Priority for SAV-000001").selectOption("P4");
  await expect(
    page.getByRole("region", { name: "Backlog", exact: true }),
  ).not.toContainText("Export loses accents");
  await expect(page).toHaveURL(/\/backlog\?/);
  await showBacklog(page, "bug", ["P3", "P4"]);
  await expect(
    page.getByRole("region", { name: "Backlog", exact: true }),
  ).toContainText("Export loses accents");
  await page.getByLabel("Priority for SAV-000001").selectOption("P2");
  await expect(
    page.getByRole("region", { name: "Backlog", exact: true }),
  ).not.toContainText("Export loses accents");
  await showBacklog(page, "bug", ["P1", "P2"]);
  await expect(
    page.getByRole("region", { name: "Backlog", exact: true }),
  ).toContainText("Export loses accents");
  const connection = db();
  const attachment = connection
    .prepare(
      "SELECT event_id,storage_name FROM attachments WHERE name='sample.html'",
    )
    .get() as { event_id: string; storage_name: string };
  expect(
    connection
      .prepare("SELECT 1 FROM events WHERE id=?")
      .get(attachment.event_id),
  ).toBeTruthy();
  expect(
    fs.existsSync(
      path.join(
        path.dirname(path.resolve(E2E.dbFile)),
        "assets",
        attachment.event_id,
        attachment.storage_name,
      ),
    ),
  ).toBeTruthy();
  connection.close();
});

// Simulates Ctrl+V of a screenshot: a paste event carrying an image file.
async function pasteImage(page: Page, textbox: string) {
  await dialog(page)
    .getByRole("textbox", { name: textbox, exact: true })
    .evaluate((element: HTMLTextAreaElement, bytes: number[]) => {
      const data = new DataTransfer();
      data.items.add(
        new File([new Uint8Array(bytes)], "image.png", { type: "image/png" }),
      );
      element.focus();
      element.setSelectionRange(element.value.length, element.value.length);
      element.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, Array.from(png));
}
test("images pasted into descriptions and comments show inline and as attachments", async ({
  page,
}) => {
  await login(page);
  await showBacklog(page, "bug", ["P1", "P2"]);
  await page.getByRole("button", { name: "Report a bug" }).click();
  await dialog(page)
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Chart renders blank");
  await dialog(page)
    .getByRole("textbox", { name: "Description", exact: true })
    .fill("Open the dashboard:");
  await pasteImage(page, "Description");
  await expect(
    dialog(page).getByRole("textbox", { name: "Description", exact: true }),
  ).toHaveValue(
    "Open the dashboard:\n![pasted-image-1.png](attachment:pasted-image-1.png)",
  );
  await expect(
    dialog(page).locator(".staged-files").getByText("pasted-image-1.png"),
  ).toBeVisible();
  await dialog(page)
    .getByRole("textbox", { name: "Description", exact: true })
    .press("End");
  await dialog(page)
    .getByRole("textbox", { name: "Description", exact: true })
    .type("\nThe chart area stays empty.");
  await dialog(page)
    .getByRole("combobox", { name: "Priority", exact: true })
    .selectOption("P1");
  await dialog(page).getByRole("button", { name: "Create bug" }).click();
  await expect(dialog(page).getByText(/SAV-000001/)).toBeVisible();
  const inline = dialog(page)
    .locator(".detail-main .description img.inline-image")
    .first();
  await expect(inline).toBeVisible();
  await expect
    .poll(() =>
      inline.evaluate(
        (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
      ),
    )
    .toBeTruthy();
  await expect(
    dialog(page).locator(".detail-main > section").first(),
  ).toContainText("Open the dashboard:");
  await expect(
    dialog(page).locator(".detail-main > section").first(),
  ).toContainText("The chart area stays empty.");
  await expect(
    dialog(page).locator(".detail-main > section").first(),
  ).not.toContainText("attachment:");
  await expect(
    dialog(page).locator(".attachment").getByRole("link", {
      name: "↓ pasted-image-1.png",
    }),
  ).toBeVisible();

  await pasteImage(page, "Add a comment");
  await expect(
    dialog(page).getByRole("textbox", { name: "Add a comment", exact: true }),
  ).toHaveValue("![pasted-image-1.png](attachment:pasted-image-1.png)");
  await dialog(page).getByRole("button", { name: "Post comment" }).click();
  await expect(
    dialog(page).locator(".comment .description img.inline-image"),
  ).toBeVisible();
  await expect(
    dialog(page).locator(".comment .attachment").getByRole("link", {
      name: "↓ pasted-image-1.png",
    }),
  ).toBeVisible();
  await expect(dialog(page).locator(".comment")).not.toContainText(
    "attachment:",
  );

  // The Kanban preview shows the words without the marker.
  await close(page);
  await page
    .getByRole("navigation", { name: "View", exact: true })
    .getByRole("button", { name: "Kanban", exact: true })
    .click();
  const card = page.locator(".kanban-description", {
    hasText: "Open the dashboard:",
  });
  await expect(card).toBeVisible();
  await expect(card).not.toContainText("attachment:");
});
test("email processor retries SMTP failure and sends assignment, comment and follow notifications once", async ({
  page,
}) => {
  await login(page);
  setSmtpMode("fail");
  const task = await create(page, {
    title: "Notification test",
    implementorId: "dev",
    reviewerId: "dev",
  });
  await expect
    .poll(() => {
      const connection = db();
      const row = connection
        .prepare("SELECT attempts FROM project_outbox LIMIT 1")
        .get() as { attempts: number };
      connection.close();
      return row.attempts;
    })
    .toBeGreaterThan(0);
  expect(mailsTo(editorEmail)).toHaveLength(0);
  setSmtpMode("ok");
  const connection = db();
  connection.prepare("UPDATE project_outbox SET next_attempt_at=0").run();
  connection.close();
  const notify = () =>
    page.request.post("/api/jobs/notify", {
      headers: { "x-claw-key": E2E.clawKey },
    });
  expect((await notify()).ok()).toBeTruthy();
  await expect.poll(() => mailsTo(editorEmail).length).toBe(1);
  expect(mailsTo(editorEmail)[0].subject).toContain("implementor and reviewer");
  expect(mailsTo(editorEmail)[0].text).toContain(`/?item=${task.id}`);
  await notify();
  expect(mailsTo(editorEmail)).toHaveLength(1);
  await page.request.post("/api/project", {
    headers: await sessionHeaders(page),
    data: {
      id: task.id,
      action: "comment",
      body: "Ready to develop\nPlease check the screenshots.",
    },
  });
  await expect.poll(() => mailsTo(editorEmail).length).toBe(2);
  expect(mailsTo(editorEmail)[1].text).toContain(
    "Ready to develop\nPlease check the screenshots.",
  );
  await page.request.post("/api/project", {
    headers: await sessionHeaders(page),
    data: { id: task.id, action: "follow", follow: true },
  });
  await expect.poll(() => mailsTo(editorEmail).length).toBe(3);
  await expect
    .poll(() =>
      mailsTo(E2E.ownerEmail).some((mail) =>
        mail.subject.includes("Followed this item"),
      ),
    )
    .toBeTruthy();
  await page.request.post("/api/project", {
    headers: await sessionHeaders(page),
    data: { id: task.id, action: "follow", follow: true },
  });
  await notify();
  expect(mailsTo(editorEmail)).toHaveLength(3);
  expect((await page.request.post("/api/jobs/notify")).status()).toBe(401);
});

test("profile photos replace initials and read-only access protects work and attachments", async ({
  page,
  browser,
}) => {
  await login(page);
  await expect(
    page.getByRole("button", { name: "Your profile" }),
  ).toContainText("AM");
  await page.getByRole("button", { name: "Your profile" }).click();
  await dialog(page).getByLabel("Display name").fill("Alex Taylor");
  await dialog(page)
    .getByLabel("Upload profile picture", { exact: true })
    .setInputFiles([
      { name: "profile.png", mimeType: "image/png", buffer: png },
    ]);
  await dialog(page).getByRole("button", { name: "Save profile" }).click();
  await expect(
    page
      .getByRole("button", { name: "Your profile" })
      .getByRole("img", { name: "Alex Taylor" }),
  ).toBeVisible();
  const profile = (
    await (
      await page.request.get("/api/project", {
        headers: await sessionHeaders(page),
      })
    ).json()
  ).user;
  const task = await create(page, { title: "Read-only review" });
  await page.getByRole("button", { name: "Your profile" }).click();
  await dialog(page)
    .getByRole("button", { name: "Use initials instead" })
    .click();
  await dialog(page).getByRole("button", { name: "Save profile" }).click();
  await expect(
    page.getByRole("button", { name: "Your profile" }),
  ).toContainText("AT");
  const context = await browser.newContext();
  expect(
    (await context.request.get(`/api/assets/${profile.avatarId}`)).status(),
  ).toBe(401);
  expect(
    (
      await context.request.post("/api/project", {
        data: { title: "Intrusion" },
      })
    ).status(),
  ).toBe(401);
  const readerPage = await context.newPage();
  await login(readerPage, readerEmail);
  expect(
    (
      await readerPage.request.patch("/api/project", {
        headers: await sessionHeaders(readerPage),
        data: { id: task.id, title: "Should fail" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await readerPage.request.post("/api/admin/users", {
        headers: await sessionHeaders(readerPage),
        data: { email: "intruder@example.test", role: "admin" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await readerPage.request.patch("/api/profile", {
        headers: await sessionHeaders(readerPage),
        data: { name: "Reader Name" },
      })
    ).status(),
  ).toBe(200);
  await showBacklog(readerPage);
  await readerPage
    .getByRole("button", { name: "Read-only review", exact: true })
    .click();
  await expect(
    dialog(readerPage).getByRole("button", { name: "Edit item" }),
  ).toHaveCount(0);
  await expect(
    dialog(readerPage).getByRole("button", { name: "Convert to bug" }),
  ).toHaveCount(0);
  expect(
    (
      await readerPage.request.post("/api/project", {
        headers: await sessionHeaders(readerPage),
        data: { action: "convert", id: task.id, kind: "bug" },
      })
    ).status(),
  ).toBe(403);
  await expect(
    dialog(readerPage).getByRole("textbox", {
      name: "Add a comment",
      exact: true,
    }),
  ).toHaveCount(0);
  await dialog(readerPage)
    .getByRole("button", { name: "+ Follow", exact: true })
    .click();
  await expect(
    dialog(readerPage).getByRole("button", {
      name: "✓ Following",
      exact: true,
    }),
  ).toBeVisible();
  await close(readerPage);
  await readerPage.setViewportSize({ width: 390, height: 844 });
  await readerPage.evaluate(() => window.scrollTo(0, 0));
  await readerPage.screenshot({
    path: ".playwright/features-mobile.png",
    fullPage: true,
  });
  expect(
    await readerPage.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await context.close();
  // Bearer keys use the same authorization and workflow validation as people.
  const connection = db();
  connection
    .prepare("INSERT INTO api_keys VALUES ('bot','Test bot',?,'read',?)")
    .run(hash("test-bot-key"), new Date().toISOString());
  connection.close();
  expect(
    (
      await page.request.post("/api/v1/tasks", {
        headers: { Authorization: "Bearer test-bot-key" },
        data: { title: "No write access" },
      })
    ).status(),
  ).toBe(403);
});

test("Kanban combines priorities, moves cards, and keeps only four weeks of Done", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1800, height: 1000 });
  await login(page);
  const feature = await create(page, {
    title: "Priority feature",
    sectionId: "next-five",
  });
  const highBug = await create(page, {
    title: "Urgent bug",
    kind: "bug",
    priority: "P1",
    state: "in_qa",
  });
  const parent = await create(page, {
    title: "Feature with subtasks",
    sectionId: "next-five",
  });
  const child = await create(page, {
    title: "Nested work",
    parentId: parent.id,
  });
  await create(page, { title: "Waiting in backlog" });
  await create(page, {
    title: "Lower priority bug",
    kind: "bug",
    priority: "P3",
  });
  const recentFeature = await create(page, {
    title: "Recently shipped feature",
    state: "done",
  });
  const oldFeature = await create(page, {
    title: "Old completed feature",
    state: "done",
  });
  const oldBug = await create(page, {
    title: "Old completed bug",
    kind: "bug",
    priority: "P2",
    state: "done",
  });
  const connection = db();
  const old = new Date(Date.now() - 29 * 86400000).toISOString();
  for (const item of [oldFeature, oldBug])
    connection
      .prepare("UPDATE tasks SET completed_at=? WHERE id=?")
      .run(old, item.id);
  connection.close();
  await page.reload();
  await page.getByRole("button", { name: "Kanban", exact: true }).click();
  const board = page.getByRole("region", { name: "Kanban board", exact: true });
  await expect(board.getByRole("region")).toHaveCount(6);
  await expect(
    board.getByRole("button", { name: feature.title, exact: true }),
  ).toBeVisible();
  await expect(
    board
      .getByRole("article", { name: feature.title, exact: true })
      .locator(".priority"),
  ).toHaveText("P3");
  await expect(
    board.getByRole("button", { name: highBug.title, exact: true }),
  ).toBeVisible();
  await expect(
    board.getByRole("button", { name: recentFeature.title, exact: true }),
  ).toBeVisible();
  for (const title of [
    "Waiting in backlog",
    "Lower priority bug",
    "Nested work",
    oldFeature.title,
    oldBug.title,
  ])
    await expect(
      board.getByRole("button", { name: title, exact: true }),
    ).toHaveCount(0);
  await expect(
    board.getByLabel(`State for ${parent.title}`, { exact: true }),
  ).toHaveValue("needs_review");
  await expect(
    board.getByRole("article", { name: parent.title, exact: true }),
  ).toContainText("1 subtask");
  await board
    .getByRole("article", { name: parent.title, exact: true })
    .getByRole("button", { name: parent.title, exact: true })
    .dragTo(
      board.getByRole("region", { name: "In progress column", exact: true }),
    );
  await expect(
    board.getByRole("region", { name: "In progress column", exact: true }),
  ).toContainText(parent.title);
  await expect(dialog(page)).toHaveCount(0);
  const unchangedChild = await page.request.get(`/api/project?id=${child.id}`, {
    headers: await sessionHeaders(page),
  });
  expect((await unchangedChild.json()).detail.task.state).toBe("needs_review");
  await board
    .getByRole("article", { name: highBug.title, exact: true })
    .locator(".kanban-drag-handle")
    .dragTo(
      board.getByRole("region", { name: "In review column", exact: true }),
    );
  await expect(
    board.getByRole("region", { name: "In review column", exact: true }),
  ).toContainText(highBug.title);
  await board
    .getByLabel(`State for ${feature.title}`, { exact: true })
    .selectOption("in_progress");
  await expect(
    board.getByRole("region", { name: "In progress column", exact: true }),
  ).toContainText(feature.title);
  await board
    .getByRole("article", { name: feature.title, exact: true })
    .dragTo(board.getByRole("region", { name: "Done column", exact: true }), {
      sourcePosition: { x: 10, y: 10 },
    });
  await expect(
    board.getByRole("region", { name: "Done column", exact: true }),
  ).toContainText(feature.title);
  const result = await page.request.get(`/api/project?id=${feature.id}`, {
    headers: await sessionHeaders(page),
  });
  expect((await result.json()).detail.task.completedAt).toBeTruthy();
  await board.getByRole("button", { name: feature.title, exact: true }).click();
  await expect(
    dialog(page).getByRole("heading", { name: feature.title, exact: true }),
  ).toBeVisible();
  await close(page);
  await expect(board).toBeVisible();
  await page.request.patch("/api/project", {
    headers: await sessionHeaders(page),
    data: { id: oldBug.id, description: "Metadata changed today" },
  });
  await page.reload();
  await page.getByRole("button", { name: "Kanban", exact: true }).click();
  await expect(
    board.getByLabel(`State for ${parent.title}`, { exact: true }),
  ).toHaveValue("in_progress");
  await expect(
    board.getByLabel(`State for ${highBug.title}`, { exact: true }),
  ).toHaveValue("in_review");
  await expect(
    board.getByRole("button", { name: oldBug.title, exact: true }),
  ).toHaveCount(0);
  await board.evaluate((element) => {
    element.scrollLeft = 0;
  });
  await page.screenshot({
    path: ".playwright/kanban-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  expect(
    await board.evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: ".playwright/kanban-mobile.png",
    fullPage: true,
  });
  await showBacklog(page);
  await expect(
    page.getByRole("button", { name: oldFeature.title, exact: true }),
  ).toBeVisible();
});

test("features convert to bugs and back while preserving subtasks, collaboration, and priority", async ({
  page,
}) => {
  await login(page);
  const task = await create(page, {
    title: "Reclassify export",
    description: "Keep the requirements",
    priority: "P2",
    sectionId: "next-five",
  });
  const child = await create(page, {
    title: "Export follow-up",
    parentId: task.id,
    state: "in_review",
  });
  await page.goto(`/?item=${task.id}`);
  await expect(
    dialog(page).getByRole("heading", { name: task.title, exact: true }),
  ).toBeVisible();
  await dialog(page)
    .getByLabel("Add a comment", { exact: true })
    .fill("Keep this discussion");
  await dialog(page)
    .getByLabel("Attach files", { exact: true })
    .setInputFiles([
      { name: "conversion.png", mimeType: "image/png", buffer: png },
    ]);
  await dialog(page).getByRole("button", { name: "Post comment" }).click();
  await expect(
    dialog(page).getByText("Keep this discussion", { exact: true }),
  ).toBeVisible();
  await dialog(page)
    .getByRole("button", { name: "+ Follow", exact: true })
    .click();
  await expect(
    dialog(page).getByRole("button", { name: "✓ Following", exact: true }),
  ).toBeVisible();
  await dialog(page)
    .getByRole("button", { name: "Convert to bug", exact: true })
    .click();
  await expect(
    dialog(page).getByRole("button", {
      name: "Convert to feature",
      exact: true,
    }),
  ).toBeVisible();
  await expect(dialog(page).locator(".detail-toolbar .priority")).toHaveText(
    "P2",
  );
  await expect(
    dialog(page).getByLabel(`State for ${task.title}`, { exact: true }),
  ).toHaveValue("needs_review");
  await expect(
    dialog(page).getByRole("img", { name: "conversion.png", exact: true }),
  ).toBeVisible();
  const read = async () =>
    (
      await (
        await page.request.get(`/api/project?id=${task.id}`, {
          headers: await sessionHeaders(page),
        })
      ).json()
    ).detail;
  const bug = await read();
  expect(bug.task.id).toBe(task.id);
  expect(bug.task.publicId).toBe("SAV-000001");
  expect(bug.task.sectionId).toBe("bugs-high");
  expect(bug.task.children).toEqual([]);
  expect(bug.links[0].other.id).toBe(child.id);
  await close(page);
  await showBacklog(page, "bug", ["P1", "P2"]);
  await expect(
    page
      .getByRole("region", { name: "Backlog", exact: true })
      .getByRole("button", { name: /Reclassify export/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /SAV-000001.*Reclassify export/ })
    .click();
  await dialog(page)
    .getByRole("button", { name: "Convert to feature", exact: true })
    .click();
  await expect(
    dialog(page).getByRole("button", { name: "Convert to bug", exact: true }),
  ).toBeVisible();
  const converted = await read();
  expect(converted.task.kind).toBe("feature");
  expect(converted.task.sectionId).toBe("feature-backlog");
  expect(converted.task.publicId).toBe(bug.task.publicId);
  expect(converted.comments).toEqual(bug.comments);
  expect(converted.followers).toEqual(bug.followers);
  expect(converted.links).toEqual(bug.links);
  await close(page);
  await showBacklog(page);
  const backlog = page.getByRole("region", {
    name: "Backlog",
    exact: true,
  });
  await expect(
    backlog.getByRole("button", { name: child.title, exact: true }),
  ).toBeVisible();
  await backlog
    .getByLabel("Priority for SAV-000001", { exact: true })
    .selectOption("P4");
  await expect(
    backlog.getByLabel("Priority for SAV-000001", { exact: true }),
  ).toHaveValue("P4");
  await backlog
    .getByRole("button", { name: /SAV-000001.*Reclassify export/ })
    .click();
  await dialog(page)
    .getByRole("button", { name: "Convert to bug", exact: true })
    .click();
  await expect(
    dialog(page).getByRole("button", {
      name: "Convert to feature",
      exact: true,
    }),
  ).toBeVisible();
  expect((await read()).task.publicId).toBe("SAV-000001");
  await expect(page).toHaveURL(new RegExp(`/backlog\\?item=${task.id}$`));
  await close(page);
  await showBacklog(page, "bug", ["P3", "P4"]);
  await expect(
    page
      .getByRole("region", { name: "Backlog", exact: true })
      .getByLabel("Priority for SAV-000001", { exact: true }),
  ).toHaveValue("P4");
});

test("feature list subtasks start collapsed and expand independently at each level", async ({
  page,
}) => {
  await login(page);
  const parent = await create(page, {
    title: "Priority parent",
    sectionId: "next-five",
  });
  const child = await create(page, {
    title: "Priority child",
    parentId: parent.id,
  });
  await create(page, { title: "Nested child", parentId: child.id });
  const waiting = await create(page, { title: "Backlog parent" });
  await create(page, { title: "Backlog child", parentId: waiting.id });
  await page.reload();
  const next = page.getByRole("region", {
    name: "Next 5 features",
    exact: true,
  });
  const backlog = page.getByRole("region", {
    name: "Backlog",
    exact: true,
  });
  const rootToggle = next.getByRole("button", {
    name: "Expand subtasks for Priority parent",
    exact: true,
  });
  await expect(rootToggle).toHaveAttribute("aria-expanded", "false");
  await expect(next.locator(".task-title")).toHaveCount(1);
  await expect(backlog).toHaveCount(0);
  await rootToggle.click();
  const childToggle = next.getByRole("button", {
    name: "Expand subtasks for Priority child",
    exact: true,
  });
  await expect(childToggle).toHaveAttribute("aria-expanded", "false");
  await expect(next.locator(".task-title")).toHaveCount(2);
  await childToggle.click();
  await expect(
    next.getByRole("button", { name: "Nested child", exact: true }),
  ).toBeVisible();
  await next
    .getByRole("button", {
      name: "Collapse subtasks for Priority parent",
      exact: true,
    })
    .click();
  await expect(next.locator(".task-title")).toHaveCount(1);
  await rootToggle.click();
  await expect(childToggle).toHaveAttribute("aria-expanded", "false");
  await page.reload();
  await expect(rootToggle).toHaveAttribute("aria-expanded", "false");
  await showBacklog(page);
  await expect(backlog.locator(".task-title")).toHaveCount(1);
  await backlog
    .getByRole("button", {
      name: "Expand subtasks for Backlog parent",
      exact: true,
    })
    .click();
  await expect(
    backlog.getByRole("button", { name: "Backlog child", exact: true }),
  ).toBeVisible();
  await showNextFive(page);
  await expect(rootToggle).toHaveAttribute("aria-expanded", "false");
  await page.setViewportSize({ width: 390, height: 844 });
  await rootToggle.click();
  await expect(childToggle).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: ".playwright/collapsed-subtasks-mobile.png",
    fullPage: true,
  });
});

test("state labels save directly in lists and details, preserve subtasks, and report failed updates", async ({
  page,
}) => {
  await login(page);
  const parent = await create(page, {
    title: "Editable parent",
    sectionId: "next-five",
  });
  const child = await create(page, {
    title: "Editable child",
    parentId: parent.id,
    state: "in_qa",
  });
  const bug = await create(page, {
    title: "Editable bug",
    kind: "bug",
    priority: "P1",
  });
  await page.reload();
  const next = page.getByRole("region", {
    name: "Next 5 features",
    exact: true,
  });
  const parentState = next.getByLabel(`State for ${parent.title}`, {
    exact: true,
  });
  await parentState.selectOption("ready_for_development");
  await expect(parentState).toHaveValue("ready_for_development");
  await next
    .getByRole("button", {
      name: `Expand subtasks for ${parent.title}`,
      exact: true,
    })
    .click();
  const childState = next.getByLabel(`State for ${child.title}`, {
    exact: true,
  });
  await expect(childState).toHaveValue("in_qa");
  await childState.selectOption("in_review");
  await expect(childState).toHaveValue("in_review");
  await expect(parentState).toHaveValue("ready_for_development");
  await page.route("**/api/project", async (route) => {
    if (route.request().method() === "PATCH")
      await route.fulfill({
        status: 409,
        json: { error: "Could not save the state. Try again." },
      });
    else await route.continue();
  });
  await parentState.selectOption("done");
  await expect(
    page.getByRole("alert").filter({ hasText: "Could not save the state" }),
  ).toBeVisible();
  await expect(parentState).toHaveValue("ready_for_development");
  await page.unroute("**/api/project");
  await page.reload();
  await expect(parentState).toHaveValue("ready_for_development");
  await showBacklog(page, "bug", ["P1", "P2"]);
  await page
    .getByLabel(`State for ${bug.title}`, { exact: true })
    .selectOption("in_progress");
  await expect(
    page.getByLabel(`State for ${bug.title}`, { exact: true }),
  ).toHaveValue("in_progress");
  await page.getByRole("button", { name: /SAV-000001.*Editable bug/ }).click();
  await dialog(page)
    .getByLabel(`State for ${bug.title}`, { exact: true })
    .selectOption("done");
  await expect(
    dialog(page).getByLabel(`State for ${bug.title}`, { exact: true }),
  ).toHaveValue("done");
  await close(page);
  await page.reload();
  await showBacklog(page, "bug", ["P1", "P2"]);
  await expect(
    page.getByLabel(`State for ${bug.title}`, { exact: true }),
  ).toHaveValue("done");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(page, readerEmail);
  await expect(
    page.getByLabel(`State for ${parent.title}`, { exact: true }),
  ).toHaveCount(0);
  await next.locator(".task-title").filter({ hasText: parent.title }).click();
  await expect(
    dialog(page).getByLabel(`State for ${parent.title}`, { exact: true }),
  ).toHaveCount(0);
  await expect(dialog(page).locator(".detail-toolbar .status")).toHaveText(
    "Ready for development",
  );
});

test("a Kanban card can be dragged repeatedly from the second column and back", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await login(page);
  const task = await create(page, {
    title: "Sequential drag",
    sectionId: "next-five",
  });
  await create(page, { title: "Subtask", parentId: task.id });
  await page.reload();
  await page.getByRole("button", { name: "Kanban", exact: true }).click();
  const board = page.getByRole("region", { name: "Kanban board", exact: true });
  for (const [label, state] of [
    ["Ready for development", "ready_for_development"],
    ["In progress", "in_progress"],
    ["Ready for development", "ready_for_development"],
    ["In QA", "in_qa"],
    ["In review", "in_review"],
    ["Done", "done"],
    ["In review", "in_review"],
    ["In QA", "in_qa"],
    ["In progress", "in_progress"],
    ["Ready for development", "ready_for_development"],
    ["Needs review", "needs_review"],
  ]) {
    await board
      .getByRole("article", { name: task.title, exact: true })
      .locator(".kanban-drag-handle")
      .dragTo(
        board.getByRole("region", { name: `${label} column`, exact: true }),
        { targetPosition: { x: 120, y: 100 } },
      );
    await expect(
      board.getByRole("region", { name: `${label} column`, exact: true }),
    ).toContainText(task.title);
    await expect(
      board.getByLabel(`State for ${task.title}`, { exact: true }),
    ).toHaveValue(state);
    await expect(dialog(page)).toHaveCount(0);
  }
  await page.reload();
  await expect(
    board.getByLabel(`State for ${task.title}`, { exact: true }),
  ).toHaveValue("needs_review");
});

test("Kanban drag cancels safely, recovers from failed saves, and scrolls to distant columns", async ({
  page,
}) => {
  await login(page, E2E.ownerEmail, "/kanban");
  const task = await create(page, {
    title: "Scroll and retry",
    sectionId: "next-five",
  });
  await page.reload();
  const board = page.getByRole("region", { name: "Kanban board", exact: true });
  const handle = board
    .getByRole("article", { name: task.title, exact: true })
    .locator(".kanban-drag-handle");
  const begin = async () => {
    await handle.scrollIntoViewIfNeeded();
    const box = (await handle.boundingBox())!;
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 12, point.y);
    await expect(page.locator(".kanban-drag-preview")).toBeVisible();
    return point;
  };
  const changes: unknown[] = [];
  page.on("request", (request) => {
    if (request.method() === "PATCH" && request.url().endsWith("/api/project"))
      changes.push(request.postDataJSON());
  });
  await begin();
  await page.keyboard.press("Escape");
  await expect(page.locator(".kanban-drag-preview")).toHaveCount(0);
  await page.mouse.up();
  await begin();
  await page.mouse.move(5, 5);
  await page.mouse.up();
  await expect(page.locator(".kanban-drag-preview")).toHaveCount(0);
  await begin();
  await page.mouse.up();
  await expect(page.locator(".kanban-drag-preview")).toHaveCount(0);
  expect(changes).toHaveLength(0);
  await page.route("**/api/project", async (route) => {
    if (route.request().method() === "PATCH")
      await route.fulfill({
        status: 503,
        json: { error: "Temporary save failure" },
      });
    else await route.continue();
  });
  const ready = board.getByRole("region", {
    name: "Ready for development column",
    exact: true,
  });
  await handle.dragTo(ready, { targetPosition: { x: 120, y: 100 } });
  await expect(
    page.getByRole("alert").filter({ hasText: "Temporary save failure" }),
  ).toBeVisible();
  await expect(
    board.getByLabel(`State for ${task.title}`, { exact: true }),
  ).toHaveValue("needs_review");
  await page.unroute("**/api/project");
  await handle.dragTo(ready, { targetPosition: { x: 120, y: 100 } });
  await expect(
    board.getByLabel(`State for ${task.title}`, { exact: true }),
  ).toHaveValue("ready_for_development");
  for (const side of ["right", "left"]) {
    const point = await begin();
    const bounds = (await board.boundingBox())!;
    await page.mouse.move(
      side === "right" ? bounds.x + bounds.width - 10 : bounds.x + 10,
      point.y,
      { steps: 10 },
    );
    await expect
      .poll(() =>
        board.evaluate(
          (element, side) =>
            side === "right"
              ? element.scrollLeft >=
                element.scrollWidth - element.clientWidth - 2
              : element.scrollLeft <= 2,
          side,
        ),
      )
      .toBeTruthy();
    await page.mouse.up();
    await expect(
      board.getByLabel(`State for ${task.title}`, { exact: true }),
    ).toHaveValue(side === "right" ? "done" : "needs_review");
  }
  await expect(dialog(page)).toHaveCount(0);
  expect(changes).toHaveLength(4);
  // Exercise real touch input too: each release must permit a fresh gesture
  // from the column the card just entered.
  const touch = await page.context().newCDPSession(page);
  await touch.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  for (const [label, state] of [
    ["Ready for development", "ready_for_development"],
    ["In progress", "in_progress"],
  ]) {
    await handle.scrollIntoViewIfNeeded();
    const source = (await handle.boundingBox())!;
    const target = (await board
      .getByRole("region", { name: `${label} column`, exact: true })
      .boundingBox())!;
    const point = {
      x: source.x + source.width / 2,
      y: source.y + source.height / 2,
    };
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [point],
    });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: point.x + 12, y: point.y }],
    });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: target.x + 120, y: target.y + 100 }],
    });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect(
      board.getByLabel(`State for ${task.title}`, { exact: true }),
    ).toHaveValue(state);
    await expect(dialog(page)).toHaveCount(0);
  }
  await touch.detach();
});

test("Kanban deep links survive sign-in, refresh, item details, and browser navigation", async ({
  page,
}) => {
  await login(page, E2E.ownerEmail, "/kanban");
  const board = page.getByRole("region", { name: "Kanban board", exact: true });
  await expect(board).toBeVisible();
  await expect(page).toHaveURL(/\/kanban$/);
  const task = await create(page, {
    title: "Bookmarked feature",
    sectionId: "next-five",
  });
  await page.reload();
  await expect(board).toBeVisible();
  await board.getByRole("button", { name: task.title, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/kanban\\?item=${task.id}$`));
  await page.reload();
  await expect(
    dialog(page).getByRole("heading", { name: task.title, exact: true }),
  ).toBeVisible();
  await close(page);
  await expect(page).toHaveURL(/\/kanban$/);
  await expect(board).toBeVisible();
  await showNextFive(page);
  await expect(page).toHaveURL(/\/$/);
  await expect(board).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/kanban$/);
  await expect(board).toBeVisible();
  await page.goForward();
  await expect(
    page.getByRole("region", { name: "Next 5 features" }),
  ).toBeVisible();
  await showBacklog(page, "bug", ["P1", "P2"]);
  await expect(page).toHaveURL(/\/backlog\?/);
  await page.reload();
  await expect(
    page
      .getByRole("navigation", { name: "List sections" })
      .getByRole("button", { name: /^Backlog/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Kanban", exact: true }).click();
  await expect(page).toHaveURL(/\/kanban$/);
  await expect(board).toBeVisible();
});

test("list and Kanban status changes send background email identifying the actor, item, and transition", async ({
  page,
}) => {
  await login(page);
  const task = await create(page, {
    title: "Status mail bug",
    kind: "bug",
    priority: "P1",
    implementorId: "dev",
  });
  await expect.poll(() => mailsTo(editorEmail).length).toBe(1);
  await page.reload();
  await showBacklog(page, "bug", ["P1", "P2"]);
  await page
    .getByLabel(`State for ${task.title}`, { exact: true })
    .selectOption("ready_for_development");
  await expect.poll(() => mailsTo(editorEmail).length).toBe(2);
  const message = mailsTo(editorEmail)[1];
  expect(message.subject).toContain(
    `${task.publicId}: Changed status from Needs review to Ready for development`,
  );
  expect(message.subject).toContain(task.title);
  expect(message.text).toContain(`Changed by: Alex Morgan (${E2E.ownerEmail})`);
  expect(message.text).toContain(
    "Previous status: Needs review\nNew status: Ready for development",
  );
  expect(message.text).toContain(`/?item=${task.publicId}`);
  await page.getByRole("button", { name: "Kanban", exact: true }).click();
  const board = page.getByRole("region", { name: "Kanban board", exact: true });
  await board
    .getByRole("article", { name: task.title, exact: true })
    .locator(".kanban-drag-handle")
    .dragTo(
      board.getByRole("region", { name: "In progress column", exact: true }),
      { targetPosition: { x: 120, y: 100 } },
    );
  await expect.poll(() => mailsTo(editorEmail).length).toBe(3);
  expect(mailsTo(editorEmail)[2].subject).toContain(
    "Changed status from Ready for development to In progress",
  );
  expect(
    mailsTo(E2E.ownerEmail).filter((mail) =>
      mail.subject.includes("Changed status"),
    ),
  ).toHaveLength(0);
});

test("List separates Next 5 from the combined backlog and persists class, severity, search, and state filters", async ({
  page,
}) => {
  await login(page);
  const view = page.getByRole("navigation", { name: "View", exact: true });
  await expect(view.getByRole("button")).toHaveText(["List", "Kanban"]);
  await expect(
    page.getByRole("navigation", { name: "List sections" }).getByRole("button"),
  ).toHaveCount(2);
  const next = await create(page, {
    title: "Focused feature",
    sectionId: "next-five",
    priority: "P4",
  });
  for (const priority of ["P1", "P2", "P3"])
    await create(page, { title: `Feature ${priority}`, priority });
  let selected: { id: string; title: string };
  for (const priority of ["P1", "P2", "P3", "P4"]) {
    const item = await create(page, {
      title: `Bug ${priority}`,
      kind: "bug",
      priority,
      state: priority === "P3" ? "in_qa" : "needs_review",
    });
    if (priority === "P3") selected = item;
  }
  await page.reload();
  await expect(
    page
      .getByRole("region", { name: "Next 5 features", exact: true })
      .locator(".task-title"),
  ).toHaveText([next.title]);
  await showBacklog(page);
  const backlog = page.getByRole("region", { name: "Backlog", exact: true });
  await expect(backlog.locator(".task-title")).toHaveCount(7);
  await expect(backlog).not.toContainText(next.title);
  await page.getByLabel("Ticket class", { exact: true }).selectOption("bug");
  await selectSeverities(page, ["P1", "P3"]);
  await expect(backlog.locator(".task-title")).toHaveCount(2);
  await expect(backlog).toContainText("Bug P1");
  await expect(backlog).toContainText("Bug P3");
  await page.getByLabel("Search items", { exact: true }).fill("Bug");
  await page
    .getByLabel("Filter by state", { exact: true })
    .selectOption("in_qa");
  await expect(backlog.locator(".task-title")).toHaveCount(1);
  const params = new URL(page.url()).searchParams;
  expect(params.get("class")).toBe("bugs");
  expect(params.get("severity")).toBe("P1,P3");
  expect(params.get("q")).toBe("Bug");
  expect(params.get("state")).toBe("in_qa");
  await page.reload();
  await expect(page.getByLabel("Ticket class", { exact: true })).toHaveValue(
    "bug",
  );
  await expect(page.getByLabel("Search items", { exact: true })).toHaveValue(
    "Bug",
  );
  await expect(page.getByLabel("Filter by state", { exact: true })).toHaveValue(
    "in_qa",
  );
  await backlog.locator(".task-title").click();
  await expect(
    dialog(page).getByRole("heading", { name: selected!.title, exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    dialog(page).getByRole("heading", { name: selected!.title, exact: true }),
  ).toBeVisible();
  await dialog(page).getByRole("button", { name: "Edit item" }).click();
  await dialog(page)
    .getByRole("combobox", { name: "Priority", exact: true })
    .selectOption("P4");
  await dialog(page).getByRole("button", { name: "Save changes" }).click();
  await close(page);
  await expect(backlog).toContainText("No matching items.");
  await page
    .getByRole("button", { name: "Reset filters", exact: true })
    .click();
  await expect(backlog.locator(".task-title")).toHaveCount(7);
  await selectSeverities(page, []);
  await expect(backlog).toContainText("No matching items.");
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Backlog filters" }),
  ).toContainText("No severities selected");
  await page
    .getByRole("button", { name: "Reset filters", exact: true })
    .click();
  await backlog
    .locator(".task-row")
    .filter({ hasText: "Feature P1" })
    .getByRole("button", { name: "To Next 5" })
    .click();
  await expect(backlog.locator(".task-title")).toHaveCount(6);
  await showNextFive(page);
  await expect(
    page
      .getByRole("region", { name: "Next 5 features", exact: true })
      .locator(".task-title"),
  ).toHaveText([next.title, "Feature P1"]);
});

test("Backlog can sort by most recently added, preserving filters and bookmarks", async ({
  page,
}) => {
  await login(page, E2E.ownerEmail, "/backlog");
  const older = await create(page, {
    title: "Older urgent feature",
    priority: "P1",
  });
  const middle = await create(page, { title: "Middle feature", priority: "P3" });
  const newest = await create(page, {
    title: "Newest bug",
    kind: "bug",
    priority: "P4",
  });
  const connection = db();
  try {
    const setDate = connection.prepare(
      "UPDATE tasks SET created_at=? WHERE id=?",
    );
    setDate.run("2026-09-01T00:00:00Z", older.id);
    setDate.run("2026-09-02T00:00:00Z", middle.id);
    setDate.run("2026-09-03T00:00:00Z", newest.id);
  } finally {
    connection.close();
  }
  await page.reload();
  const backlog = page.getByRole("region", { name: "Backlog", exact: true });
  const titles = backlog.locator(".task-title > span:last-child");
  const sort = page.getByRole("combobox", { name: "Sort by", exact: true });
  await expect(sort).toHaveValue("priority");
  await expect(titles).toHaveText([older.title, middle.title, newest.title]);
  await sort.selectOption({ label: "Most recently added" });
  await expect(titles).toHaveText([newest.title, middle.title, older.title]);
  await expect(page).toHaveURL(/sort=newest/);
  await expect(backlog).toContainText("most recently added first");
  await page.reload();
  await expect(sort).toHaveValue("newest");
  await expect(titles).toHaveText([newest.title, middle.title, older.title]);
  await backlog.getByRole("button", { name: older.title, exact: true }).click();
  await expect(page).toHaveURL(/sort=newest/);
  await close(page);
  await page.getByLabel("Ticket class", { exact: true }).selectOption("feature");
  await expect(titles).toHaveText([middle.title, older.title]);
  await page.reload();
  await expect(sort).toHaveValue("newest");
  await expect(titles).toHaveText([middle.title, older.title]);
  await sort.selectOption("priority");
  await expect(titles).toHaveText([older.title, middle.title]);
  expect(new URL(page.url()).searchParams.has("sort")).toBe(false);
  await sort.selectOption("newest");
  await page
    .getByRole("button", { name: "Reset filters", exact: true })
    .click();
  await expect(sort).toHaveValue("priority");
  await expect(titles).toHaveText([older.title, middle.title, newest.title]);
  expect(new URL(page.url()).searchParams.has("sort")).toBe(false);
});

test("Backlog filters stay visible and usable while scrolling on desktop and mobile", async ({
  page,
}) => {
  await login(page, E2E.ownerEmail, "/backlog");
  for (let index = 0; index < 50; index++)
    await create(page, {
      title: `Triage bug ${index}`,
      kind: "bug",
      priority: index % 2 ? "P1" : "P2",
    });
  await page.reload();
  const filters = page.getByRole("region", {
    name: "Backlog filters",
    exact: true,
  });
  const backlog = page.getByRole("region", { name: "Backlog", exact: true });
  await page.getByLabel("Ticket class", { exact: true }).selectOption("bug");
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await selectSeverities(page, ["P1", "P2"]);
    await page
      .getByRole("combobox", { name: "Sort by", exact: true })
      .selectOption("newest");
    if (viewport.width === 1440)
      await page.screenshot({ path: ".playwright/backlog-overview.png" });
    await page.evaluate(() => window.scrollTo(0, 1400));
    await expect
      .poll(async () => {
        const header = (await page.locator(".app-header").boundingBox())!;
        const controls = (await filters.boundingBox())!;
        return Math.abs(controls.y - header.y - header.height);
      })
      .toBeLessThan(2);
    const control = filters.getByRole("checkbox", { name: "P2", exact: true });
    const point = (await control.boundingBox())!;
    expect(
      await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.tagName,
        { x: point.x + point.width / 2, y: point.y + point.height / 2 },
      ),
    ).toBe("INPUT");
    await control.uncheck();
    await expect(backlog.locator(".task-title")).toHaveCount(25);
    await expect(page.getByLabel("Ticket class", { exact: true })).toHaveValue(
      "bug",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: `.playwright/backlog-sticky-${viewport.width}.png`,
    });
  }
});

test("legacy bug bookmarks open a filtered Backlog for readers and preserve item links", async ({
  page,
}) => {
  await login(page);
  const item = await create(page, {
    title: "Legacy-linked bug",
    kind: "bug",
    priority: "P4",
  });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(page, readerEmail, "/bugs/p3-p4");
  const filters = page.getByRole("region", {
    name: "Backlog filters",
    exact: true,
  });
  const backlog = page.getByRole("region", { name: "Backlog", exact: true });
  await expect(page).toHaveURL(/\/backlog\?/);
  await expect(page.getByLabel("Ticket class", { exact: true })).toHaveValue(
    "bug",
  );
  await expect(
    filters.getByRole("checkbox", { name: "P4", exact: true }),
  ).toBeChecked();
  await expect(
    filters.getByRole("checkbox", { name: "P1", exact: true }),
  ).not.toBeChecked();
  await expect(backlog).toContainText(item.title);
  await expect(page.getByRole("button", { name: "Report a bug" })).toHaveCount(
    0,
  );
  for (const url of ["/bugs/p1-p2", "/?view=bugs"]) {
    await page.goto(url);
    await expect(
      filters.getByRole("checkbox", { name: "P1", exact: true }),
    ).toBeChecked();
    await expect(
      filters.getByRole("checkbox", { name: "P4", exact: true }),
    ).not.toBeChecked();
    await expect(backlog).not.toContainText(item.title);
  }
  await page.goto(`/?item=${item.publicId}`);
  await expect(page).toHaveURL(new RegExp(`/backlog\\?item=${item.publicId}$`));
  await expect(
    dialog(page).getByRole("heading", { name: item.title, exact: true }),
  ).toBeVisible();
  await close(page);
  await expect(backlog).toContainText(item.title);
  await expect(
    page
      .getByRole("navigation", { name: "View", exact: true })
      .getByRole("button"),
  ).toHaveText(["List", "Kanban"]);
});

test("My tickets limits Next 5, Backlog, and Kanban to work assigned to the signed-in person, keeping subtask context", async ({
  page,
}) => {
  await login(page);
  await create(page, {
    title: "Owner implements",
    sectionId: "next-five",
    implementorId: "owner",
  });
  await create(page, {
    title: "Dev implements",
    sectionId: "next-five",
    implementorId: "dev",
    reviewerId: "reader",
  });
  const parent = await create(page, { title: "Unassigned parent" });
  await create(page, {
    title: "Owner reviews subtask",
    parentId: parent.id,
    reviewerId: "owner",
  });
  await create(page, { title: "Nobody's feature" });
  await create(page, {
    title: "Owner reviews bug",
    kind: "bug",
    priority: "P1",
    reviewerId: "owner",
  });
  await create(page, {
    title: "Dev's bug",
    kind: "bug",
    priority: "P2",
    implementorId: "dev",
  });
  await page.reload();
  const mine = page.getByRole("checkbox", { name: "My tickets", exact: true });
  const nextFive = page.getByRole("region", {
    name: "Next 5 features",
    exact: true,
  });
  await expect(nextFive.locator(".task-title")).toHaveCount(2);
  await mine.check();
  await expect(nextFive.locator(".task-title")).toHaveText([
    "Owner implements",
  ]);
  await expect(page).toHaveURL(/mine=1/);
  await page.reload();
  await expect(mine).toBeChecked();
  await expect(nextFive.locator(".task-title")).toHaveText([
    "Owner implements",
  ]);
  await showBacklog(page);
  const backlog = page.getByRole("region", { name: "Backlog", exact: true });
  await expect(mine).not.toBeChecked();
  await expect(backlog.locator(".task-title")).toHaveCount(4);
  await mine.check();
  await expect(backlog.locator(".task-title")).toHaveCount(2);
  await expect(backlog).toContainText("Owner reviews bug");
  await expect(backlog).toContainText("Unassigned parent");
  await expect(backlog).toContainText("Matching subtask");
  await expect(backlog).not.toContainText("Dev's bug");
  await expect(backlog).not.toContainText("Nobody's feature");
  await page
    .getByRole("button", { name: "Expand subtasks for Unassigned parent" })
    .click();
  await expect(backlog.locator(".task-title")).toHaveCount(3);
  await expect(backlog).toContainText("Owner reviews subtask");
  await expect(page).toHaveURL(/\/backlog\?.*mine=1/);
  await page
    .getByRole("navigation", { name: "View", exact: true })
    .getByRole("button", { name: "Kanban", exact: true })
    .click();
  await expect(mine).toBeChecked();
  const board = page.getByRole("region", { name: "Kanban board" });
  await expect(board.locator(".kanban-card")).toHaveCount(2);
  await expect(board).toContainText("Owner implements");
  await expect(board).toContainText("Owner reviews bug");
  await expect(board).not.toContainText("Dev implements");
  await expect(board).not.toContainText("Dev's bug");
  await mine.uncheck();
  await expect(board.locator(".kanban-card")).toHaveCount(4);
  await expect(page).not.toHaveURL(/mine=1/);
});

test("effort is optional, edited from 1 to 5, validated by the API, and shown in details, lists, and Kanban", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("button", { name: "New feature" }).click();
  await dialog(page)
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Sized feature");
  const effort = dialog(page).getByRole("combobox", {
    name: "Effort",
    exact: true,
  });
  await expect(effort).toHaveValue("");
  await expect(effort.locator("option")).toHaveText([
    "Not set",
    "1 · Low",
    "2 · Light",
    "3 · Medium",
    "4 · Heavy",
    "5 · High",
  ]);
  await effort.selectOption("4");
  await dialog(page).getByRole("button", { name: "Create feature" }).click();
  await expect(
    dialog(page).getByRole("img", { name: "Effort 4 of 5", exact: true }),
  ).toBeVisible();
  await dialog(page)
    .getByRole("button", { name: "Edit item", exact: true })
    .click();
  await expect(effort).toHaveValue("4");
  await effort.selectOption("");
  await dialog(page).getByRole("button", { name: "Save changes" }).click();
  await expect(dialog(page).getByRole("img", { name: /Effort/ })).toHaveCount(
    0,
  );
  await dialog(page)
    .getByRole("button", { name: "Edit item", exact: true })
    .click();
  await effort.selectOption("2");
  await dialog(page).getByRole("button", { name: "Save changes" }).click();
  await expect(
    dialog(page).getByRole("img", { name: "Effort 2 of 5", exact: true }),
  ).toBeVisible();
  await close(page);
  await showBacklog(page);
  await expect(
    page
      .getByRole("region", { name: "Backlog", exact: true })
      .locator(".task-row")
      .filter({ hasText: "Sized feature" })
      .getByRole("img", { name: "Effort 2 of 5", exact: true }),
  ).toBeVisible();
  for (const invalid of [0, 6, 2.5, "abc"]) {
    const response = await page.request.post("/api/project", {
      headers: await sessionHeaders(page),
      data: { title: "Invalid", effort: invalid },
    });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toBe(
      "Effort must be a whole number from 1 (low) to 5 (high).",
    );
  }
  const digit = await create(page, {
    title: "Digit effort",
    sectionId: "next-five",
    effort: "5",
  });
  expect(digit.effort).toBe(5);
  await page.goto("/kanban");
  await expect(
    page
      .getByRole("region", { name: "Kanban board" })
      .locator(".kanban-card")
      .filter({ hasText: "Digit effort" })
      .getByRole("img", { name: "Effort 5 of 5", exact: true }),
  ).toBeVisible();
});

test("linking searches items by title or SAV ID and picks with the keyboard or mouse", async ({
  page,
}) => {
  await login(page);
  const bug = await create(page, {
    title: "Crash on save",
    kind: "bug",
    priority: "P3",
  });
  await create(page, { title: "Other bug", kind: "bug", priority: "P4" });
  await create(page, { title: "Export CSV" });
  await create(page, { title: "Import CSV" });
  await create(page, { title: "Audit log" });
  await page.goto(`/?item=${bug.publicId}`);
  const picker = dialog(page).getByRole("combobox", {
    name: "Link to item",
    exact: true,
  });
  const addLink = dialog(page).getByRole("button", {
    name: "Add link",
    exact: true,
  });
  const options = dialog(page)
    .getByRole("listbox", { name: "Link to item suggestions", exact: true })
    .getByRole("option");
  await expect(addLink).toBeDisabled();
  await picker.fill("csv");
  await expect(options).toHaveText([/Export CSV/, /Import CSV/]);
  await picker.press("ArrowDown");
  await picker.press("Enter");
  await expect(picker).toHaveValue("Feature · Import CSV");
  await expect(options).toHaveCount(0);
  await expect(addLink).toBeEnabled();
  await addLink.click();
  await expect(dialog(page).locator(".link-card")).toContainText("Import CSV");
  await expect(picker).toHaveValue("");
  await picker.fill("sav-000002");
  await expect(options).toHaveText([/SAV-000002.*Other bug/]);
  await dialog(page).getByRole("option", { name: /Other bug/ }).click();
  await expect(picker).toHaveValue("SAV-000002 · Other bug");
  await dialog(page)
    .getByRole("button", { name: "Clear selected item", exact: true })
    .click();
  await expect(picker).toHaveValue("");
  await expect(addLink).toBeDisabled();
  await picker.fill("nothing here");
  await expect(
    dialog(page).getByText("No matching items", { exact: true }),
  ).toBeVisible();
  await expect(options).toHaveCount(0);
  await picker.fill("audit");
  await picker.press("Enter");
  await expect(picker).toHaveValue("Feature · Audit log");
  await addLink.click();
  await expect(dialog(page).locator(".link-card")).toHaveCount(2);
  await expect(dialog(page).locator(".link-card").last()).toContainText(
    "Audit log",
  );
});

test("nested tickets link back to every ancestor from the root down", async ({
  page,
}) => {
  await login(page);
  const platform = await create(page, { title: "Platform" });
  const auth = await create(page, { title: "Auth", parentId: platform.id });
  const sso = await create(page, { title: "SSO", parentId: auth.id });
  await page.goto(`/?item=${sso.id}`);
  const parents = dialog(page).getByRole("navigation", {
    name: "Parent items",
    exact: true,
  });
  await expect(
    dialog(page).getByRole("heading", { name: "SSO", exact: true }),
  ).toBeVisible();
  await expect(parents.getByRole("button")).toHaveText(["Platform", "Auth"]);
  await parents.getByRole("button", { name: "Auth", exact: true }).click();
  await expect(
    dialog(page).getByRole("heading", { name: "Auth", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`item=${auth.id}`));
  await expect(parents.getByRole("button")).toHaveText(["Platform"]);
  await parents.getByRole("button", { name: "Platform", exact: true }).click();
  await expect(
    dialog(page).getByRole("heading", { name: "Platform", exact: true }),
  ).toBeVisible();
  await expect(parents).toHaveCount(0);
  await dialog(page).getByRole("button", { name: "Auth", exact: true }).click();
  await expect(
    dialog(page).getByRole("heading", { name: "Auth", exact: true }),
  ).toBeVisible();
  await expect(parents.getByRole("button")).toHaveText(["Platform"]);
});
