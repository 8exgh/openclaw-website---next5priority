import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  allTasks,
  itemDetail,
  projectDb,
  projectedState,
  snapshot,
} from "./project-store.ts";
import {
  addComment,
  convertItem,
  createItem,
  deleteItem,
  followItem,
  linkItem,
  unlinkItem,
  updateItem,
  updateProfile,
} from "./project-commands.ts";
import { runProjectNotifications } from "./project-notifications.ts";
import { initials, PRIORITIES, STATES, type User } from "./project-types.ts";
import { imageMime } from "./project-assets.ts";

const admin: User = {
  id: "admin",
  email: "admin@example.test",
  role: "admin",
  name: "Alex Morgan",
};
const editor: User = {
  id: "editor",
  email: "editor@example.test",
  role: "edit",
  name: "Sam Lee",
};
const reader: User = {
  id: "reader",
  email: "reader@example.test",
  role: "read",
  name: "Read Only",
};
function setup(file = ":memory:") {
  const db = projectDb(file);
  for (const user of [admin, editor, reader])
    db.prepare(
      "INSERT INTO users (id,email,role,name,created_at) VALUES (?,?,?,?,?)",
    ).run(user.id, user.email, user.role, user.name, new Date().toISOString());
  return db;
}
const feature = (
  db: Database.Database,
  title = "Feature",
  sectionId = "feature-backlog",
) => createItem(db, admin, { kind: "feature", title, sectionId });
const bug = (db: Database.Database, title = "Bug", priority = "P3") =>
  createItem(db, admin, { kind: "bug", title, priority });

test("separate permanent lists start empty; migrations run only once", () => {
  const db = setup();
  assert.deepEqual(
    snapshot(db).map((s) => s.name),
    ["Next 5 features", "Feature backlog", "Bugs · P1 / P2", "Bugs · P3 / P4"],
  );
  assert.ok(snapshot(db).every((s) => !s.tasks.length));
  db.close();
});

test("legacy tasks migrate without losing titles, descendants, states, or excess priorities", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "n5-migration-"));
  const file = path.join(dir, "site.db");
  let db = new Database(file);
  db.exec(`CREATE TABLE sections (id TEXT PRIMARY KEY,name TEXT,position INTEGER);
    CREATE TABLE tasks (id TEXT PRIMARY KEY,section_id TEXT,parent_id TEXT,title TEXT,state TEXT,position INTEGER,created_at TEXT,updated_at TEXT);
    INSERT INTO sections VALUES ('top','Top 5 Priorities',0),('patch','Patches',1),('qa','In QA',2);
    INSERT INTO tasks VALUES ('child','top','f5','Child','in_qa',0,'2026-01-01','2026-01-01'),('b1','patch',NULL,'Old patch','in_progress',0,'2026-01-01','2026-01-01'),('b2','patch','b1','Nested patch','done',0,'2026-01-01','2026-01-01');`);
  for (let i = 0; i < 7; i++)
    db.prepare(
      "INSERT INTO tasks VALUES (?, 'top', NULL, ?, 'in_progress', ?, '2026-01-01', '2026-01-01')",
    ).run(`f${i}`, `Old ${i}`, i);
  db.close();
  db = projectDb(file);
  assert.equal(snapshot(db)[0].tasks.length, 5);
  assert.equal(allTasks(db).length, 10);
  assert.equal(itemDetail(db, "child")!.task.sectionId, "feature-backlog");
  assert.equal(projectedState(db, "f5", "in_progress"), "in_qa");
  assert.equal(itemDetail(db, "b2")!.links[0].other.id, "b1");
  assert.equal(itemDetail(db, "b1")!.task.publicId, "SAV-000001");
  assert.equal(itemDetail(db, "b2")!.task.parentId, null);
  const events = (
    db.prepare("SELECT COUNT(*) n FROM events").get() as { n: number }
  ).n;
  db.close();
  db = projectDb(file);
  assert.equal(
    (db.prepare("SELECT COUNT(*) n FROM events").get() as { n: number }).n,
    events,
  );
  db.close();
  fs.rmSync(dir, { recursive: true });
});

