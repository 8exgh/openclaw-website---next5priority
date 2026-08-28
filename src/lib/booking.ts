import type Database from "better-sqlite3";
import crypto from "node:crypto";
import { appendEvent, readEvents } from "./events.ts";

/* Event-sourced self-booking.
   Events: availability_set, booking_requested, booking_confirmed,
   booking_declined, booking_cancelled.

   A request lands as `pending` and holds its slot. The owner confirms or
   declines it through a link carrying the booking's confirm token: the token
   is the whole auth (UUID v4, unguessable, never sent to the visitor), so the
   owner needs no password. Notifications are not sent here; they are owed
   by status and delivered by the background processor (booking-notifications.ts).

   The available-slots view is derived by replay; requestBooking folds and
   appends inside one transaction so two visitors can never take the same
   slot (the claw-assignment guarantee, applied to time). */

const BOOKING_TYPES = [
  "availability_set",
  "booking_requested",
  "booking_confirmed",
  "booking_declined",
  "booking_cancelled",
];

export type Window = { start: string; end: string }; // "HH:MM" 24h, UTC wall-clock
export type Availability = {
  // weekday 0=Sun .. 6=Sat -> bookable windows
  weekly: Record<number, Window[]>;
  slotMinutes: number;
};

export type BookingStatus = "pending" | "confirmed" | "declined" | "cancelled";

export type Booking = {
  bookingId: string;
  slotStart: string; // ISO instant
  slotMinutes: number;
  name: string;
  email: string;
  phone?: string;
  note?: string;
  status: BookingStatus;
  /* Owner-side secret behind /confirm/<token>. Absent on bookings made before
     confirmation existed; those fold straight to `confirmed` (old semantics)
     and owe no notifications. */
  confirmToken?: string;
};

/* Pending and confirmed bookings hold their slot; declined and cancelled free it. */
export const holdsSlot = (status: BookingStatus) => status === "pending" || status === "confirmed";

type State = {
  availability: Availability | null;
  bookings: Map<string, Booking>;
  bookedSlots: Set<string>; // slotStart ISO of bookings that hold a slot
};

function fold(db: Database.Database): State {
  const state: State = { availability: null, bookings: new Map(), bookedSlots: new Set() };
  for (const e of readEvents(db, BOOKING_TYPES)) {
    if (e.type === "availability_set") {
      state.availability = { weekly: e.data.weekly as Availability["weekly"], slotMinutes: e.data.slotMinutes as number };
    } else if (e.type === "booking_requested") {
      const confirmToken = (e.data.confirmToken as string | undefined) || undefined;
      const b: Booking = {
        bookingId: e.data.bookingId as string,
        slotStart: e.data.slotStart as string,
        slotMinutes: e.data.slotMinutes as number,
        name: e.data.name as string,
        email: e.data.email as string,
        phone: (e.data.phone as string | null) ?? undefined,
        note: (e.data.note as string | null) ?? undefined,
        status: confirmToken ? "pending" : "confirmed",
        confirmToken,
      };
      state.bookings.set(b.bookingId, b);
      state.bookedSlots.add(b.slotStart);
    } else if (e.type === "booking_confirmed") {
      const b = state.bookings.get(e.data.bookingId as string);
      if (b && b.status === "pending") b.status = "confirmed";
    } else if (e.type === "booking_declined") {
      const b = state.bookings.get(e.data.bookingId as string);
      if (b && b.status === "pending") {
        b.status = "declined";
        state.bookedSlots.delete(b.slotStart);
      }
    } else if (e.type === "booking_cancelled") {
      const b = state.bookings.get(e.data.bookingId as string);
      if (b && holdsSlot(b.status)) {
        b.status = "cancelled";
        state.bookedSlots.delete(b.slotStart);
      }
    }
  }
  return state;
}

export function setAvailability(db: Database.Database, a: Availability): void {
  appendEvent(db, "availability_set", a);
}

export function getAvailability(db: Database.Database): Availability | null {
  return fold(db).availability;
}

/* Whether an ISO instant falls on a bookable slot boundary within a window. */
function slotIsValid(a: Availability, slotStart: string): boolean {
  const d = new Date(slotStart);
  if (Number.isNaN(d.getTime())) return false;
  const windows = a.weekly[d.getUTCDay()] ?? [];
  const minuteOfDay = d.getUTCHours() * 60 + d.getUTCMinutes();
  if (d.getUTCSeconds() !== 0 || d.getUTCMilliseconds() !== 0) return false;
  for (const w of windows) {
    const [sh, sm] = w.start.split(":").map(Number);
    const [eh, em] = w.end.split(":").map(Number);
    const startM = sh * 60 + sm;
    const endM = eh * 60 + em;
    if (minuteOfDay < startM || minuteOfDay + a.slotMinutes > endM) continue;
    if ((minuteOfDay - startM) % a.slotMinutes === 0) return true;
  }
  return false;
}

