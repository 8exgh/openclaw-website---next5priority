import type Database from "better-sqlite3";
import { appendEvent, readEvents } from "./events.ts";
import { TIPS, type Tip } from "./tips.ts";

/* Event-sourced "did you know?" nudges.
   Rules, all derived by replay:
     - at most one tip per calendar day
     - each day it runs, ~1 in 3 chance it actually fires
     - never repeat a tip until the whole library has been sent, then reset
   Randomness is injected (rnd) so this is fully testable.

   Events: tip_sent { tipId, day }. */

const SENT_TYPE = ["tip_sent"];

type Sent = { tipId: string; day: string };

function sentLog(db: Database.Database): Sent[] {
  return readEvents(db, SENT_TYPE).map((e) => ({ tipId: e.data.tipId as string, day: e.data.day as string }));
}

export function todayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/* The unsent tips for the current cycle. Once every tip has been sent, the
   cycle resets and all tips are candidates again. */
function candidates(sent: Sent[]): Tip[] {
  const counts = new Map<string, number>();
  for (const s of sent) counts.set(s.tipId, (counts.get(s.tipId) ?? 0) + 1);
  const minSends = TIPS.reduce((m, t) => Math.min(m, counts.get(t.id) ?? 0), Infinity);
  const floor = Number.isFinite(minSends) ? minSends : 0;
  return TIPS.filter((t) => (counts.get(t.id) ?? 0) === floor);
}

export type Decision =
  | { send: false; reason: "already_sent_today" | "skipped_today" }
  | { send: true; tip: Tip };

/* Decides whether to send today and, if so, which tip. Pure given (db, now,
   rnd). rnd() returns [0,1). Call recordSent() after actually delivering. */
export function decide(
  db: Database.Database,
  opts: { now?: Date; rnd?: () => number; chance?: number } = {}
): Decision {
  const now = opts.now ?? new Date();
  const rnd = opts.rnd ?? Math.random;
  const chance = opts.chance ?? 1 / 3;
  const sent = sentLog(db);
  const today = todayKey(now);
  if (sent.some((s) => s.day === today)) return { send: false, reason: "already_sent_today" };
  if (rnd() >= chance) return { send: false, reason: "skipped_today" };
  const pool = candidates(sent);
  const tip = pool[Math.floor(rnd() * pool.length)] ?? pool[0];
  return { send: true, tip };
}

export function recordSent(db: Database.Database, tipId: string, now = new Date()): void {
  appendEvent(db, "tip_sent", { tipId, day: todayKey(now) });
}

export function sentCount(db: Database.Database): number {
  return sentLog(db).length;
}
