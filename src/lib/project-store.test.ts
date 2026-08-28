import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import { projectDb, projectedState, snapshot } from "./project-store.ts";

test("seeds permanent workflow sections without copying example work", () => {
  const previous = process.env.DB_PATH; process.env.DB_PATH = ":memory:"; const db = projectDb();
  const sections = snapshot(db) as { name: string; tasks: unknown[] }[];
  assert.deepEqual(sections.map((s) => s.name), ["Top 5 Priorities", "In QA", "Patches", "Backlog", "Inbox"]);
  assert.ok(sections.every((s) => s.tasks.length === 0)); db.close();
  if (previous === undefined) delete process.env.DB_PATH; else process.env.DB_PATH = previous;
});

test("parent state is recursively computed from child leaves", () => {
  const previous = process.env.DB_PATH; process.env.DB_PATH = ":memory:"; const db = projectDb();
  const section = db.prepare("SELECT id FROM sections LIMIT 1").get() as { id: string }; const now = new Date().toISOString();
  const parent = crypto.randomUUID(), childA = crypto.randomUUID(), childB = crypto.randomUUID(); const insert = db.prepare("INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?)");
  insert.run(parent, section.id, null, "Parent", "done", 0, now, now); insert.run(childA, section.id, parent, "A", "done", 0, now, now); insert.run(childB, section.id, parent, "B", "in_qa", 1, now, now);
  assert.equal(projectedState(db, parent, "done"), "in_qa"); db.prepare("UPDATE tasks SET state='in_progress' WHERE id=?").run(childB); assert.equal(projectedState(db, parent, "done"), "in_progress"); db.prepare("UPDATE tasks SET state='done' WHERE id=?").run(childB); assert.equal(projectedState(db, parent, "in_progress"), "done");
  db.close(); if (previous === undefined) delete process.env.DB_PATH; else process.env.DB_PATH = previous;
});