/* Candidate slot instants over the next `days`, minus past and booked. */
export function availableSlots(db: Database.Database, fromISO: string, days: number): string[] {
  const state = fold(db);
  const a = state.availability;
  if (!a) return [];
  const from = new Date(fromISO);
  const out: string[] = [];
  for (let dayOffset = 0; dayOffset < days; dayOffset++) {
    const day = new Date(from);
    day.setUTCDate(from.getUTCDate() + dayOffset);
    const windows = a.weekly[day.getUTCDay()] ?? [];
    for (const w of windows) {
      const [sh, sm] = w.start.split(":").map(Number);
      const [eh, em] = w.end.split(":").map(Number);
      for (let m = sh * 60 + sm; m + a.slotMinutes <= eh * 60 + em; m += a.slotMinutes) {
        const slot = new Date(day);
        slot.setUTCHours(Math.floor(m / 60), m % 60, 0, 0);
        const iso = slot.toISOString();
        if (slot.getTime() < from.getTime()) continue;
        if (state.bookedSlots.has(iso)) continue;
        out.push(iso);
      }
    }
  }
  return out;
}

export type BookResult = { ok: true; bookingId: string } | { ok: false; error: string };

/* Records the request as `pending`. The confirm token is minted here and
   lives only in the event log; it is deliberately not part of the result so
   no API path can hand it to the visitor. */
export function requestBooking(
  db: Database.Database,
  input: { slotStart: string; name: string; email: string; phone?: string; note?: string }
): BookResult {
  return db.transaction((): BookResult => {
    const state = fold(db);
    const a = state.availability;
    if (!a) return { ok: false, error: "no_availability" };
    if (!slotIsValid(a, input.slotStart)) return { ok: false, error: "invalid_slot" };
    if (state.bookedSlots.has(input.slotStart)) return { ok: false, error: "slot_taken" };
    const bookingId = crypto.randomUUID();
    const confirmToken = crypto.randomUUID();
    appendEvent(db, "booking_requested", {
      bookingId,
      slotStart: input.slotStart,
      slotMinutes: a.slotMinutes,
      name: input.name,
      email: input.email,
      phone: input.phone ?? null,
      note: input.note ?? null,
      confirmToken,
    });
    return { ok: true, bookingId };
  })();
}

export function findBookingByConfirmToken(db: Database.Database, token: string): Booking | null {
  if (!token) return null;
  for (const b of fold(db).bookings.values()) if (b.confirmToken === token) return b;
  return null;
}

export type RespondResult =
  | { ok: true; booking: Booking }
  | { ok: false; error: "not_found" | "not_pending"; booking?: Booking };

function respond(
  db: Database.Database,
  token: string,
  eventType: "booking_confirmed" | "booking_declined",
  next: BookingStatus
): RespondResult {
  return db.transaction((): RespondResult => {
    const b = findBookingByConfirmToken(db, token);
    if (!b) return { ok: false, error: "not_found" };
    if (b.status !== "pending") return { ok: false, error: "not_pending", booking: b };
    appendEvent(db, eventType, { bookingId: b.bookingId, by: "owner" });
    return { ok: true, booking: { ...b, status: next } };
  })();
}

/* Owner accepts the request. Token-authenticated; only a pending booking can move. */
export function confirmBooking(db: Database.Database, token: string): RespondResult {
  return respond(db, token, "booking_confirmed", "confirmed");
}

/* Owner turns the request down; the slot opens up again. */
export function declineBooking(db: Database.Database, token: string): RespondResult {
  return respond(db, token, "booking_declined", "declined");
}

/* Trusted-side cancel by id (the claw, or a future admin). Works on pending
   or confirmed bookings and frees the slot. */
export function cancelBooking(db: Database.Database, bookingId: string, by: string): boolean {
  const state = fold(db);
  const b = state.bookings.get(bookingId);
  if (!b || !holdsSlot(b.status)) return false;
  appendEvent(db, "booking_cancelled", { bookingId, by });
  return true;
}

export function listBookings(db: Database.Database): Booking[] {
  return [...fold(db).bookings.values()].sort((x, y) => x.slotStart.localeCompare(y.slotStart));
}
