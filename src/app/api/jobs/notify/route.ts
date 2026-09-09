import { NextRequest, NextResponse } from "next/server";
import { projectDb } from "../../../../lib/project-store.ts";
import { runProjectNotifications } from "../../../../lib/project-notifications.ts";
import { runBookingNotifications } from "../../../../lib/notification-processor.ts";

/* Notification sweep. Safe to hit often (every few minutes): it only sends
   what is still owed, so a normal run is a no-op. Catches anything the
   post-command kick could not deliver (provider down, env not yet set).
   Protected by the claw key like the other jobs. */
export async function POST(request: NextRequest) {
  const key = process.env.CLAW_API_KEY;
  if (!key || request.headers.get("x-claw-key") !== key) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = projectDb();
  try {
    const notifications = await runBookingNotifications(db, {
      siteUrl: process.env.SITE_URL || request.nextUrl.origin,
    });
    const projectNotifications = await runProjectNotifications(db);
    return NextResponse.json({ projectNotifications, notifications });
  } finally {
    db.close();
  }
}