test("next five enforces capacity and reorder; moving parents moves all descendants", () => {
  const db = setup();
  const items = Array.from({ length: 5 }, (_, i) =>
    feature(db, `Feature ${i}`, "next-five"),
  );
  assert.throws(() => feature(db, "Sixth", "next-five"), /Next 5 is full/);
  const waiting = feature(db, "Waiting");
  assert.throws(
    () => updateItem(db, admin, { id: waiting.id, sectionId: "next-five" }),
    /Next 5 is full/,
  );
  updateItem(db, admin, { id: items[4].id, position: 0 });
  assert.deepEqual(
    snapshot(db)[0].tasks.map((t) => t.id),
    [items[4].id, ...items.slice(0, 4).map((t) => t.id)],
  );
  const child = createItem(db, admin, {
    title: "Subtask",
    parentId: items[4].id,
  });
  const grandchild = createItem(db, admin, {
    title: "Nested",
    parentId: child.id,
  });
  updateItem(db, admin, { id: items[4].id, sectionId: "feature-backlog" });
  assert.equal(
    itemDetail(db, grandchild.id)!.task.sectionId,
    "feature-backlog",
  );
  updateItem(db, admin, { id: waiting.id, sectionId: "next-five" });
  assert.deepEqual(
    snapshot(db)[0].tasks.map((t) => t.position),
    [0, 1, 2, 3, 4],
  );
  assert.throws(
    () => updateItem(db, admin, { id: child.id, sectionId: "next-five" }),
    /top-level/,
  );
  assert.throws(
    () => updateItem(db, admin, { id: waiting.id, position: 10 }),
    /Invalid position/,
  );
  db.close();
});

test("feature priorities validate independently of list placement, rank, and parent priority", () => {
  const db = setup();
  const first = feature(db, "First", "next-five");
  const second = feature(db, "Second", "next-five");
  const waiting = feature(db, "Waiting");
  assert.equal(first.priority, "P3");
  for (const priority of PRIORITIES) {
    const child = createItem(db, admin, {
      title: priority,
      parentId: first.id,
      priority,
    });
    assert.equal(child.priority, priority);
    updateItem(db, admin, { id: first.id, priority });
    updateItem(db, admin, { id: waiting.id, priority });
    assert.equal(itemDetail(db, first.id)!.task.priority, priority);
    assert.equal(itemDetail(db, waiting.id)!.task.sectionId, "feature-backlog");
    assert.deepEqual(
      snapshot(db)[0].tasks.map((t) => t.id),
      [first.id, second.id],
    );
  }
  assert.equal(itemDetail(db, first.id)!.task.children[0].priority, "P1");
  for (const priority of ["P0", "P5", 1, ""]) {
    assert.throws(
      () => createItem(db, admin, { title: "Invalid", priority }),
      /Invalid priority/,
    );
    assert.throws(
      () =>
        updateItem(db, admin, { id: first.id, title: "Rollback", priority }),
      /Invalid priority/,
    );
  }
  assert.equal(itemDetail(db, first.id)!.task.title, "First");
  db.close();
});

