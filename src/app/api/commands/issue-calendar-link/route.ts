import { NextRequest, NextResponse } from "next/server";
import { siteDb } from "../../../../lib/site.ts";
import { issueCalendarLink } from "../../../../lib/calendar-link.ts";

/* Claw-only: the worker mints a shareable owner-calendar link. Gated by a
   shared secret the claw holds (CLAW_API_KEY), never exposed to the public. */
export async function POST(request: NextRequest) {
  const key = process.env.CLAW_API_KEY;
  if (!key || request.headers.get("x-claw-key") !== key) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = siteDb();
  try {
    const { token, expiresAt } = issueCalendarLink(db);
    const origin = process.env.SITE_URL || request.nextUrl.origin;
    return NextResponse.json({ url: `${origin}/calendar/${token}`, token, expiresAt });
  } finally {
    db.close();
  }
}
