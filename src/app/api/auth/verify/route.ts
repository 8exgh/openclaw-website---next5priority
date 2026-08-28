import { NextRequest, NextResponse } from "next/server";
import { hash, projectDb, token } from "../../../../lib/project-store";

export async function POST(req: NextRequest) {
  const body = await req.json(); const email = String(body.email || "").toLowerCase(); const code = String(body.code || "");
  const db = projectDb();
  const valid = db.prepare("SELECT 1 FROM login_codes WHERE email=? AND code_hash=? AND expires_at>?").get(email, hash(code), Date.now());
  const user = db.prepare("SELECT id,email,role FROM users WHERE email=?").get(email) as { id: string } | undefined;
  if (!valid || !user) { db.close(); return NextResponse.json({ error: "That code is invalid or expired." }, { status: 401 }); }
  const raw = token(); db.prepare("DELETE FROM login_codes WHERE email=?").run(email); db.prepare("INSERT INTO user_sessions VALUES (?, ?, ?)").run(hash(raw), user.id, Date.now() + 30 * 86400_000); db.close();
  const res = NextResponse.json({ ok: true }); res.cookies.set("n5p_session", raw, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 30 * 86400, path: "/" }); return res;
}
