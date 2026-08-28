import type Database from "better-sqlite3";
import { appendEvent, readEvents } from "./events.ts";
import type { Booking } from "./booking.ts";

/* Booking notifications, event-sourced.

   The command side (requestBooking, confirmBooking, declineBooking) only
   appends booking events. What each booking OWES in notifications is a pure
   function of its current status; what has already gone out is the replay of
   `notification_sent` events. The difference is the work list for the
   background processor (notification-processor.ts).

   Deliver-then-record: `notification_sent` is appended only after the channel
   accepted the message, so a failed or unconfigured channel just stays owed
   and is retried on the next run. At-least-once, never silently lost. */

export type NotificationKind =
  | "owner_requested" // a new request needs the owner's yes/no (carries the confirm link)
  | "visitor_requested" // "we got your request"
  | "visitor_confirmed" // "you're booked in"
  | "visitor_declined"; // "that time didn't work out"

export type Channel = "rocketchat" | "email";

export type Notification = { bookingId: string; kind: NotificationKind; channel: Channel };

const NOTIFICATION_TYPES = ["notification_sent"];

export const notificationKey = (n: Notification) => `${n.bookingId}:${n.kind}:${n.channel}`;

export function sentNotifications(db: Database.Database): Set<string> {
  const out = new Set<string>();
  for (const e of readEvents(db, NOTIFICATION_TYPES)) {
    out.add(notificationKey(e.data as unknown as Notification));
  }
  return out;
}

/* Each status owes a fixed set; anything already recorded is subtracted.
   Pure, so the rules are testable without I/O. */
export function owedNotifications(
  bookings: Booking[],
  sent: Set<string>,
  opts: { ownerEmail?: string } = {}
): Notification[] {
  const owed: Notification[] = [];
  for (const b of bookings) {
    // Pre-confirmation bookings (no token) folded straight to confirmed and
    // were never promised anything; do not retroactively email them.
    if (!b.confirmToken) continue;
    const want: Notification[] = [];
    const n = (kind: NotificationKind, channel: Channel) => want.push({ bookingId: b.bookingId, kind, channel });
    if (b.status === "pending") {
      n("owner_requested", "rocketchat");
      if (opts.ownerEmail) n("owner_requested", "email");
      n("visitor_requested", "email");
    } else if (b.status === "confirmed") {
      n("visitor_confirmed", "email");
    } else if (b.status === "declined") {
      n("visitor_declined", "email");
    }
    for (const x of want) if (!sent.has(notificationKey(x))) owed.push(x);
  }
  return owed;
}

export function recordSent(db: Database.Database, n: Notification, to: string, at?: string): void {
  appendEvent(db, "notification_sent", { ...n, to }, at);
}
