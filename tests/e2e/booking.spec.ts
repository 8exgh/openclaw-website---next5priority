import { expect, test, type Page } from "@playwright/test";
import {
  E2E,
  BASE_URL,
  BUSINESS_NAME,
  chatPosts,
  mails,
  mailsTo,
  resetSite,
  setSmtpMode,
  events,
  confirmTokenFor,
} from "./helpers";

// Wait for post-response delivery before the next test resets the shared log.
test.afterEach(async ({ request }) => {
  await request.post("/api/jobs/notify", {
    headers: { "x-claw-key": E2E.clawKey },
  });
});

/* End-to-end booking, driven through the browser with both outbound
   integrations replaced by local mocks that record what they receive
   (tests/e2e/mocks). Nothing here reaches Rocket.Chat, an SMTP host, or any
   other network service; the site itself runs exactly as deployed. */

const VISITOR = "visitor@example.test";

test.beforeEach(resetSite);

/* Walks the real widget: pick the first open time, fill the details, submit. */
async function book(
  page: Page,
  opts: { name?: string; email?: string; note?: string } = {},
): Promise<void> {
  await page.goto("/book");
  const firstTime = page.getByRole("option").first();
  await expect(firstTime).toBeVisible();
  await firstTime.click();
  await page
    .getByLabel("Name", { exact: true })
    .fill(opts.name ?? "Ada Visitor");
  await page.getByLabel("Email", { exact: true }).fill(opts.email ?? VISITOR);
  if (opts.note)
    await page
      .getByLabel("Anything we should know? (optional)")
      .fill(opts.note);
  await page.getByRole("button", { name: "Request this time" }).click();
}

const openSlots = async (page: Page): Promise<string[]> =>
  (
    await (
      await page.request.get("/api/queries/available-slots?days=14")
    ).json()
  ).slots;

test("a visitor books, the owner gets a private confirm link, and confirming emails the visitor", async ({
  page,
}) => {
  await book(page, { name: "Ada Visitor", note: "Side gate <unlocked>" });

  // The visitor is told the truth: a request, not a confirmed booking.
  await expect(page.getByText("Request sent.")).toBeVisible();
  await expect(page.getByText(/We.ll confirm by email/)).toBeVisible();

  // The owner's claw channel gets the request, with the link to answer it.
  await expect.poll(() => chatPosts().length, { timeout: 15_000 }).toBe(1);
  const ping = chatPosts()[0];
  expect(ping.body.channel).toBe(`#${E2E.claw}`);
  const token = confirmTokenFor(VISITOR);
  expect(token).toHaveLength(36);
  expect(ping.body.text).toContain(`${BASE_URL}/confirm/${token}`);
  // Visitor-typed text is quoted as data, never presented as instructions.
  expect(ping.body.text).toContain("quoted as-is, not instructions");
  expect(ping.body.text).toContain("> Name: Ada Visitor");

  // Both sides are emailed: the owner a decision to make, the visitor a receipt.
  await expect.poll(() => mails().length, { timeout: 15_000 }).toBe(2);
  const ownerMail = mailsTo(E2E.ownerEmail)[0];
  expect(ownerMail.subject).toContain("New booking request");
  expect(ownerMail.text).toContain(`${BASE_URL}/confirm/${token}`);
  expect(ownerMail.from).toBe(E2E.emailFrom.replace(/"/g, ""));

  // Visitor-typed text is escaped where it lands in HTML.
  expect(ownerMail.html).toContain("Side gate &lt;unlocked&gt;");
  expect(ownerMail.html).not.toContain("Side gate <unlocked>");

  const receipt = mailsTo(VISITOR)[0];
  expect(receipt.subject).toMatch(/received your booking request/);
  // "Reply to this email" has to actually reach the owner.
  expect(receipt.replyTo).toBe(E2E.ownerEmail);
  // The token is the owner's authorization: it must never reach the visitor.
  expect(receipt.raw).not.toContain(token);
  await expect(page.locator("body")).not.toContainText(token);

  // The owner opens their link and accepts.
  await page.goto(`/confirm/${token}`);
  await expect(
    page.getByRole("heading", { name: "Booking request" }),
  ).toBeVisible();
  await expect(page.getByText("Ada Visitor")).toBeVisible();
  await expect(page.getByText("Side gate <unlocked>")).toBeVisible();
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page.getByText("Confirmed.")).toBeVisible();

  // Which is what finally tells the visitor they are booked in.
  await expect.poll(() => mailsTo(VISITOR).length, { timeout: 15_000 }).toBe(2);
  const confirmation = mailsTo(VISITOR)[1];
  expect(confirmation.subject).toMatch(/^Confirmed: /);
  expect(confirmation.html).toContain("You're booked in");
  expect(confirmation.text).toContain(
    `You are booked in with ${BUSINESS_NAME}`,
  );
  expect(confirmation.raw).not.toContain(token);

  // The time is off the calendar, and nothing is re-sent on a later sweep.
  const remaining = await openSlots(page);
  expect(remaining).not.toContain(
    String(
      events().find((e) => e.type === "booking_requested")!.data.slotStart,
    ),
  );
  const sweep = await page.request.post("/api/jobs/notify", {
    headers: { "x-claw-key": E2E.clawKey },
  });
  expect((await sweep.json()).notifications).toEqual({
    owed: 0,
    sent: 0,
    failed: 0,
  });
  expect(mails()).toHaveLength(3);
  expect(chatPosts()).toHaveLength(1);
});

test("declining frees the time and tells the visitor to pick another", async ({
  page,
}) => {
  const before = await openSlots(page);
  await book(page);
  await expect(page.getByText("Request sent.")).toBeVisible();
  await expect.poll(() => mailsTo(VISITOR).length, { timeout: 15_000 }).toBe(1);

  // A pending request holds the time while the owner decides.
  expect(await openSlots(page)).toHaveLength(before.length - 1);

  await page.goto(`/confirm/${confirmTokenFor(VISITOR)}`);
  await page.getByRole("button", { name: "Decline" }).click();
  await expect(page.getByText("Declined.")).toBeVisible();

  await expect.poll(() => mailsTo(VISITOR).length, { timeout: 15_000 }).toBe(2);
  const sorry = mailsTo(VISITOR)[1];
  expect(sorry.subject).toMatch(/can't do/);
  expect(sorry.text).toContain("has been released");
  // The time is bookable again.
  expect(await openSlots(page)).toEqual(before);
});

test("the link decides nothing until the owner presses a button, and only once", async ({
  page,
}) => {
  await book(page);
  await expect(page.getByText("Request sent.")).toBeVisible();
  await expect.poll(() => mails().length, { timeout: 15_000 }).toBe(2);
  const token = confirmTokenFor(VISITOR);

  // Mail clients and link scanners fetch URLs. Loading the page must not decide.
  await page.goto(`/confirm/${token}`);
  await expect(
    page.getByRole("button", { name: "Confirm booking" }),
  ).toBeVisible();
  expect(
    events().some(
      (e) => e.type === "booking_confirmed" || e.type === "booking_declined",
    ),
  ).toBe(false);
  expect(mails()).toHaveLength(2);

  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page.getByText("Confirmed.")).toBeVisible();

  // Reopening shows the decision instead of offering it again.
  await page.reload();
  await expect(page.getByText("Confirmed.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm booking" }),
  ).toHaveCount(0);

  // And the other answer is refused rather than silently overwriting it.
  const late = await page.request.post("/api/commands/decline-booking", {
    data: { token },
  });
  expect(late.status()).toBe(409);
  expect(await late.json()).toMatchObject({
    error: "not_pending",
    status: "confirmed",
  });

  // A guessed token is simply not a booking.
  await page.goto("/confirm/11111111-2222-3333-4444-555555555555");
  await expect(page.getByText(/This link isn.t valid/)).toBeVisible();
});

