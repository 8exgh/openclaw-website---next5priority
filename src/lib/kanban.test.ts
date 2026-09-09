import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { appendEvent } from "./events.ts";
import { allTasks, itemDetail, projectDb } from "./project-store.ts";
import { addComment, createItem, updateItem } from "./project-commands.ts";
import { DONE_WINDOW_MS, kanbanColumns } from "./kanban.ts";
import { STATES, type User } from "./project-types.ts";

const actor: User = { id: "sean", email: "sean@example.test", role: "admin" };
const setup = (file = ":memory:") => {
  const db = projectDb(file);
  db.prepare(
    "INSERT OR IGNORE INTO users (id,email,role,created_at) VALUES (?,?,?,?)",
  ).run(actor.id, actor.email, actor.role, new Date().toISOString());
  return db;
};

test("Kanban scopes active work to root Next 5 features and P1/P2 bugs, across all six columns", () => {
  const db = setup();
  const focus = createItem(db, actor, {
    title: "Focus",
    sectionId: "next-five",
  });
  const child = createItem(db, actor, { title: "Child", parentId: focus.id });
  const waiting = createItem(db, actor, { title: "Waiting" });
  const p1 = createItem(db, actor, {
    kind: "bug",
    priority: "P1",
    title: "Urgent",
    state: "in_qa",
  });
  const p2 = createItem(db, actor, {
    kind: "bug",
    priority: "P2",
    title: "High",
    state: "in_review",
  });
  const p3 = createItem(db, actor, {
    kind: "bug",
    priority: "P3",
    title: "Low",
  });
  const columns = kanbanColumns(allTasks(db));
  assert.deepEqual(
    columns.map((c) => c.state),
    STATES,
  );
  const ids = columns.flatMap((c) => c.tasks.map((t) => t.id));
  assert.deepEqual(new Set(ids), new Set([focus.id, p1.id, p2.id]));
  for (const excluded of [child, waiting, p3])
    assert.ok(!ids.includes(excluded.id));
  updateItem(db, actor, { id: p1.id, priority: "P4" });
  assert.ok(
    !kanbanColumns(allTasks(db))
      .flatMap((c) => c.tasks)
      .some((t) => t.id === p1.id),
  );
  db.close();
});

test("Done uses the inclusive 28-day completion boundary, for features and high-priority bugs", () => {
  const db = setup();
  const now = Date.now();
  const cutoff = new Date(now - DONE_WINDOW_MS).toISOString();
  const old = new Date(now - DONE_WINDOW_MS - 1).toISOString();
  const future = new Date(now + 1000).toISOString();
  const recentFeature = createItem(db, actor, {
    title: "Completed feature in backlog",
    state: "done",
  });
  const recentBug = createItem(db, actor, {
    kind: "bug",
    priority: "P1",
    title: "Completed bug",
    state: "done",
  });
  const oldFeature = createItem(db, actor, {
    title: "Old feature",
    sectionId: "next-five",
    state: "done",
  });
  const oldBug = createItem(db, actor, {
    title: "Old bug",
    kind: "bug",
    priority: "P2",
    state: "done",
  });
  const futureFeature = createItem(db, actor, {
    title: "Future completion",
    state: "done",
  });
  const lowBug = createItem(db, actor, {
    title: "Low bug",
    kind: "bug",
    priority: "P3",
    state: "done",
  });
  for (const task of [recentFeature, recentBug, lowBug])
    db.prepare("UPDATE tasks SET completed_at=? WHERE id=?").run(
      cutoff,
      task.id,
    );
  for (const task of [oldFeature, oldBug])
    db.prepare("UPDATE tasks SET completed_at=? WHERE id=?").run(old, task.id);
  db.prepare("UPDATE tasks SET completed_at=? WHERE id=?").run(
    future,
    futureFeature.id,
  );
  const done = kanbanColumns(allTasks(db), now).find(
    (c) => c.state === "done",
  )!;
  assert.deepEqual(
    new Set(done.tasks.map((t) => t.id)),
    new Set([recentFeature.id, recentBug.id]),
  );
  assert.ok(
    itemDetail(db, oldFeature.id),
    "Older work remains available in the app",
  );
  db.close();
});

