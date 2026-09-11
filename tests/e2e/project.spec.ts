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
async function login(page: Page, email = E2E.ownerEmail) {
  await page.goto("/");
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
  await expect(
    page.getByRole("heading", { name: "Make the next five count." }),
  ).toBeVisible();
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

test("features stay separate; next five can reorder and move with capacity enforced on server", async ({
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
  const backlog = page.getByRole("region", { name: "Feature backlog" });
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
  await backlog
    .locator(".task-row")
    .filter({ hasText: "Waiting feature" })
    .getByRole("button", { name: "To Next 5" })
    .click();
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
  await page.getByRole("button", { name: /^Bugs/ }).click();
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
    .selectOption(feature.id);
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
  await page.getByRole("button", { name: /^Bugs/ }).click();
  await expect(
    page.getByRole("region", { name: "Bugs · P1 / P2" }),
  ).toContainText("Export loses accents");
  await page.getByLabel("Priority for SAV-000001").selectOption("P4");
  await expect(
    page.getByRole("region", { name: "Bugs · P3 / P4" }),
  ).toContainText("Export loses accents");
  await expect(
    page.getByRole("region", { name: "Bugs · P1 / P2" }),
  ).not.toContainText("Export loses accents");
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
  await page.getByRole("button", { name: /^Features/ }).click();
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
  await page.getByRole("button", { name: /^Bugs/ }).click();
  await expect(
    page
      .getByRole("region", { name: "Bugs · P1 / P2", exact: true })
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
  await page.getByRole("button", { name: /^Features/ }).click();
  const backlog = page.getByRole("region", {
    name: "Feature backlog",
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
  await close(page);
  await page.getByRole("button", { name: /^Bugs/ }).click();
  await expect(
    page
      .getByRole("region", { name: "Bugs · P3 / P4", exact: true })
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
    name: "Feature backlog",
    exact: true,
  });
  const rootToggle = next.getByRole("button", {
    name: "Expand subtasks for Priority parent",
    exact: true,
  });
  await expect(rootToggle).toHaveAttribute("aria-expanded", "false");
  await expect(next.locator(".task-title")).toHaveCount(1);
  await expect(backlog.locator(".task-title")).toHaveCount(1);
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
  await backlog
    .getByRole("button", {
      name: "Expand subtasks for Backlog parent",
      exact: true,
    })
    .click();
  await expect(
    backlog.getByRole("button", { name: "Backlog child", exact: true }),
  ).toBeVisible();
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
  await page.getByRole("button", { name: /^Bugs/ }).click();
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
  await page.getByRole("button", { name: /^Bugs/ }).click();
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
