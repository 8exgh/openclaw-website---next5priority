import type Database from "better-sqlite3";
import crypto from "node:crypto";
import { appendEvent, readEvents } from "./events.ts";
import { listBookings, holdsSlot, type Booking } from "./booking.ts";

/* Shareable owner-calendar links.
   The claw (trusted, holds CLAW_API_KEY) mints a link and sends it to the
   owner; the owner opens it with no login. Non-guessable (UUID v4),
   read-only (just their bookings), and it expires after 24 hours. */

const LINK_TYPES = ["calendar_link_issued", "calendar_link_revoked"];
const TTL_MS = 24 * 60 * 60 * 1000;

export function issueCalendarLink(db: Database.Database, now = Date.now()): { token: string; expiresAt: string } {
  const token = crypto.randomUUID();
  const expiresAt = new Date(now + TTL_MS).toISOString();
  appendEvent(db, "calendar_link_issued", { token, expiresAt });
  return { token, expiresAt };
}

export function validateCalendarLink(db: Database.Database, token: string, now = Date.now()): boolean {
  let expiresAt: string | null = null;
  let revoked = false;
  for (const e of readEvents(db, LINK_TYPES)) {
    if (e.data.token !== token) continue;
    if (e.type === "calendar_link_issued") expiresAt = e.data.expiresAt as string;
    if (e.type === "calendar_link_revoked") revoked = true;
  }
  if (!expiresAt || revoked) return false;
  return new Date(expiresAt).getTime() > now;
}

export function revokeCalendarLink(db: Database.Database, token: string): void {
  appendEvent(db, "calendar_link_revoked", { token });
}

/* Calendar payload for a valid link: everything holding a slot, so pending
   requests show up (with their confirm link) alongside confirmed bookings.
   Declined and cancelled are not on the calendar. */
export function calendarFor(db: Database.Database, token: string, now = Date.now()): Booking[] | null {
  if (!validateCalendarLink(db, token, now)) return null;
  return listBookings(db).filter((b) => holdsSlot(b.status));
}
