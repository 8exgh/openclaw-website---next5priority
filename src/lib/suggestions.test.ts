import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "./events.ts";
import { decide, recordSent, sentCount } from "./suggestions.ts";
import { TIPS } from "./tips.ts";

const day = (d) => new Date(Date.UTC(2026, 7, 1, 12) + (d - 1) * 86400000);

test("skips when the dice say so (rnd above chance)", () => {
  const db = openDb(":memory:");
  const r = decide(db, { now: day(1), rnd: () => 0.9 });   // 0.9 >= 1/3 -> skip
  assert.equal(r.send, false);
  assert.equal(r.send === false && r.reason, "skipped_today");
});

test("sends when the dice say so, and picks a tip", () => {
  const db = openDb(":memory:");
  const r = decide(db, { now: day(1), rnd: () => 0.1 });   // 0.1 < 1/3 -> send
  assert.equal(r.send, true);
  assert.ok(r.send && r.tip && r.tip.text.length > 0);
});

test("at most one per day", () => {
  const db = openDb(":memory:");
  recordSent(db, TIPS[0].id, day(1));
  const r = decide(db, { now: day(1), rnd: () => 0.0 });
  assert.equal(r.send, false);
  assert.equal(r.send === false && r.reason, "already_sent_today");
});

test("never repeats a tip until the whole library is exhausted, then resets", () => {
  const db = openDb(":memory:");
  const seen = new Set();
  // Force a send every day, walk more days than there are tips.
  for (let d = 1; d <= TIPS.length; d++) {
    const r = decide(db, { now: day(d), rnd: () => 0.0 });  // 0.0 -> always send, always first candidate
    assert.equal(r.send, true);
    if (r.send) { assert.ok(!seen.has(r.tip.id), `repeat before exhaustion: ${r.tip.id}`); seen.add(r.tip.id); recordSent(db, r.tip.id, day(d)); }
  }
  assert.equal(seen.size, TIPS.length);           // covered the whole library once
  // Next cycle: candidates reset, sending resumes.
  const again = decide(db, { now: day(TIPS.length + 1), rnd: () => 0.0 });
  assert.equal(again.send, true);
  assert.equal(sentCount(db), TIPS.length);
});
