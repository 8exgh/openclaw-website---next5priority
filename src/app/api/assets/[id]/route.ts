import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { projectDb } from "../../../../lib/project-store";
import { requestUser } from "../../../../lib/request-auth";
import { assetsDirectory } from "../../../../lib/project-assets";
import { ProjectError } from "../../../../lib/project-errors";
import { projectError } from "../../../../lib/project-http";
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const db = projectDb();
  try {
    if (!requestUser(req, db)) throw new ProjectError("Unauthorized", 401);
    const { id } = await context.params;
    const row = db.prepare("SELECT * FROM attachments WHERE id=?").get(id) as
      | {
          event_id: string;
          storage_name: string;
          task_id: string | null;
          name: string;
          mime: string;
        }
      | undefined;
    if (
      !row ||
      (row.task_id &&
        !db.prepare("SELECT 1 FROM tasks WHERE id=?").get(row.task_id))
    )
      throw new ProjectError("Attachment not found.", 404);
    if (
      !row.task_id &&
      !db.prepare("SELECT 1 FROM users WHERE avatar_id=?").get(id)
    )
      throw new ProjectError("Profile picture not found.", 404);
    const file = path.join(assetsDirectory(), row.event_id, row.storage_name);
    if (!fs.existsSync(file))
      throw new ProjectError("Attachment file is unavailable.", 404);
    const inline =
      row.mime.startsWith("image/") &&
      req.nextUrl.searchParams.get("download") !== "1";
    return new NextResponse(fs.readFileSync(file), {
      headers: {
        "Content-Type": row.mime,
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(row.name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    return projectError(error);
  } finally {
    db.close();
  }
}
