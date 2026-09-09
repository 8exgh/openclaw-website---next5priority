import { NextRequest, NextResponse } from "next/server";
import { ProjectError } from "./project-errors.ts";
import {
  MAX_UPLOAD_BYTES,
  readUploads,
  type Upload,
} from "./project-assets.ts";

export async function commandBody(
  req: NextRequest,
): Promise<{ input: Record<string, unknown>; uploads: Upload[] }> {
  if (
    Number(req.headers.get("content-length")) >
    MAX_UPLOAD_BYTES + 1024 * 1024
  )
    throw new ProjectError("Request is too large. Attach at most 25 MB.", 413);
  if (req.headers.get("content-type")?.includes("multipart/form-data")) {
    const form = await req.formData();
    const input = JSON.parse(String(form.get("data") || "{}"));
    if (!input || Array.isArray(input) || typeof input !== "object")
      throw new ProjectError("Expected an object.");
    return { input, uploads: await readUploads(form) };
  }
  const input = await req.json();
  if (!input || Array.isArray(input) || typeof input !== "object")
    throw new ProjectError("Expected an object.");
  return { input, uploads: [] };
}
export function projectError(error: unknown) {
  if (error instanceof ProjectError)
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  if (error instanceof SyntaxError)
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  console.error("Project request failed:", error);
  return NextResponse.json(
    { error: "Unable to complete this request. Please try again." },
    { status: 500 },
  );
}
