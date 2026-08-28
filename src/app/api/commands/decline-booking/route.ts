import { NextRequest, NextResponse, after } from "next/server";
import { siteDb } from "../../../../lib/site.ts";
import { declineBooking } from "../../../../lib/booking.ts";
import { notifyInBackground } from "../../../../lib/notification-processor.ts";

/* Owner turns a request down; the slot opens again and the visitor is
   emailed to pick another time. Token-authorized, same as confirm. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const token = typeof body?.token === "string" ? body.token : "";
  if (!token) return NextResponse.json({ error: "token is required" }, { status: 400 });
  const db = siteDb();
  try {
    const r = declineBooking(db, token);
    if (!r.ok) {
      return NextResponse.json(
        { error: r.error, status: r.booking?.status ?? null },
        { status: r.error === "not_found" ? 404 : 409 }
      );
    }
    after(() => notifyInBackground(process.env.SITE_URL || request.nextUrl.origin));
    return NextResponse.json({ ok: true, status: r.booking.status });
  } finally {
    db.close();
  }
}
