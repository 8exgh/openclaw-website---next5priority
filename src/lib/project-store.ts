import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { appendEvent, openDb } from "./events.ts";

export type Role = "read" | "edit" | "admin";
export type TaskState = "in_progress" | "in_qa" | "done";
export type User = { id: string; email: string; role: Role };

export function projectDb() {
  const db = openDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS login_codes (email TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS user_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sections (id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, section_id TEXT NOT NULL, parent_id TEXT, title TEXT NOT NULL, state TEXT NOT NULL, position INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS api_keys (id TEXT PRIMARY KEY, name TEXT NOT NULL, key_hash TEXT UNIQUE NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL);
  `);
  const count = (db.prepare("SELECT COUNT(*) n FROM sections").get() as { n: number }).n;
  if (!count) {
    ["Top 5 Priorities", "In QA", "Patches", "Backlog", "Inbox"].forEach((name, position) =>
      db.prepare("INSERT INTO sections VALUES (?, ?, ?)").run(crypto.randomUUID(), name, position),
    );
  }
  return db;
}

export const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
export const token = (bytes = 32) => crypto.randomBytes(bytes).toString("hex");

export function ensureBootstrapAdmin(db: Database.Database, email: string): User | null {
  const existing = db.prepare("SELECT id,email,role FROM users WHERE lower(email)=lower(?)").get(email) as User | undefined;
  if (existing) return existing;
  const total = (db.prepare("SELECT COUNT(*) n FROM users").get() as { n: number }).n;
  const owner = (process.env.OWNER_EMAIL || "sean@besavvier.com").toLowerCase();
  if (total > 0 || email.toLowerCase() !== owner) return null;
  const user = { id: crypto.randomUUID(), email: email.toLowerCase(), role: "admin" as const };
  db.prepare("INSERT INTO users VALUES (?, ?, ?, ?)").run(user.id, user.email, user.role, new Date().toISOString());
  appendEvent(db, "user_bootstrapped", { userId: user.id, email: user.email, role: user.role });
  return user;
}

export function userForSession(db: Database.Database, raw: string | undefined): User | null {
  if (!raw) return null;
  return (db.prepare(`SELECT u.id,u.email,u.role FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).get(hash(raw), Date.now()) as User | undefined) || null;
}

export function projectedState(db: Database.Database, taskId: string, own: TaskState): TaskState {
  const children = db.prepare("SELECT id,state FROM tasks WHERE parent_id=? ORDER BY position").all(taskId) as { id: string; state: TaskState }[];
  if (!children.length) return own;
  const states = children.map((child) => projectedState(db, child.id, child.state));
  if (states.every((state) => state === "done")) return "done";
  if (states.every((state) => state === "done" || state === "in_qa") && states.some((state) => state === "in_qa")) return "in_qa";
  return "in_progress";
}

export function snapshot(db: Database.Database) {
  const sections = db.prepare("SELECT id,name,position FROM sections ORDER BY position").all() as { id: string; name: string; position: number }[];
  const rows = db.prepare("SELECT id,section_id sectionId,parent_id parentId,title,state,position FROM tasks ORDER BY position").all() as { id: string; sectionId: string; parentId: string | null; title: string; state: TaskState; position: number }[];
  const build = (sectionId: string, parentId: string | null): unknown[] => rows.filter((r) => r.sectionId === sectionId && r.parentId === parentId).map((r) => {
    const children = build(sectionId, r.id);
    return { ...r, state: projectedState(db, r.id, r.state), leaf: children.length === 0, children };
  });
  return sections.map((section) => ({ ...section, tasks: build(section.id, null) }));
}
