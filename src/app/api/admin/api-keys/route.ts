import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { allowed, requestUser } from "../../../../lib/request-auth";
import {
  hash,
  projectDb,
  token,
  type Role,
} from "../../../../lib/project-store";
export async function GET(req: NextRequest) {
  const db = projectDb();
  const u = requestUser(req, db);
  if (!allowed(u, "admin")) {
    db.close();
    return NextResponse.json({ error: "Admin required" }, { status: 403 });
  }
  const keys = db
    .prepare(
      "SELECT id,name,role,created_at createdAt FROM api_keys ORDER BY created_at DESC",
    )
    .all();
  db.close();
  return NextResponse.json({ keys });
}
export async function POST(req: NextRequest) {
  const db = projectDb();
  const u = requestUser(req, db);
  if (!allowed(u, "admin")) {
    db.close();
    return NextResponse.json({ error: "Admin required" }, { status: 403 });
  }
  const b = await req.json();
  const role = (b.role || "edit") as Role;
  if (!["read", "edit", "admin"].includes(role)) {
    db.close();
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }
  const raw = `n5p_${token(24)}`;
  db.prepare("INSERT INTO api_keys VALUES (?,?,?,?,?)").run(
    crypto.randomUUID(),
    String(b.name || "Bot"),
    hash(raw),
    role,
    new Date().toISOString(),
  );
  db.close();
  return NextResponse.json({ key: raw });
}
