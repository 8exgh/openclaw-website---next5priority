import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "./events.ts";
import { appendEvent } from "./events.ts";
import {
  setAvailability,
  availableSlots,
  requestBooking,
  confirmBooking,
  declineBooking,
  findBookingByConfirmToken,
  cancelBooking,
  listBookings,
} from "./booking.ts";

// Mon-Fri 09:00-11:00 UTC, 30-minute slots. (weekday 1..5)
const AVAIL = {
  weekly: {
    1: [{ start: "09:00", end: "11:00" }],
    2: [{ start: "09:00", end: "11:00" }],
    3: [{ start: "09:00", end: "11:00" }],
    4: [{ start: "09:00", end: "11:00" }],
    5: [{ start: "09:00", end: "11:00" }],
  },
  slotMinutes: 30,
};

// A known Monday.
const MONDAY = "2026-08-17T00:00:00.000Z";

function fresh() {
  return openDb(":memory:");
}

test("no availability yields no slots and rejects booking", () => {
  const db = fresh();
  assert.deepEqual(availableSlots(db, MONDAY, 7), []);
  const r = requestBooking(db, { slotStart: "2026-08-17T09:00:00.000Z", name: "A", email: "a@x.com" });
  assert.equal(r.ok, false);
});

test("availability generates the expected slots", () => {
  const db = fresh();
  setAvailability(db, AVAIL);
  // One Monday: 09:00, 09:30, 10:00, 10:30 = 4 slots (10:30+30=11:00 ok; 11:00 would overflow).
  const monday = availableSlots(db, MONDAY, 1);
  assert.deepEqual(monday, [
    "2026-08-17T09:00:00.000Z",
    "2026-08-17T09:30:00.000Z",
    "2026-08-17T10:00:00.000Z",
    "2026-08-17T10:30:00.000Z",
  ]);
});

test("booking a slot removes it and blocks a second booking (no double-book)", () => {
  const db = fresh();
  setAvailability(db, AVAIL);
  const slot = "2026-08-17T09:30:00.000Z";
  const r1 = requestBooking(db, { slotStart: slot, name: "First", email: "first@x.com" });
  assert.equal(r1.ok, true);
  assert.ok(!availableSlots(db, MONDAY, 1).includes(slot));
  const r2 = requestBooking(db, { slotStart: slot, name: "Second", email: "second@x.com" });
  assert.equal(r2.ok, false);
  assert.equal(r2.ok === false && r2.error, "slot_taken");
  // A request holds the slot while it waits for the owner.
  assert.equal(listBookings(db).filter((b) => b.status === "pending").length, 1);
});

test("a request is pending and the owner confirms it through the token, not an id", () => {
  const db = fresh();
  setAvailability(db, AVAIL);
  const r = requestBooking(db, { slotStart: "2026-08-17T09:00:00.000Z", name: "A", email: "a@x.com" });
  assert.equal(r.ok, true);
  // The token lives only in the log; the command result does not carry it.
  assert.ok(!("confirmToken" in r));
  const b = listBookings(db)[0];
  assert.equal(b.status, "pending");
  assert.ok(b.confirmToken && b.confirmToken.length >= 32);
  assert.equal(findBookingByConfirmToken(db, b.confirmToken!)?.bookingId, b.bookingId);
  // The booking id is not a credential.
  assert.equal(confirmBooking(db, b.bookingId).ok, false);
  assert.equal(confirmBooking(db, "").ok, false);
  const c = confirmBooking(db, b.confirmToken!);
  assert.equal(c.ok, true);
  assert.equal(listBookings(db)[0].status, "confirmed");
  // Still holds the slot.
  assert.ok(!availableSlots(db, MONDAY, 1).includes("2026-08-17T09:00:00.000Z"));
  // Deciding twice is a no-op with a reason.
  const again = confirmBooking(db, b.confirmToken!);
  assert.equal(again.ok, false);
  assert.equal(again.ok === false && again.error, "not_pending");
  assert.equal(declineBooking(db, b.confirmToken!).ok, false);
});

