import { NextRequest, NextResponse } from "next/server";
import { projectDb } from "../../../../lib/project-store.ts";
import { runProjectNotifications } from "../../../../lib/project-notifications.ts";
import { runDailySuggestion } from "../../../../lib/suggestion-processor.ts";
import { runBookingNotifications } from "../../../../lib/notification-processor.ts";

/* Daily heartbeat. A scheduler (cron) hits this once a day; it runs the
   background jobs for the site: the notification sweep (a backstop for
   /api/jobs/notify) and the maybe-a-tip suggestion. Protected by the same
   claw key so the public cannot trigger it. */
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
    const suggestion = await runDailySuggestion(db);
    const projectNotifications = await runProjectNotifications(db);
    return NextResponse.json({
      projectNotifications,
      notifications,
      suggestion,
    });
  } finally {
    db.close();
  }
}
