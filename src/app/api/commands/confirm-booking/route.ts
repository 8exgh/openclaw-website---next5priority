import { NextRequest, NextResponse, after } from "next/server";
import { siteDb } from "../../../../lib/site.ts";
import { confirmBooking } from "../../../../lib/booking.ts";
import { notifyInBackground } from "../../../../lib/notification-processor.ts";

/* Owner accepts a request. No login: the confirm token in the body (from the
   /confirm/<token> link the owner was sent) is the authorization. The
   visitor's "you're booked in" email is owed by the new status and goes out
   in the background. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const token = typeof body?.token === "string" ? body.token : "";
  if (!token) return NextResponse.json({ error: "token is required" }, { status: 400 });
  const db = siteDb();
  try {
    const r = confirmBooking(db, token);
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