test("existing features receive P3 once without changing history, completion dates, or explicit priorities", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "n5-feature-priority-"));
  const file = path.join(dir, "site.db");
  let db = setup(file);
  try {
    const parent = createItem(db, admin, {
      title: "Imported",
      sectionId: "next-five",
      state: "done",
    });
    const child = createItem(db, admin, {
      title: "Imported child",
      parentId: parent.id,
      state: "done",
    });
    const explicit = createItem(db, admin, {
      title: "Already prioritized",
      priority: "P1",
    });
    const existingBug = bug(db, "Bug", "P2");
    const before = itemDetail(db, child.id)!.task;
    db.prepare("UPDATE tasks SET priority=NULL WHERE id IN (?,?)").run(
      parent.id,
      child.id,
    );
    db.prepare("DELETE FROM project_migrations WHERE version=3").run();
    db.close();
    db = projectDb(file);
    assert.equal(itemDetail(db, parent.id)!.task.priority, "P3");
    assert.deepEqual(itemDetail(db, child.id)!.task, before);
    assert.equal(itemDetail(db, explicit.id)!.task.priority, "P1");
    assert.equal(itemDetail(db, existingBug.id)!.task.priority, "P2");
    const events = db
      .prepare("SELECT data FROM events WHERE type='item_migrated'")
      .all() as { data: string }[];
    assert.deepEqual(
      events.map((e) => JSON.parse(e.data).task.id),
      [parent.id, child.id],
    );
    updateItem(db, admin, { id: parent.id, priority: "P4" });
    const eventCount = (
      db.prepare("SELECT COUNT(*) n FROM events").get() as { n: number }
    ).n;
    db.close();
    db = projectDb(file);
    assert.equal(itemDetail(db, parent.id)!.task.priority, "P4");
    assert.equal(
      (db.prepare("SELECT COUNT(*) n FROM events").get() as { n: number }).n,
      eventCount,
    );
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true });
  }
});

test("conversions preserve identity, completed dates, collaboration, and event-owned attachments", () => {
  const db = setup();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "n5-convert-assets-"));
  const previousAssets = process.env.ASSETS_PATH;
  process.env.ASSETS_PATH = dir;
  try {
    const task = createItem(
      db,
      admin,
      {
        title: "Convert me",
        description: "Keep\nthese details",
        sectionId: "next-five",
        state: "done",
        priority: "P1",
        implementorId: editor.id,
        reviewerId: reader.id,
      },
      [{ name: "spec.txt", data: Buffer.from("Requirements") }],
    );
    const oldCompletion = "2026-01-01T00:00:00.000Z";
    db.prepare("UPDATE tasks SET completed_at=? WHERE id=?").run(
      oldCompletion,
      task.id,
    );
    addComment(db, editor, { id: task.id, body: "Keep this comment" }, [
      { name: "notes.bin", data: Buffer.from([1, 2, 3]) },
    ]);
    followItem(db, reader, { id: task.id, follow: true });
    const other = bug(db, "Related bug");
    linkItem(db, admin, {
      id: other.id,
      targetId: task.id,
      relation: "caused_by",
    });
    const before = itemDetail(db, task.id)!;
    const outbox = (
      db.prepare("SELECT COUNT(*) n FROM project_outbox").get() as { n: number }
    ).n;
    const converted = convertItem(db, editor, { id: task.id, kind: "bug" });
    assert.equal(converted.publicId, "SAV-000002");
    assert.equal(converted.sectionId, "bugs-high");
    assert.equal(snapshot(db)[0].tasks.length, 0);
    for (const kind of ["feature", "bug", "feature"] as const) {
      const result = convertItem(db, editor, { id: converted.publicId, kind });
      assert.equal(result.publicId, converted.publicId);
      assert.equal(
        result.sectionId,
        kind === "feature" ? "feature-backlog" : "bugs-high",
      );
      assert.equal(result.completedAt, oldCompletion);
      assert.equal(result.state, "done");
      assert.equal(result.priority, "P1");
      assert.equal(result.createdAt, task.createdAt);
      assert.equal(result.createdBy, admin.id);
      assert.equal(result.implementorId, editor.id);
      assert.equal(result.reviewerId, reader.id);
      const after = itemDetail(db, task.id)!;
      assert.equal(after.task.description, task.description);
      assert.deepEqual(after.comments, before.comments);
      assert.deepEqual(after.attachments, before.attachments);
      assert.deepEqual(after.followers, before.followers);
      assert.deepEqual(after.links, before.links);
    }
    for (const attachment of before.attachments)
      assert.ok(
        fs.existsSync(path.join(dir, attachment.eventId, attachment.id)),
      );
    const events = db
      .prepare("SELECT data FROM events WHERE type='item_converted'")
      .all() as { data: string }[];
    assert.equal(events.length, 4);
    assert.equal(JSON.parse(events[0].data).task.publicId, converted.publicId);
    convertItem(db, editor, { id: task.id, kind: "feature" });
    assert.equal(
      (
        db
          .prepare("SELECT COUNT(*) n FROM events WHERE type='item_converted'")
          .get() as { n: number }
      ).n,
      4,
    );
    assert.equal(
      (
        db.prepare("SELECT COUNT(*) n FROM project_outbox").get() as {
          n: number;
        }
      ).n,
      outbox,
    );
    assert.equal(bug(db, "Next bug").publicId, "SAV-000003");
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true });
    if (previousAssets === undefined) delete process.env.ASSETS_PATH;
    else process.env.ASSETS_PATH = previousAssets;
  }
});

