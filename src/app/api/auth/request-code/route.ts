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
  try {
    const user =
      ensureBootstrapAdmin(db, email) ||
      db.prepare("SELECT id FROM users WHERE lower(email)=lower(?)").get(email);
    if (user) {
      const code = String(crypto.randomInt(100000, 1000000));
      const sent = await sendEmail({
        to: email,
        subject: `${code} is your Next 5 Priority login code`,
        text: `Your login code is ${code}. It expires in 10 minutes.`,
      });
      if (!sent)
        return NextResponse.json(
          { error: "We couldn't send a login code. Please try again shortly." },
          { status: 503 },
        );
      // A failed resend must not replace a code that was already delivered.
      db.prepare("INSERT OR REPLACE INTO login_codes VALUES (?, ?, ?)").run(
        email,
        hash(code),
        Date.now() + 10 * 60_000,
      );
    }
    return NextResponse.json({ ok: true });
  } finally {
    db.close();
  }
}
