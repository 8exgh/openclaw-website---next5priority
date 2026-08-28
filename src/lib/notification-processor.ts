import type Database from "better-sqlite3";
import { listBookings, type Booking } from "./booking.ts";
import { owedNotifications, sentNotifications, recordSent, type Notification } from "./booking-notifications.ts";
import { site } from "./config.ts";
import { postToClaw } from "./rocketchat.ts";
import { sendEmail, type EmailMessage } from "./email.ts";
import { siteDb } from "./site.ts";
import * as render from "./booking-messages.ts";

/* Background processor for booking notifications.

   Runs in three places: kicked right after a booking command responds
   (next/server `after`); every few minutes from the in-process scheduler
   (scheduler.ts); and on demand via /api/jobs/notify or /api/jobs/tick.
   The sweeps pick up anything a kick missed, such as an email provider
   that was down or not yet configured.

   Senders are injectable so the tests exercise the deliver-then-record loop
   with fakes and no network. */

export type Senders = {
  rocketchat: (text: string) => Promise<boolean>;
  email: (msg: EmailMessage) => Promise<boolean>;
};

export type NotifyOptions = Partial<Senders> & {
  siteUrl?: string; // absolute origin for links; defaults to SITE_URL
  ownerEmail?: string; // defaults to site.ownerEmail
  businessName?: string;
  timeZone?: string;
};

export type NotifyResult = { owed: number; sent: number; failed: number };

type Ctx = render.MessageContext & { ownerEmail: string };

async function deliver(n: Notification, b: Booking, ctx: Ctx, senders: Senders): Promise<{ ok: boolean; to: string }> {
  switch (n.kind) {
    case "owner_requested": {
      if (!ctx.siteUrl) {
        console.warn("SITE_URL not set; owner booking notification deferred (no origin for the confirm link)");
        return { ok: false, to: "" };
      }
      const confirmUrl = `${ctx.siteUrl}/confirm/${b.confirmToken}`;
      if (n.channel === "rocketchat") {
        return { ok: await senders.rocketchat(render.ownerRequestedChat(b, confirmUrl, ctx)), to: "claw" };
      }
      const to = ctx.ownerEmail;
      if (!to) return { ok: false, to };
      return { ok: await senders.email({ to, ...render.ownerRequestedEmail(b, confirmUrl, ctx) }), to };
    }
    case "visitor_requested":
      return {
        ok: await senders.email({ to: b.email, replyTo: ctx.ownerEmail || undefined, ...render.visitorRequestedEmail(b, ctx) }),
        to: b.email,
      };
    case "visitor_confirmed":
      return {
        ok: await senders.email({ to: b.email, replyTo: ctx.ownerEmail || undefined, ...render.visitorConfirmedEmail(b, ctx) }),
        to: b.email,
      };
    case "visitor_declined":
      return {
        ok: await senders.email({ to: b.email, replyTo: ctx.ownerEmail || undefined, ...render.visitorDeclinedEmail(b, ctx) }),
        to: b.email,
      };
  }
}

async function runOnce(db: Database.Database, opts: NotifyOptions): Promise<NotifyResult> {
  const senders: Senders = { rocketchat: opts.rocketchat ?? postToClaw, email: opts.email ?? sendEmail };
  const ctx: Ctx = {
    siteUrl: (opts.siteUrl ?? process.env.SITE_URL ?? "").replace(/\/+$/, ""),
    // Deploy-time env (from 8examples' record of the customer) wins over the
    // committed config, so a re-deploy can correct it without a commit.
    ownerEmail: opts.ownerEmail ?? process.env.OWNER_EMAIL ?? site.ownerEmail,
    businessName: opts.businessName ?? site.businessName,
    timeZone: opts.timeZone ?? site.timeZone,
  };
  const bookings = new Map(listBookings(db).map((b) => [b.bookingId, b]));
  const owed = owedNotifications([...bookings.values()], sentNotifications(db), { ownerEmail: ctx.ownerEmail });
  let sent = 0;
  let failed = 0;
  for (const n of owed) {
    const b = bookings.get(n.bookingId);
    if (!b) continue;
    const r = await deliver(n, b, ctx, senders).catch((err) => {
      console.error(`notification ${n.kind}/${n.channel} for ${n.bookingId} failed:`, err);
      return { ok: false, to: "" };
    });
    if (r.ok) {
      recordSent(db, n, r.to);
      sent++;
    } else {
      failed++;
    }
  }
  return { owed: owed.length, sent, failed };
}

/* Runs are serialized within the process. A kick from a command and a cron
   sweep landing together would otherwise both see the same owed list and
   double-send before either recorded. */
let chain: Promise<unknown> = Promise.resolve();

export function runBookingNotifications(db: Database.Database, opts: NotifyOptions = {}): Promise<NotifyResult> {
  const run = () => runOnce(db, opts);
  const p = chain.then(run, run);
  chain = p.catch(() => undefined);
  return p;
}

/* For `after()` in the command routes: opens its own handle (the route's is
   closed by then) and never throws into the response path. */
export async function notifyInBackground(siteUrl?: string): Promise<void> {
  const db = siteDb();
  try {
    const r = await runBookingNotifications(db, { siteUrl });
    if (r.failed) console.warn(`booking notifications: ${r.sent} sent, ${r.failed} still owed (retried on next sweep)`);
  } catch (err) {
    console.error("booking notifications failed:", err);
  } finally {
    db.close();
  }
}