test("converting nested features preserves child trees in backlog and links the former hierarchy", () => {
  const db = setup();
  const root = feature(db, "Root", "next-five");
  const child = createItem(db, admin, {
    title: "Child",
    parentId: root.id,
    priority: "P2",
  });
  const grandchild = createItem(db, admin, {
    title: "Grandchild",
    parentId: child.id,
    state: "in_qa",
  });
  const leaf = createItem(db, admin, {
    title: "Leaf",
    parentId: grandchild.id,
    state: "in_review",
  });
  const converted = convertItem(db, admin, { id: child.id, kind: "bug" });
  assert.equal(converted.state, "in_review");
  assert.equal(converted.parentId, null);
  assert.equal(converted.sectionId, "bugs-high");
  assert.equal(itemDetail(db, converted.id)!.task.children.length, 0);
  assert.equal(itemDetail(db, grandchild.id)!.task.parentId, null);
  assert.equal(
    itemDetail(db, grandchild.id)!.task.sectionId,
    "feature-backlog",
  );
  assert.equal(itemDetail(db, leaf.id)!.task.parentId, grandchild.id);
  assert.equal(itemDetail(db, leaf.id)!.task.sectionId, "feature-backlog");
  assert.equal(itemDetail(db, root.id)!.task.sectionId, "next-five");
  assert.deepEqual(
    new Set(itemDetail(db, child.id)!.links.map((link) => link.other.id)),
    new Set([root.id, grandchild.id]),
  );
  assert.equal(allTasks(db).length, 4);
  const event = db
    .prepare("SELECT data FROM events WHERE type='item_converted'")
    .get() as { data: string };
  assert.equal(JSON.parse(event.data).movedFeatures.length, 2);
  assert.throws(
    () => convertItem(db, reader, { id: root.id, kind: "bug" }),
    /Edit access/,
  );
  assert.throws(
    () => convertItem(db, admin, { id: root.id, kind: "other" }),
    /Invalid item type/,
  );
  assert.equal(itemDetail(db, root.id)!.task.kind, "feature");
  db.close();
});

test("conversion rolls back list and hierarchy changes when recording the event fails", () => {
  const db = setup();
  const parent = feature(db, "Parent", "next-five");
  createItem(db, admin, { title: "Child", parentId: parent.id });
  const before = allTasks(db);
  db.exec(
    "CREATE TRIGGER reject_conversion BEFORE INSERT ON events WHEN NEW.type='item_converted' BEGIN SELECT RAISE(ABORT, 'Test failure'); END;",
  );
  assert.throws(
    () => convertItem(db, admin, { id: parent.id, kind: "bug" }),
    /Test failure/,
  );
  assert.deepEqual(allTasks(db), before);
  assert.equal(bug(db).publicId, "SAV-000001");
  db.close();
});

