import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { ProjectError } from "./project-errors.ts";
import type { Attachment } from "./project-types.ts";

export type Upload = { name: string; data: Buffer };
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export function assetsDirectory(): string {
  return (
    process.env.ASSETS_PATH ||
    path.join(
      path.dirname(
        process.env.DB_PATH || path.join(process.cwd(), "data", "site.db"),
      ),
      "assets",
    )
  );
}
export function imageMime(data: Buffer): string | null {
  if (
    data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (data[0] === 255 && data[1] === 216 && data[2] === 255)
    return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(data.subarray(0, 6).toString()))
    return "image/gif";
  if (
    data.subarray(0, 4).toString() === "RIFF" &&
    data.subarray(8, 12).toString() === "WEBP"
  )
    return "image/webp";
  return null;
}
export function validateUploads(uploads: Upload[], avatar = false) {
  if (
    uploads.length > 10 ||
    uploads.reduce((sum, file) => sum + file.data.length, 0) > MAX_UPLOAD_BYTES
  )
    throw new ProjectError(
      "Attach up to 10 files, totaling at most 25 MB.",
      413,
    );
  for (const file of uploads) {
    if (!file.name || file.name.length > 255)
      throw new ProjectError("File names must contain 1–255 characters.");
    if (avatar && (!imageMime(file.data) || file.data.length > 5 * 1024 * 1024))
      throw new ProjectError(
        "Use a PNG, JPEG, GIF or WebP profile picture under 5 MB.",
      );
  }
}
export async function readUploads(form: FormData): Promise<Upload[]> {
  const files = form
    .getAll("files")
    .filter(
      (value): value is File => typeof value !== "string" && !!value.name,
    );
  if (
    files.length > 10 ||
    files.reduce((sum, file) => sum + file.size, 0) > MAX_UPLOAD_BYTES
  )
    throw new ProjectError(
      "Attach up to 10 files, totaling at most 25 MB.",
      413,
    );
  return Promise.all(
    files.map(async (file) => ({
      name: file.name,
      data: Buffer.from(await file.arrayBuffer()),
    })),
  );
}
// Run synchronously inside the command's SQLite transaction. On rollback the
// command removes its newly created directories; no file can be served without
// a committed attachment row and an authenticated, authorized request.
export function saveUploads(
  db: Database.Database,
  eventId: string,
  uploads: Upload[],
  context: { taskId?: string; commentId?: string; userId: string },
): Attachment[] {
  if (!uploads.length) return [];
  const dir = path.join(assetsDirectory(), eventId);
  fs.mkdirSync(dir, { recursive: true });
  return uploads.map((file) => {
    const id = crypto.randomUUID();
    const name =
      path
        .basename(file.name.replaceAll("\\", "/"))
        .replace(/[\x00-\x1f\x7f]/g, "_") || "attachment";
    const storageName = id;
    const attachment: Attachment = {
      id,
      eventId,
      taskId: context.taskId || null,
      commentId: context.commentId || null,
      userId: context.userId,
      name,
      mime: imageMime(file.data) || "application/octet-stream",
      size: file.data.length,
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(dir, storageName), file.data, {
      flag: "wx",
      mode: 0o600,
    });
    db.prepare("INSERT INTO attachments VALUES (?,?,?,?,?,?,?,?,?,?)").run(
      id,
      eventId,
      attachment.taskId,
      attachment.commentId,
      context.userId,
      name,
      attachment.mime,
      attachment.size,
      storageName,
      attachment.createdAt,
    );
    return attachment;
  });
}
export function removeUploadEvent(eventId: string) {
  fs.rmSync(path.join(assetsDirectory(), eventId), {
    recursive: true,
    force: true,
  });
}
