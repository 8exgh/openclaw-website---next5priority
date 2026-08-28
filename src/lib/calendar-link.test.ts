import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "./events.ts";
import { setAvailability, requestBooking, confirmBooking, declineBooking, listBookings } from "./booking.ts";
import { issueCalendarLink, validateCalendarLink, revokeCalendarLink, calendarFor } from "./calendar-link.ts";

const AVAIL = { weekly: { 1: [{ start: "09:00", end: "11:00" }] }, slotMinutes: 30 };

test("a fresh link validates and yields the calendar; a random token does not", () => {
  const db = openDb(":memory:");
  const { token } = issueCalendarLink(db);
  assert.equal(validateCalendarLink(db, token), true);
  assert.equal(validateCalendarLink(db, crypto.randomUUID()), false);
  assert.ok(Array.isArray(calendarFor(db, token)));
});

test("a link is dead after 24 hours", () => {
  const db = openDb(":memory:");
  const base = Date.UTC(2026, 0, 1, 12, 0, 0);
  const { token } = issueCalendarLink(db, base);
  assert.equal(validateCalendarLink(db, token, base + 23 * 3600_000), true);
  assert.equal(validateCalendarLink(db, token, base + 25 * 3600_000), false);
  assert.equal(calendarFor(db, token, base + 25 * 3600_000), null);
});

test("revoked link stops working immediately", () => {
  const db = openDb(":memory:");
  const { token } = issueCalendarLink(db);
  revokeCalendarLink(db, token);
  assert.equal(validateCalendarLink(db, token), false);
});

test("calendar shows pending and confirmed bookings, not declined ones", () => {
  const db = openDb(":memory:");
  setAvailability(db, AVAIL);
  requestBooking(db, { slotStart: "2026-08-17T09:00:00.000Z", name: "A", email: "a@x.com" });
  requestBooking(db, { slotStart: "2026-08-17T09:30:00.000Z", name: "B", email: "b@x.com" });
  const [a, b] = listBookings(db);
  confirmBooking(db, a.confirmToken!);
  const { token } = issueCalendarLink(db);
  assert.deepEqual(calendarFor(db, token)!.map((x) => x.status), ["confirmed", "pending"]);
  declineBooking(db, b.confirmToken!);
  assert.deepEqual(calendarFor(db, token)!.map((x) => x.status), ["confirmed"]);
});

import crypto from "node:crypto";
