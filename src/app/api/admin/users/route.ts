import crypto from "node:crypto";
import { after, NextRequest, NextResponse } from "next/server";
import { appendEvent } from "../../../../lib/events";
import { allowed, requestUser } from "../../../../lib/request-auth";
import {
  listUsers,
  projectDb,
  USER_SELECT,
  type Role,
  type User,
} from "../../../../lib/project-store";
import {
  notifyProjectInBackground,
  queueEmail,
} from "../../../../lib/project-notifications";
import { ProjectError } from "../../../../lib/project-errors";
import { projectError } from "../../../../lib/project-http";
export async function GET(req: NextRequest) {
  const db = projectDb();
  try {
    if (!allowed(requestUser(req, db), "admin"))
      throw new ProjectError("Admin required", 403);
    return NextResponse.json({ users: listUsers(db) });
  } catch (error) {
    return projectError(error);
  } finally {
    db.close();
  }
}
export async function POST(req: NextRequest) {
  const db = projectDb();
  try {
    const actor = requestUser(req, db);
    if (!allowed(actor, "admin")) throw new ProjectError("Admin required", 403);
    const b = await req.json();
    const email = String(b.email || "")
      .trim()
      .toLowerCase();
    const role = String(b.role || "read") as Role;
    if (
      !/^\S+@\S+\.\S+$/.test(email) ||
      !["read", "edit", "admin"].includes(role)
    )
      throw new ProjectError("Valid email and role required");
    db.transaction(() => {
      const existing = db.prepare(`${USER_SELECT} WHERE email=?`).get(email) as
        | User
        | undefined;
      if (
        existing?.role === "admin" &&
        role !== "admin" &&
        (
          db
            .prepare("SELECT COUNT(*) n FROM users WHERE role='admin'")
            .get() as { n: number }
        ).n <= 1
      )
        throw new ProjectError("Keep at least one administrator.", 409);
      db.prepare(
        "INSERT INTO users (id,email,role,created_at) VALUES (?,?,?,?) ON CONFLICT(email) DO UPDATE SET role=excluded.role",
      ).run(crypto.randomUUID(), email, role, new Date().toISOString());
      const user = db
        .prepare(`${USER_SELECT} WHERE email=?`)
        .get(email) as User;
      const eventId = appendEvent(db, "user_invited", { user, by: actor!.id });
      queueEmail(db, eventId, user, {
        subject: "You have been invited to Next 5 Priority",
        text: `You now have ${role} access. Sign in with your email code.`,
        linkPath: "/",
      });
    }).immediate();
    after(notifyProjectInBackground);
    return NextResponse.json({ ok: true, users: listUsers(db) });
  } catch (error) {
    return projectError(error);
  } finally {
    db.close();
  }
}