test("bug IDs increment without reuse and lists sort by priority then logged date descending", () => {
  const db = setup();
  const p2 = bug(db, "P2", "P2"),
    older = bug(db, "Older", "P1"),
    newer = bug(db, "Newer", "P1"),
    low = bug(db, "Low", "P4");
  db.prepare("UPDATE tasks SET created_at='2026-01-01' WHERE id=?").run(
    older.id,
  );
  db.prepare("UPDATE tasks SET created_at='2026-02-01' WHERE id=?").run(
    newer.id,
  );
  assert.equal(p2.publicId, "SAV-000001");
  assert.deepEqual(
    snapshot(db)[2].tasks.map((t) => t.id),
    [newer.id, older.id, p2.id],
  );
  updateItem(db, admin, { id: low.publicId, priority: "P1" });
  assert.equal(snapshot(db)[3].tasks.length, 0);
  updateItem(db, admin, { id: low.id, priority: "P3" });
  assert.equal(snapshot(db)[3].tasks[0].id, low.id);
  deleteItem(db, admin, newer.id);
  assert.equal(bug(db).publicId, "SAV-000005");
  assert.throws(
    () => updateItem(db, admin, { id: low.id, sectionId: "next-five" }),
    /top-level feature/,
  );
  assert.throws(
    () =>
      createItem(db, admin, {
        title: "Nested bug",
        kind: "bug",
        parentId: low.id,
      }),
    /Only features/,
  );
  db.close();
});

test("all six states persist; parents reflect the earliest child stage recursively", () => {
  const db = setup();
  const parent = feature(db);
  const a = createItem(db, admin, { title: "A", parentId: parent.id });
  const b = createItem(db, admin, { title: "B", parentId: parent.id });
  updateItem(db, admin, { id: b.id, state: "done" });
  for (const state of STATES) {
    updateItem(db, admin, { id: a.id, state });
    assert.equal(itemDetail(db, parent.id)!.task.state, state);
  }
  assert.throws(
    () => updateItem(db, admin, { id: parent.id, state: "done" }),
    /computed/,
  );
  assert.throws(
    () =>
      updateItem(db, admin, {
        id: a.id,
        state: "garbage",
        title: "Should roll back",
      }),
    /Invalid state/,
  );
  assert.equal(itemDetail(db, a.id)!.task.title, "A");
  db.close();
});

test("relationships are bidirectional to view, causal direction is preserved, and invalid links fail", () => {
  const db = setup();
  const f = feature(db),
    b = bug(db),
    other = bug(db, "Other");
  const link = linkItem(db, admin, {
    id: b.id,
    targetId: f.id,
    relation: "caused_by",
  });
  assert.equal(itemDetail(db, b.id)!.links[0].incoming, false);
  assert.equal(itemDetail(db, f.id)!.links[0].incoming, true);
  assert.throws(
    () =>
      linkItem(db, admin, { id: f.id, targetId: b.id, relation: "caused_by" }),
    /start from the bug/,
  );
  assert.throws(
    () =>
      linkItem(db, admin, { id: b.id, targetId: b.id, relation: "related_to" }),
    /itself/,
  );
  linkItem(db, admin, { id: b.id, targetId: other.id, relation: "related_to" });
  assert.throws(
    () =>
      linkItem(db, admin, {
        id: other.id,
        targetId: b.id,
        relation: "related_to",
      }),
    /already/,
  );
  unlinkItem(db, admin, { id: f.id, linkId: link.id });
  assert.equal(itemDetail(db, f.id)!.links.length, 0);
  deleteItem(db, admin, other.id);
  assert.equal(itemDetail(db, b.id)!.links.length, 0);
  db.close();
});

