import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

/* Shared setup for the browser specs: where the mocks wrote what they
   received, and just enough MIME parsing that a test can assert on a
   subject or a sentence instead of on quoted-printable. */

const root = path.resolve(process.cwd());
export const E2E = JSON.parse(
  fs.readFileSync(path.join(root, "tests/e2e/e2e.config.json"), "utf8")
) as {
  host: string; port: number; webhookPort: number; smtpPort: number;
  artifactDir: string; dbFile: string; webhookLog: string; mailLog: string;
  smtpModeFile: string; clawKey: string; claw: string; ownerEmail: string;
  smtpUser: string; emailFrom: string; timeZone: string;
};
export const BASE_URL = `http://${E2E.host}:${E2E.port}`;

/* Read from the site's own config so the suite travels between customer
   sites unchanged; the emails quote whatever this repo is branded as. */
export const BUSINESS_NAME =
  /businessName:\s*"([^"]*)"/.exec(fs.readFileSync(path.join(root, "src/lib/config.ts"), "utf8"))?.[1] ?? "";

const abs = (p: string) => path.join(root, p);

function readLines<T>(file: string): T[] {
  if (!fs.existsSync(abs(file))) return [];
  return fs
    .readFileSync(abs(file), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T);
}

/* --- Rocket.Chat ------------------------------------------------------ */

export type ChatPost = { url: string; body: { text: string; alias?: string; channel?: string } };

export const chatPosts = (): ChatPost[] => readLines<ChatPost>(E2E.webhookLog);

/* --- Email ------------------------------------------------------------ */

export type Mail = {
  to: string; from: string; replyTo: string; subject: string; text: string; html: string; raw: string;
};

function decodeQuotedPrintable(s: string): string {
  return s
    .replace(/=(?:\r?\n)/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/* RFC 2047 encoded-words, as used for a long or non-ASCII Subject. */
function decodeWords(s: string): string {
  return s.replace(/=\?[^?]+\?([QqBb])\?([^?]*)\?=/g, (_, enc: string, text: string) =>
    enc.toUpperCase() === "B"
      ? Buffer.from(text, "base64").toString("utf8")
      : decodeQuotedPrintable(text.replace(/_/g, " "))
  );
}

function decodeBody(body: string, encoding: string): string {
  const e = encoding.toLowerCase();
  if (e === "quoted-printable") return decodeQuotedPrintable(body);
  if (e === "base64") return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
  return body;
}

function splitMessage(raw: string): { headers: Map<string, string>; body: string } {
  const at = raw.indexOf("\n\n");
  // Unfold continuation lines in the headers only, so a folded Subject reads
  // as one line. The body must stay byte-exact: unfolding it would turn a
  // quoted-printable soft break into a literal "= " and corrupt the text.
  const head = (at === -1 ? raw : raw.slice(0, at)).replace(/\n[ \t]+/g, " ");
  const body = at === -1 ? "" : raw.slice(at + 2);
  const headers = new Map<string, string>();
  for (const line of head.split("\n")) {
    const c = line.indexOf(":");
    if (c > 0) headers.set(line.slice(0, c).trim().toLowerCase(), line.slice(c + 1).trim());
  }
  return { headers, body };
}

/* Returns the decoded text/plain and text/html parts of a message that
   nodemailer sent as multipart/alternative (or as a single part). */
function parts(raw: string): { text: string; html: string } {
  const { headers, body } = splitMessage(raw);
  const contentType = headers.get("content-type") ?? "";
  const boundary = /boundary="?([^";]+)"?/i.exec(contentType)?.[1];
  if (!boundary) {
    const decoded = decodeBody(body, headers.get("content-transfer-encoding") ?? "");
    return contentType.includes("text/html") ? { text: "", html: decoded } : { text: decoded, html: "" };
  }
  const out = { text: "", html: "" };
  for (const chunk of body.split(`--${boundary}`)) {
    const trimmed = chunk.replace(/^\r?\n/, "");
    if (!trimmed || trimmed.startsWith("--")) continue;
    const sub = splitMessage(trimmed);
    const type = sub.headers.get("content-type") ?? "";
    const decoded = decodeBody(sub.body, sub.headers.get("content-transfer-encoding") ?? "");
    if (type.includes("text/html")) out.html = decoded;
    else if (type.includes("text/plain")) out.text = decoded;
    else if (type.includes("multipart/")) {
      const nested = parts(trimmed);
      out.text ||= nested.text;
      out.html ||= nested.html;
    }
  }
  return out;
}

export function mails(): Mail[] {
  return readLines<{ rcpt: string[]; raw: string }>(E2E.mailLog).map((m) => {
    const { headers } = splitMessage(m.raw);
    const { text, html } = parts(m.raw);
    return {
      to: (m.rcpt[0] ?? "").replace(/[<>]/g, ""),
      from: decodeWords(headers.get("from") ?? ""),
      replyTo: decodeWords(headers.get("reply-to") ?? ""),
      subject: decodeWords(headers.get("subject") ?? ""),
      text,
      html,
      raw: m.raw,
    };
  });
}

export const mailsTo = (address: string): Mail[] => mails().filter((m) => m.to === address);

/* --- Per-test state --------------------------------------------------- */

/* Wipes the event log. The site re-seeds its default availability on the
   next request, so every spec starts from the same open calendar. */
export function resetSite(): void {
  for (const f of [E2E.webhookLog, E2E.mailLog]) fs.writeFileSync(abs(f), "");
  setSmtpMode("ok");
  const file = abs(E2E.dbFile);
  if (!fs.existsSync(file)) return;
  const db = new Database(file);
  try {
    db.prepare("DELETE FROM events").run();
  } catch {
    // The table appears on the site's first request.
  } finally {
    db.close();
  }
}

export function setSmtpMode(mode: "ok" | "fail"): void {
  fs.writeFileSync(abs(E2E.smtpModeFile), mode);
}

export function events(): { type: string; data: Record<string, unknown> }[] {
  const file = abs(E2E.dbFile);
  if (!fs.existsSync(file)) return [];
  const db = new Database(file, { readonly: true });
  try {
    return (db.prepare("SELECT type, data FROM events ORDER BY rowid").all() as { type: string; data: string }[])
      .map((r) => ({ type: r.type, data: JSON.parse(r.data) as Record<string, unknown> }));
  } catch {
    return [];
  } finally {
    db.close();
  }
}

/* The confirm token never leaves the event log, so a spec that needs to act
   as the owner reads it the way the owner's notification would carry it. */
export function confirmTokenFor(email: string): string {
  const booking = events()
    .filter((e) => e.type === "booking_requested" && e.data.email === email)
    .at(-1);
  return String(booking?.data.confirmToken ?? "");
}
