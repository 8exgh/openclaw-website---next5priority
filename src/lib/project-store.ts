import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { appendEvent, openDb } from "./events.ts";
import {
  SECTIONS,
  STATES,
  type Attachment,
  type Comment,
  type ItemDetail,
  type ItemLink,
  type Section,
  type Task,
  type TaskRecord,
  type TaskState,
  type User,
} from "./project-types.ts";
export type { Role, TaskState, User } from "./project-types.ts";

const BASE_TASK_SELECT = `SELECT id,public_id publicId,kind,section_id sectionId,parent_id parentId,title,description,state,state ownState,priority,implementor_id implementorId,reviewer_id reviewerId,created_by createdBy,position,created_at createdAt,updated_at updatedAt FROM tasks`;
export const TASK_SELECT = BASE_TASK_SELECT.replace(
  " FROM tasks",
  ",completed_at completedAt FROM tasks",
);
export const USER_SELECT =
  "SELECT id,email,role,name,avatar_id avatarId FROM users";
export const ATTACHMENT_SELECT =
  "SELECT id,event_id eventId,task_id taskId,comment_id commentId,user_id userId,name,mime,size,created_at createdAt FROM attachments";

export function projectDb(dbPath?: string) {
  const db = openDb(dbPath);
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS login_codes (email TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS user_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sections (id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, section_id TEXT NOT NULL, parent_id TEXT, title TEXT NOT NULL, state TEXT NOT NULL, position INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS api_keys (id TEXT PRIMARY KEY, name TEXT NOT NULL, key_hash TEXT UNIQUE NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS project_migrations (version INTEGER PRIMARY KEY);
  `);
  db.transaction(() => {
    if (db.prepare("SELECT 1 FROM project_migrations WHERE version=1").get())
      return;
    db.exec(`
      ALTER TABLE users ADD COLUMN name TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN avatar_id TEXT;
      ALTER TABLE tasks ADD COLUMN kind TEXT NOT NULL DEFAULT 'feature';
      ALTER TABLE tasks ADD COLUMN description TEXT NOT NULL DEFAULT '';
      ALTER TABLE tasks ADD COLUMN public_id TEXT;
      ALTER TABLE tasks ADD COLUMN priority TEXT;
      ALTER TABLE tasks ADD COLUMN implementor_id TEXT;
      ALTER TABLE tasks ADD COLUMN reviewer_id TEXT;
      ALTER TABLE tasks ADD COLUMN created_by TEXT;
      CREATE UNIQUE INDEX idx_task_public_id ON tasks(public_id);
      CREATE INDEX idx_task_parent ON tasks(parent_id);
      CREATE INDEX idx_task_section ON tasks(section_id,position);
      CREATE TABLE project_sequences (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
      INSERT INTO project_sequences VALUES ('bug',0);
      CREATE TABLE comments (id TEXT PRIMARY KEY,task_id TEXT NOT NULL,user_id TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE INDEX idx_comment_task ON comments(task_id,created_at);
      CREATE TABLE attachments (id TEXT PRIMARY KEY,event_id TEXT NOT NULL,task_id TEXT,comment_id TEXT,user_id TEXT NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,storage_name TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE INDEX idx_attachment_task ON attachments(task_id,comment_id);
      CREATE TABLE followers (task_id TEXT NOT NULL,user_id TEXT NOT NULL,PRIMARY KEY(task_id,user_id));
      CREATE TABLE item_links (id TEXT PRIMARY KEY,source_id TEXT NOT NULL,target_id TEXT NOT NULL,relation TEXT NOT NULL,UNIQUE(source_id,target_id,relation));
      CREATE TABLE project_outbox (id TEXT PRIMARY KEY,event_id TEXT NOT NULL,recipient_id TEXT NOT NULL,message TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at INTEGER NOT NULL DEFAULT 0,lease_until INTEGER NOT NULL DEFAULT 0,sent_at TEXT,UNIQUE(event_id,recipient_id));
      CREATE INDEX idx_project_outbox_pending ON project_outbox(sent_at,next_attempt_at);
    `);
    const oldSections = db.prepare("SELECT id,name FROM sections").all() as {
      id: string;
      name: string;
    }[];
    for (const section of oldSections) {
      const target =
        section.name === "Top 5 Priorities"
          ? "next-five"
          : section.name === "Patches"
            ? "bugs-low"
            : "feature-backlog";
      db.prepare(
        "UPDATE tasks SET section_id=?,kind=?,priority=? WHERE section_id=?",
      ).run(
        target,
        target === "bugs-low" ? "bug" : "feature",
        target === "bugs-low" ? "P3" : null,
        section.id,
      );
    }
    db.prepare("DELETE FROM sections").run();
    for (const s of SECTIONS)
      db.prepare("INSERT INTO sections VALUES (?,?,?)").run(
        s.id,
        s.name,
        s.position,
      );
    const roots = db
      .prepare(
        "SELECT id FROM tasks WHERE section_id='next-five' AND parent_id IS NULL ORDER BY position,created_at,id",
      )
      .all() as { id: string }[];
    for (const root of roots.slice(5)) moveTree(db, root.id, "feature-backlog");
    // Bugs have independent priorities and therefore independent list placement.
    // Preserve old nested patch relationships as explicit related-to links.
    const nestedBugs = db
      .prepare(
        "SELECT id,parent_id parentId FROM tasks WHERE kind='bug' AND parent_id IS NOT NULL",
      )
      .all() as { id: string; parentId: string }[];
    for (const bug of nestedBugs) {
      db.prepare("INSERT INTO item_links VALUES (?,?,?,'related_to')").run(
        crypto.randomUUID(),
        bug.id,
        bug.parentId,
      );
      db.prepare("UPDATE tasks SET parent_id=NULL WHERE id=?").run(bug.id);
    }
    const bugs = db
      .prepare("SELECT id FROM tasks WHERE kind='bug' ORDER BY created_at,id")
      .all() as { id: string }[];
    for (const bug of bugs)
      db.prepare("UPDATE tasks SET public_id=? WHERE id=?").run(
        nextBugId(db),
        bug.id,
      );
    for (const section of SECTIONS) {
      const roots = db
        .prepare(
          "SELECT id FROM tasks WHERE section_id=? AND parent_id IS NULL ORDER BY position,created_at,id",
        )
        .all(section.id) as { id: string }[];
      roots.forEach((root, index) =>
        db
          .prepare("UPDATE tasks SET position=? WHERE id=?")
          .run(index, root.id),
      );
    }
    for (const link of db
      .prepare(
        "SELECT id,source_id sourceId,target_id targetId,relation FROM item_links",
      )
      .all())
      appendEvent(db, "items_linked", { link, by: "migration" });
    // Old commands did not contain complete item snapshots. Record a baseline
    // once so migrated content is also represented in the CQRS event history.
    for (const task of db.prepare(BASE_TASK_SELECT).all())
      appendEvent(db, "item_migrated", { task });
    db.prepare("INSERT INTO project_migrations VALUES (1)").run();
  }).immediate();
  db.transaction(() => {
    if (db.prepare("SELECT 1 FROM project_migrations WHERE version=2").get())
      return;
    db.exec("ALTER TABLE tasks ADD COLUMN completed_at TEXT");
    // Recover the transition into Done, ignoring later title edits/comments.
    const history = new Map<
      string,
      { state: TaskState; completedAt: string | null }
    >();
    const events = db
      .prepare(
        "SELECT type,data,timestamp FROM events WHERE type IN ('task_created','task_updated','item_migrated','item_created','item_updated','item_converted') ORDER BY rowid",
      )
      .all() as { type: string; data: string; timestamp: string }[];
    for (const event of events) {
      const data = JSON.parse(event.data);
      const row = data.task || data;
      const id = row.id;
      const state =
        row.ownState ||
        row.state ||
        (event.type === "task_created" ? "in_progress" : undefined);
      if (!id || !STATES.includes(state)) continue;
      const previous = history.get(id);
      const completedAt =
        state === "done"
          ? previous?.state === "done"
            ? previous.completedAt
            : row.updatedAt || event.timestamp
          : null;
      history.set(id, { state, completedAt });
    }
    const completed = db
      .prepare("SELECT id,updated_at updatedAt FROM tasks WHERE state='done'")
      .all() as { id: string; updatedAt: string }[];
    for (const task of completed) {
      db.prepare("UPDATE tasks SET completed_at=? WHERE id=?").run(
        history.get(task.id)?.completedAt || task.updatedAt,
        task.id,
      );
    }
    db.prepare("INSERT INTO project_migrations VALUES (2)").run();
  }).immediate();
  db.transaction(() => {
    if (db.prepare("SELECT 1 FROM project_migrations WHERE version=3").get())
      return;
    const features = db
      .prepare("SELECT id FROM tasks WHERE kind='feature' AND priority IS NULL")
      .all() as { id: string }[];
    for (const feature of features) {
      db.prepare("UPDATE tasks SET priority='P3' WHERE id=?").run(feature.id);
      appendEvent(db, "item_migrated", {
        task: ownTask(db, feature.id),
        reason: "feature_priorities",
      });
    }
    db.prepare("INSERT INTO project_migrations VALUES (3)").run();
  }).immediate();
  db.transaction(() => {
    if (db.prepare("SELECT 1 FROM project_migrations WHERE version=4").get())
      return;
    // Keep the states and completion dates people currently see before making
    // parent states independently editable. Child records stay unchanged.
    const parents = allTasks(db, true).filter((task) => !task.leaf);
    for (const parent of parents) {
      db.prepare("UPDATE tasks SET state=?,completed_at=? WHERE id=?").run(
        parent.state,
        parent.completedAt,
        parent.id,
      );
      appendEvent(db, "item_migrated", {
        task: ownTask(db, parent.id),
        reason: "independent_parent_states",
      });
    }
    db.prepare("INSERT INTO project_migrations VALUES (4)").run();
  }).immediate();
  return db;
}

export const hash = (value: string) =>
  crypto.createHash("sha256").update(value).digest("hex");
export const token = (bytes = 32) => crypto.randomBytes(bytes).toString("hex");
export function nextBugId(db: Database.Database): string {
  const row = db
    .prepare(
      "UPDATE project_sequences SET value=value+1 WHERE name='bug' RETURNING value",
    )
    .get() as { value: number };
  return `SAV-${String(row.value).padStart(6, "0")}`;
}
export function moveTree(db: Database.Database, id: string, sectionId: string) {
  db.prepare(
    `WITH RECURSIVE tree(id) AS (SELECT id FROM tasks WHERE id=? UNION ALL SELECT t.id FROM tasks t JOIN tree ON t.parent_id=tree.id) UPDATE tasks SET section_id=? WHERE id IN (SELECT id FROM tree)`,
  ).run(id, sectionId);
}
export function ensureBootstrapAdmin(
  db: Database.Database,
  email: string,
): User | null {
  const existing = db
    .prepare(`${USER_SELECT} WHERE lower(email)=lower(?)`)
    .get(email) as User | undefined;
  if (existing) return existing;
  const total = (
    db.prepare("SELECT COUNT(*) n FROM users").get() as { n: number }
  ).n;
  const owner = (process.env.OWNER_EMAIL || "sean@besavvier.com").toLowerCase();
  if (total > 0 || email.toLowerCase() !== owner) return null;
  return db
    .transaction(() => {
      const user = {
        id: crypto.randomUUID(),
        email: email.toLowerCase(),
        role: "admin" as const,
        name: "",
        avatarId: null,
      };
      db.prepare(
        "INSERT INTO users (id,email,role,created_at) VALUES (?,?,?,?)",
      ).run(user.id, user.email, user.role, new Date().toISOString());
      appendEvent(db, "user_bootstrapped", {
        userId: user.id,
        email: user.email,
        role: user.role,
      });
      return user;
    })
    .immediate();
}
export function userForSession(
  db: Database.Database,
  raw: string | undefined,
): User | null {
  if (!raw) return null;
  return (
    (db
      .prepare(
        `SELECT u.id,u.email,u.role,u.name,u.avatar_id avatarId FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`,
      )
      .get(hash(raw), Date.now()) as User | undefined) || null
  );
}
export function listUsers(db: Database.Database): User[] {
  return db.prepare(`${USER_SELECT} ORDER BY name,email`).all() as User[];
}
export function ownTask(
  db: Database.Database,
  id: string,
): TaskRecord | undefined {
  return db.prepare(`${TASK_SELECT} WHERE id=? OR public_id=?`).get(id, id) as
    | TaskRecord
    | undefined;
}
function aggregate(states: TaskState[], own: TaskState): TaskState {
  return states.length
    ? STATES[Math.min(...states.map((s) => STATES.indexOf(s)))]
    : own;
}
export function allTasks(db: Database.Database, legacyRollups = false): Task[] {
  const rows = db
    .prepare(`${TASK_SELECT} ORDER BY position,created_at,id`)
    .all() as Task[];
  const children = new Map<string, Task[]>();
  for (const row of rows)
    if (row.parentId)
      children.set(row.parentId, [...(children.get(row.parentId) || []), row]);
  const build = (row: Task): Task => {
    const nested = (children.get(row.id) || []).map(build);
    const state = legacyRollups
      ? aggregate(
          nested.map((c) => c.state),
          row.ownState,
        )
      : row.ownState;
    const completedAt =
      state !== "done"
        ? null
        : legacyRollups && nested.length
          ? nested
              .map((c) => c.completedAt || c.updatedAt)
              .sort()
              .at(-1) || null
          : row.completedAt;
    return {
      ...row,
      completedAt,
      children: nested,
      leaf: !nested.length,
      state,
    };
  };
  const roots = rows.filter((r) => !r.parentId).map(build);
  const flattened: Task[] = [];
  const collect = (task: Task) => {
    flattened.push(task);
    task.children.forEach(collect);
  };
  roots.forEach(collect);
  return flattened;
}
export function snapshot(db: Database.Database): Section[] {
  const rows = allTasks(db);
  return SECTIONS.map((section) => {
    const tasks = rows.filter((r) => r.sectionId === section.id && !r.parentId);
    if (section.id.startsWith("bugs-"))
      tasks.sort(
        (a, b) =>
          (a.priority || "P4").localeCompare(b.priority || "P4") ||
          b.createdAt.localeCompare(a.createdAt) ||
          b.id.localeCompare(a.id),
      );
    return { ...section, tasks };
  });
}
export function itemDetail(
  db: Database.Database,
  id: string,
): ItemDetail | null {
  const tasks = allTasks(db);
  const task = tasks.find((t) => t.id === id || t.publicId === id);
  if (!task) return null;
  const attachments = db
    .prepare(`${ATTACHMENT_SELECT} WHERE task_id=? ORDER BY created_at,rowid`)
    .all(task.id) as Attachment[];
  const comments = (
    db
      .prepare(
        "SELECT id,task_id taskId,user_id userId,body,created_at createdAt FROM comments WHERE task_id=? ORDER BY created_at,rowid",
      )
      .all(task.id) as Comment[]
  ).map((c) => ({
    ...c,
    attachments: attachments.filter((a) => a.commentId === c.id),
  }));
  const links = (
    db
      .prepare(
        "SELECT id,source_id sourceId,target_id targetId,relation FROM item_links WHERE source_id=? OR target_id=?",
      )
      .all(task.id, task.id) as ItemLink[]
  )
    .map((link) => ({
      ...link,
      incoming: link.targetId === task.id,
      other: tasks.find(
        (t) =>
          t.id === (link.sourceId === task.id ? link.targetId : link.sourceId),
      )!,
    }))
    .filter((l) => l.other);
  const followers = listUsers(db).filter(
    (u) =>
      !!db
        .prepare("SELECT 1 FROM followers WHERE task_id=? AND user_id=?")
        .get(task.id, u.id),
  );
  return {
    task,
    attachments: attachments.filter((a) => !a.commentId),
    comments,
    followers,
    links,
  };
}
