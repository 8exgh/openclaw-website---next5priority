import type Database from "better-sqlite3";
import { decide, recordSent } from "./suggestions.ts";
import { postToClaw } from "./rocketchat.ts";

/* Background job: once a day (triggered by a scheduler hitting /api/jobs/tick),
   maybe pitch the owner a tip through their claw. Deliver-then-record, so a
   tip is only marked sent once it actually went out; a failed delivery is
   retried on the next run. Delivery goes through the shared Rocket.Chat
   webhook poster (rocketchat.ts), gated on ROCKETCHAT_WEBHOOK_URL. */

export type SuggestionResult =
  | { fired: false; reason: string }
  | { fired: true; tipId: string };

export async function runDailySuggestion(
  db: Database.Database,
  now = new Date()
): Promise<SuggestionResult> {
  const d = decide(db, { now });
  if (!d.send) return { fired: false, reason: d.reason };
  const delivered = await postToClaw(d.tip.text);
  if (!delivered) return { fired: false, reason: "delivery_skipped_or_failed" };
  recordSent(db, d.tip.id, now);
  return { fired: true, tipId: d.tip.id };
}
