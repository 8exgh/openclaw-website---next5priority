import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "../../../../lib/email";
import {
  ensureBootstrapAdmin,
  hash,
  projectDb,
} from "../../../../lib/project-store";

export async function POST(req: NextRequest) {
  const email = String((await req.json()).email || "")
    .trim()
    .toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email))
    return NextResponse.json(
      { error: "Enter a valid email." },
      { status: 400 },
    );
  const db = projectDb();
  const user =
    ensureBootstrapAdmin(db, email) ||
    db.prepare("SELECT id FROM users WHERE lower(email)=lower(?)").get(email);
  if (user) {
    const code = String(crypto.randomInt(100000, 1000000));
    db.prepare("INSERT OR REPLACE INTO login_codes VALUES (?, ?, ?)").run(
      email,
      hash(code),
      Date.now() + 10 * 60_000,
    );
    await sendEmail({
      to: email,
      subject: `${code} is your Next 5 Priority login code`,
      text: `Your login code is ${code}. It expires in 10 minutes.`,
    });
    if (process.env.NODE_ENV !== "production")
      console.log(`Login code for ${email}: ${code}`);
  }
  db.close();
  return NextResponse.json({ ok: true });
}