test("descriptions, comments, any files, and profile pictures are stored under committed event IDs", () => {
  const db = setup(),
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "n5-assets-"));
  const previous = process.env.ASSETS_PATH;
  process.env.ASSETS_PATH = dir;
  try {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    );
    const task = createItem(
      db,
      admin,
      { title: "Files", description: "Line one\nLine two" },
      [
        { name: "../../example.png", data: png },
        { name: "file.bin", data: Buffer.from([0, 255, 32]) },
      ],
    );
    const comment = addComment(
      db,
      editor,
      { id: task.id, body: "First\nSecond" },
      [{ name: "script.html", data: Buffer.from("<script>alert(1)</script>") }],
    );
    const detail = itemDetail(db, task.id)!;
    assert.equal(detail.task.description, "Line one\nLine two");
    assert.equal(detail.comments[0].body, "First\nSecond");
    assert.equal(detail.comments[0].id, comment.id);
    assert.equal(
      detail.comments[0].attachments[0].mime,
      "application/octet-stream",
    );
    assert.equal(detail.attachments[0].name, "example.png");
    assert.equal(detail.attachments[0].mime, "image/png");
    for (const attachment of [
      ...detail.attachments,
      ...detail.comments[0].attachments,
    ]) {
      assert.ok(
        db.prepare("SELECT 1 FROM events WHERE id=?").get(attachment.eventId),
      );
      assert.ok(
        fs.existsSync(path.join(dir, attachment.eventId, attachment.id)),
      );
    }
    const profile = updateProfile(db, admin, { name: "New Name" }, [
      { name: "avatar.png", data: png },
    ]);
    assert.ok(profile.avatarId);
    assert.equal(initials(profile), "NN");
    assert.equal(
      initials({ ...admin, name: "", email: "sean.morgan@example.test" }),
      "SM",
    );
    assert.throws(
      () =>
        updateProfile(db, admin, {}, [
          { name: "spoof.png", data: Buffer.from("<svg/>") },
        ]),
      /PNG, JPEG/,
    );
    assert.equal(imageMime(Buffer.from("<svg/>")), null);
    assert.equal(
      updateProfile(db, profile, { removeAvatar: true }).avatarId,
      null,
    );
    assert.throws(
      () => addComment(db, admin, { id: task.id, body: "  " }),
      /Write a comment/,
    );
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true });
    if (previous === undefined) delete process.env.ASSETS_PATH;
    else process.env.ASSETS_PATH = previous;
  }
});

test("failed attachment persistence rolls back the item, sequence, events and files", () => {
  const db = setup(),
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "n5-failure-"));
  const previous = process.env.ASSETS_PATH;
  const blocked = path.join(dir, "file");
  fs.writeFileSync(blocked, "not a directory");
  process.env.ASSETS_PATH = blocked;
  try {
    const before = (
      db.prepare("SELECT COUNT(*) n FROM events").get() as { n: number }
    ).n;
    assert.throws(() =>
      createItem(db, admin, { kind: "bug", title: "Atomic" }, [
        { name: "a.txt", data: Buffer.from("a") },
      ]),
    );
    assert.equal(allTasks(db).length, 0);
    assert.equal(
      (db.prepare("SELECT COUNT(*) n FROM events").get() as { n: number }).n,
      before,
    );
    assert.equal(bug(db).publicId, "SAV-000001");
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true });
    if (previous === undefined) delete process.env.ASSETS_PATH;
    else process.env.ASSETS_PATH = previous;
  }
});

test("read-only users can follow and manage their own profile but cannot mutate work", () => {
  const db = setup();
  const task = feature(db);
  assert.throws(() => createItem(db, reader, { title: "No" }), /Edit access/);
  assert.throws(
    () => updateItem(db, reader, { id: task.id, title: "No" }),
    /Edit access/,
  );
  assert.throws(
    () => addComment(db, reader, { id: task.id, body: "No" }),
    /Edit access/,
  );
  assert.throws(() => deleteItem(db, reader, task.id), /Edit access/);
  followItem(db, reader, { id: task.id, follow: true });
  assert.equal(itemDetail(db, task.id)!.followers[0].id, reader.id);
  updateProfile(db, reader, { name: "Viewer" });
  assert.throws(
    () =>
      followItem(
        db,
        { ...editor, id: "api:bot" },
        { id: task.id, follow: true },
      ),
    /personal account/,
  );
  assert.throws(
    () => updateItem(db, admin, { id: task.id, implementorId: "missing" }),
    /existing teammate/,
  );
  db.close();
});