test("comments and metadata edits do not renew completion; reopening and completing does", () => {
  const db = setup();
  const task = createItem(db, actor, {
    title: "Feature",
    state: "done",
    sectionId: "next-five",
  });
  const old = new Date(Date.now() - 60 * 86400000).toISOString();
  db.prepare("UPDATE tasks SET completed_at=? WHERE id=?").run(old, task.id);
  addComment(db, actor, { id: task.id, body: "This must not renew Done" });
  updateItem(db, actor, {
    id: task.id,
    title: "Reworded",
    state: "done",
    sectionId: "feature-backlog",
  });
  assert.equal(itemDetail(db, task.id)!.task.completedAt, old);
  assert.equal(
    kanbanColumns(allTasks(db)).find((c) => c.state === "done")!.tasks.length,
    0,
  );
  updateItem(db, actor, { id: task.id, state: "in_progress" });
  assert.equal(itemDetail(db, task.id)!.task.completedAt, null);
  const before = Date.now();
  updateItem(db, actor, { id: task.id, state: "done" });
  assert.ok(Date.parse(itemDetail(db, task.id)!.task.completedAt!) >= before);
  assert.equal(
    kanbanColumns(allTasks(db)).find((c) => c.state === "done")!.tasks[0].id,
    task.id,
  );
  db.close();
});

test("computed parent completion uses the latest child completion, independently of parent edits", () => {
  const db = setup();
  const parent = createItem(db, actor, {
    title: "Parent",
    sectionId: "next-five",
  });
  const a = createItem(db, actor, {
    title: "Child A",
    parentId: parent.id,
    state: "done",
  });
  const b = createItem(db, actor, {
    title: "Child B",
    parentId: parent.id,
    state: "done",
  });
  const older = "2026-01-01T00:00:00.000Z",
    later = "2026-01-02T00:00:00.000Z";
  db.prepare("UPDATE tasks SET completed_at=? WHERE id=?").run(older, a.id);
  db.prepare("UPDATE tasks SET completed_at=? WHERE id=?").run(later, b.id);
  updateItem(db, actor, { id: parent.id, description: "New description" });
  assert.equal(itemDetail(db, parent.id)!.task.completedAt, later);
  updateItem(db, actor, { id: a.id, state: "in_review" });
  assert.equal(itemDetail(db, parent.id)!.task.completedAt, null);
  db.close();
});

test("completion migration replays historical transitions and ignores later edits", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "n5-completed-"));
  const file = path.join(dir, "site.db");
  let db = setup(file);
  const task = createItem(db, actor, {
    title: "Already done",
    state: "needs_review",
  });
  db.prepare("DELETE FROM events").run();
  const finishedAt = "2026-01-01T00:00:00.000Z";
  appendEvent(db, "task_updated", { id: task.id, state: "done" }, finishedAt);
  appendEvent(db, "item_updated", {
    task: {
      ...task,
      state: "done",
      ownState: "done",
      updatedAt: "2026-04-01T00:00:00.000Z",
    },
  });
  db.prepare(
    "UPDATE tasks SET state='done',updated_at='2026-04-01T00:00:00.000Z'",
  ).run();
  db.exec(
    "ALTER TABLE tasks DROP COLUMN completed_at; DELETE FROM project_migrations WHERE version=2",
  );
  db.close();
  db = projectDb(file);
  assert.equal(itemDetail(db, task.id)!.task.completedAt, finishedAt);
  db.close();
  db = projectDb(file);
  assert.equal(itemDetail(db, task.id)!.task.completedAt, finishedAt);
  db.close();
  fs.rmSync(dir, { recursive: true });
});
