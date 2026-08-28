import { siteDb } from "./site.ts";
import { notifyInBackground } from "./notification-processor.ts";
import { runDailySuggestion } from "./suggestion-processor.ts";

/* In-process scheduler, started once per server from instrumentation.ts.
   Each site is one long-running container and nothing external crons it,
   so the background jobs run on timers here:
     - the booking-notification sweep every 5 minutes (a no-op when nothing
       is owed; the real work usually happened in the post-command kick)
     - the daily tick (maybe-a-tip suggestion) once per 24h of uptime; its
       own at-most-once-a-day guard handles restarts.
   /api/jobs/notify and /api/jobs/tick still exist for an external cron or
   a manual poke. SITE_SCHEDULER=0 disables the timers (tests, one-off runs). */

const NOTIFY_EVERY_MS = 5 * 60_000;
const TICK_EVERY_MS = 24 * 60 * 60_000;
const FIRST_NOTIFY_MS = 30_000;
const FIRST_TICK_MS = 2 * 60_000;

const g = globalThis as unknown as { __siteScheduler?: boolean };

async function dailyTick(): Promise<void> {
  const db = siteDb();
  try {
    const r = await runDailySuggestion(db);
    if (r.fired) console.log(`daily tick: suggestion ${r.tipId} sent`);
  } catch (err) {
    console.error("daily tick failed:", err);
  } finally {
    db.close();
  }
}

export function startScheduler(): boolean {
  if (g.__siteScheduler || process.env.SITE_SCHEDULER === "0") return false;
  g.__siteScheduler = true;
  const sweep = () => notifyInBackground(process.env.SITE_URL);
  setTimeout(sweep, FIRST_NOTIFY_MS).unref();
  setInterval(sweep, NOTIFY_EVERY_MS).unref();
  setTimeout(dailyTick, FIRST_TICK_MS).unref();
  setInterval(dailyTick, TICK_EVERY_MS).unref();
  console.log(`scheduler: notification sweep every ${NOTIFY_EVERY_MS / 60_000} min, daily tick every 24h`);
  return true;
}