test("assignment, comment and follow mail is queued without sending; retries and overlapping workers do not lose or repeat successful mail", async () => {
  const db = setup();
  const task = createItem(db, admin, {
    title: "Notify",
    implementorId: editor.id,
    reviewerId: editor.id,
  });
  assert.equal(
    (db.prepare("SELECT COUNT(*) n FROM project_outbox").get() as { n: number })
      .n,
    1,
  );
  updateItem(db, admin, {
    id: task.id,
    title: "Changed title",
    implementorId: editor.id,
  });
  assert.equal(
    (db.prepare("SELECT COUNT(*) n FROM project_outbox").get() as { n: number })
      .n,
    1,
  );
  const opts = {
    now: 1000,
    siteUrl: "https://project.example.test",
    email: async () => false,
  };
  assert.deepEqual(await runProjectNotifications(db, opts), {
    owed: 1,
    sent: 0,
    failed: 1,
  });
  let sent = 0;
  const deliver = async (message: { text: string }) => {
    sent++;
    assert.match(message.text, /https:\/\/project.example.test\/\?item=/);
    return true;
  };
  assert.equal(
    (await runProjectNotifications(db, { ...opts, now: 2000, email: deliver }))
      .owed,
    0,
  );
  const runs = await Promise.all([
    runProjectNotifications(db, { ...opts, now: 32000, email: deliver }),
    runProjectNotifications(db, { ...opts, now: 32000, email: deliver }),
  ]);
  assert.equal(
    runs.reduce((sum, r) => sum + r.sent, 0),
    1,
  );
  assert.equal(sent, 1);
  followItem(db, reader, { id: task.id, follow: true });
  const queued = (
    db.prepare("SELECT COUNT(*) n FROM project_outbox").get() as { n: number }
  ).n;
  followItem(db, reader, { id: task.id, follow: true });
  assert.equal(
    (db.prepare("SELECT COUNT(*) n FROM project_outbox").get() as { n: number })
      .n,
    queued,
  );
  addComment(db, editor, { id: task.id, body: "Update" });
  const recipients = db
    .prepare(
      "SELECT recipient_id id FROM project_outbox WHERE event_id=(SELECT id FROM events WHERE type='item_commented' ORDER BY rowid DESC LIMIT 1)",
    )
    .all() as { id: string }[];
  assert.deepEqual(
    recipients.map((r) => r.id).sort(),
    [admin.id, reader.id].sort(),
  );
  followItem(db, reader, { id: task.id, follow: false });
  addComment(db, editor, { id: task.id, body: "After unfollow" });
  const latest = db
    .prepare(
      "SELECT recipient_id id FROM project_outbox WHERE event_id=(SELECT id FROM events WHERE type='item_commented' ORDER BY rowid DESC LIMIT 1)",
    )
    .all() as { id: string }[];
  assert.deepEqual(
    latest.map((r) => r.id),
    [admin.id],
  );
  db.close();
});

test("unconfigured email stays owed and an expired worker lease is recovered", async () => {
  const db = setup();
  createItem(db, admin, { title: "Retry", implementorId: editor.id });
  let sends = 0;
  assert.equal(
    (
      await runProjectNotifications(db, {
        siteUrl: "",
        now: 0,
        email: async () => {
          sends++;
          return true;
        },
      })
    ).failed,
    1,
  );
  assert.equal(sends, 0);
  db.prepare("UPDATE project_outbox SET lease_until=90000").run();
  assert.equal(
    (
      await runProjectNotifications(db, {
        siteUrl: "https://x.test",
        now: 60000,
      })
    ).owed,
    0,
  );
  assert.equal(
    (
      await runProjectNotifications(db, {
        siteUrl: "https://x.test",
        now: 91000,
        email: async () => true,
      })
    ).sent,
    1,
  );
  db.close();
});