test("declining frees the slot and a new request gets a fresh token", () => {
  const db = fresh();
  setAvailability(db, AVAIL);
  const slot = "2026-08-17T09:30:00.000Z";
  requestBooking(db, { slotStart: slot, name: "A", email: "a@x.com" });
  const first = listBookings(db)[0];
  assert.ok(!availableSlots(db, MONDAY, 1).includes(slot));
  assert.equal(declineBooking(db, first.confirmToken!).ok, true);
  assert.equal(listBookings(db)[0].status, "declined");
  assert.ok(availableSlots(db, MONDAY, 1).includes(slot));
  const r2 = requestBooking(db, { slotStart: slot, name: "B", email: "b@x.com" });
  assert.equal(r2.ok, true);
  const second = listBookings(db).find((b) => b.name === "B")!;
  assert.notEqual(second.confirmToken, first.confirmToken);
  // The old token cannot touch the new booking.
  assert.equal(confirmBooking(db, first.confirmToken!).ok, false);
  assert.equal(second.status, "pending");
});

test("a booking_requested event from before confirmation existed folds as confirmed", () => {
  const db = fresh();
  setAvailability(db, AVAIL);
  appendEvent(db, "booking_requested", {
    bookingId: "legacy-1",
    slotStart: "2026-08-17T10:00:00.000Z",
    slotMinutes: 30,
    name: "Old",
    email: "old@x.com",
    phone: null,
    note: null,
  });
  const b = listBookings(db)[0];
  assert.equal(b.status, "confirmed");
  assert.equal(b.confirmToken, undefined);
  assert.ok(!availableSlots(db, MONDAY, 1).includes("2026-08-17T10:00:00.000Z"));
});

test("rejects slots outside availability", () => {
  const db = fresh();
  setAvailability(db, AVAIL);
  // 11:00 is past the window end for a 30-min slot; Sunday has no window.
  assert.equal(requestBooking(db, { slotStart: "2026-08-17T11:00:00.000Z", name: "X", email: "x@x.com" }).ok, false);
  assert.equal(requestBooking(db, { slotStart: "2026-08-16T09:00:00.000Z", name: "Y", email: "y@x.com" }).ok, false);
  // off-grid minute
  assert.equal(requestBooking(db, { slotStart: "2026-08-17T09:15:00.000Z", name: "Z", email: "z@x.com" }).ok, false);
});

test("cancelling frees the slot for rebooking", () => {
  const db = fresh();
  setAvailability(db, AVAIL);
  const slot = "2026-08-17T10:00:00.000Z";
  const r = requestBooking(db, { slotStart: slot, name: "First", email: "first@x.com" });
  assert.equal(r.ok, true);
  const id = r.ok ? r.bookingId : "";
  assert.equal(cancelBooking(db, id, "owner"), true);
  assert.equal(cancelBooking(db, id, "owner"), false); // already cancelled
  assert.ok(availableSlots(db, MONDAY, 1).includes(slot));
  assert.equal(requestBooking(db, { slotStart: slot, name: "Second", email: "second@x.com" }).ok, true);
  // A cancelled booking cannot be confirmed later by its (now dead) token.
  const cancelled = listBookings(db).find((b) => b.bookingId === id)!;
  assert.equal(confirmBooking(db, cancelled.confirmToken!).ok, false);
});

test("event log is the source of truth (rebuild from a reopened db handle)", () => {
  const db = openDb("/tmp/oc-booking-test.db");
  db.exec("DELETE FROM events");
  setAvailability(db, AVAIL);
  requestBooking(db, { slotStart: "2026-08-17T09:00:00.000Z", name: "Persisted", email: "p@x.com" });
  db.close();
  const reopened = openDb("/tmp/oc-booking-test.db");
  assert.equal(listBookings(reopened).length, 1);
  assert.equal(listBookings(reopened)[0].name, "Persisted");
  reopened.close();
});
