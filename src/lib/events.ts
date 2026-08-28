import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

/* Append-only event store, one SQLite file per site (per-tenant isolation,
   the inventory-shopify pattern). Every feature on the site, booking,
   payments, and future integrations, folds from this single log. */

export type StoredEvent = { id: string; type: string; data: string; timestamp: string };

export function openDb(dbPath?: string): Database.Database {
  const file = dbPath || process.env.DB_PATH || path.join(process.cwd(), "data", "site.db");
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      data TEXT NOT NULL,
      timestamp TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
  `);
  return db;
}

export function appendEvent(db: Database.Database, type: string, data: object, at?: string): string {
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO events (id, type, data, timestamp) VALUES (?, ?, ?, ?)").run(
    id,
    type,
    JSON.stringify(data),
    at || new Date().toISOString()
  );
  return id;
}

export function readEvents(db: Database.Database, types?: string[]): { type: string; data: Record<string, unknown> }[] {
  const rows = (
    types && types.length
      ? db
          .prepare(`SELECT type, data FROM events WHERE type IN (${types.map(() => "?").join(",")}) ORDER BY rowid`)
          .all(...types)
      : db.prepare("SELECT type, data FROM events ORDER BY rowid").all()
  ) as { type: string; data: string }[];
  return rows.map((r) => ({ type: r.type, data: JSON.parse(r.data) as Record<string, unknown> }));
}