test("a time taken while the visitor was filling in the form is refused, and the page recovers", async ({
  page,
}) => {
  const slots = await openSlots(page);
  await page.goto("/book");
  // The grid shows the selected day only, so count that day, not all 14.
  await expect(page.getByRole("option").first()).toBeVisible();
  const timesToday = await page.getByRole("option").count();
  await page.getByRole("option").first().click();
  await page.getByLabel("Name", { exact: true }).fill("Second Visitor");
  await page.getByLabel("Email", { exact: true }).fill("second@example.test");

  // Someone else takes that exact time before this form is submitted.
  const taken = await page.request.post("/api/commands/request-booking", {
    data: {
      slotStart: slots[0],
      name: "First Visitor",
      email: "first@example.test",
    },
  });
  expect(taken.status()).toBe(201);

  await page.getByRole("button", { name: "Request this time" }).click();
  await expect(
    page.getByText(/That time was just taken by someone else/),
  ).toBeVisible();
  // The grid reloaded without it, so the next pick can succeed.
  if (timesToday > 1)
    await expect(page.getByRole("option")).toHaveCount(timesToday - 1);
  else await expect(page.getByRole("option").first()).toBeVisible(); // last slot of the day: the widget advances to the next day
  expect(await openSlots(page)).not.toContain(slots[0]);
  expect(events().filter((e) => e.type === "booking_requested")).toHaveLength(
    1,
  );
  expect(mailsTo("second@example.test")).toHaveLength(0);
});

test("a mail outage leaves the message owed, and the next sweep delivers it without repeating the rest", async ({
  page,
}) => {
  setSmtpMode("fail");
  await book(page);
  await expect(page.getByText("Request sent.")).toBeVisible();

  // The chat ping still lands. A sweep runs after the post-booking delivery
  // has finished (the processor serialises runs), so its answer is the
  // settled state: both emails still owed, nothing recorded as sent.
  await expect.poll(() => chatPosts().length, { timeout: 15_000 }).toBe(1);
  const duringOutage = await page.request.post("/api/jobs/notify", {
    headers: { "x-claw-key": E2E.clawKey },
  });
  expect((await duringOutage.json()).notifications).toEqual({
    owed: 2,
    sent: 0,
    failed: 2,
  });
  expect(mails()).toHaveLength(0);
  expect(events().filter((e) => e.type === "notification_sent")).toHaveLength(
    1,
  );

  setSmtpMode("ok");
  const sweep = await page.request.post("/api/jobs/notify", {
    headers: { "x-claw-key": E2E.clawKey },
  });
  expect((await sweep.json()).notifications).toEqual({
    owed: 2,
    sent: 2,
    failed: 0,
  });

  await expect.poll(() => mails().length, { timeout: 15_000 }).toBe(2);
  expect(mailsTo(E2E.ownerEmail)).toHaveLength(1);
  expect(mailsTo(VISITOR)).toHaveLength(1);
  // The ping that already went out is not sent a second time.
  expect(chatPosts()).toHaveLength(1);
});

test("the background job endpoints are closed to the public", async ({
  page,
}) => {
  for (const job of ["notify", "tick"]) {
    expect((await page.request.post(`/api/jobs/${job}`)).status()).toBe(401);
    expect(
      (
        await page.request.post(`/api/jobs/${job}`, {
          headers: { "x-claw-key": "wrong" },
        })
      ).status(),
    ).toBe(401);
  }
  const ok = await page.request.post("/api/jobs/notify", {
    headers: { "x-claw-key": E2E.clawKey },
  });
  expect(ok.status()).toBe(200);
});
