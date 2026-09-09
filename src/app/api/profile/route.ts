import { NextRequest, NextResponse } from "next/server";
import { projectDb } from "../../../lib/project-store";
import { requestUser } from "../../../lib/request-auth";
import { updateProfile } from "../../../lib/project-commands";
import { commandBody, projectError } from "../../../lib/project-http";
import { ProjectError } from "../../../lib/project-errors";
export async function PATCH(req: NextRequest) {
  const db = projectDb();
  try {
    const user = requestUser(req, db);
    if (!user) throw new ProjectError("Unauthorized", 401);
    const { input, uploads } = await commandBody(req);
    return NextResponse.json({ user: updateProfile(db, user, input, uploads) });
  } catch (error) {
    return projectError(error);
  } finally {
    db.close();
  }
}
