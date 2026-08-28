import { NextRequest, NextResponse, after } from "next/server";
import { siteDb } from "../../../../lib/site.ts";
import { requestBooking } from "../../../../lib/booking.ts";
import { notifyInBackground } from "../../../../lib/notification-processor.ts";

/* Public: a visitor asks for a slot. The command is complete once the
   `booking_requested` event is in the log; everything that follows (owner
   ping with the confirm link, visitor "we got it" email) is background work,
   kicked after the response and swept by cron if the kick fails. The confirm
   token never appears in this response, so a visitor cannot confirm their
   own booking. */

const LIMITS = { name: 200, email: 320, phone: 50, note: 2000 };
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const slotStart = typeof body?.slotStart === "string" ? body.slotStart : "";
  const name = str(body?.name, LIMITS.name);
  const email = str(body?.email, LIMITS.email);
  const phone = str(body?.phone, LIMITS.phone);
  const note = str(body?.note, LIMITS.note);
  if (!slotStart || !name || !email) {
    return NextResponse.json({ error: "slotStart, name, and email are required" }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }
  const db = siteDb();
  try {
    const r = requestBooking(db, { slotStart, name, email, phone: phone || undefined, note: note || undefined });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
    const siteUrl = process.env.SITE_URL || request.nextUrl.origin;
    after(() => notifyInBackground(siteUrl));
    return NextResponse.json({ ok: true, bookingId: r.bookingId, status: "pending" }, { status: 201 });
  } finally {
    db.close();
  }
}
