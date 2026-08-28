import type Database from "better-sqlite3";
import type { NextRequest } from "next/server";
import { hash, type Role, type User, userForSession } from "./project-store";

const rank: Record<Role, number> = { read: 0, edit: 1, admin: 2 };

export function requestUser(req: NextRequest, db: Database.Database): User | null {
  const bearer = req.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (bearer) {
    const key = db.prepare("SELECT id,name,role FROM api_keys WHERE key_hash=?").get(hash(bearer)) as { id: string; name: string; role: Role } | undefined;
    if (key) return { id: `api:${key.id}`, email: key.name, role: key.role };
  }
  return userForSession(db, req.cookies.get("n5p_session")?.value);
}

export function allowed(user: User | null, needed: Role) { return !!user && rank[user.role] >= rank[needed]; }
