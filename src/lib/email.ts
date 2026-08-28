import nodemailer from "nodemailer";

/* Transactional email over SMTP (nodemailer, the same library 8examples
   sends with). Credentials arrive as env from the devops deploy: normally
   the claw's own Migadu mailbox (pulled just-in-time from 8examples at
   deploy, so the site mails as the business), otherwise the platform Gmail
   sender. Gated on SMTP_HOST/SMTP_USER/SMTP_PASS/EMAIL_FROM: unconfigured
   means return false so the caller leaves the message owed
   (deliver-then-record) and retries once it is set up. */

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
};

export type SmtpConfig = { host: string; port: number; secure: boolean; user: string; pass: string; from: string };

/* Port 465 is implicit TLS; anything else is plain + STARTTLS when offered.
   SMTP_SECURE=0/1 forces it either way. */
export function smtpConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SmtpConfig | null {
  const host = env.SMTP_HOST;
  const user = env.SMTP_USER;
  const pass = env.SMTP_PASS;
  const from = env.EMAIL_FROM;
  if (!host || !user || !pass || !from) return null;
  const port = Number(env.SMTP_PORT) || 465;
  const secure = env.SMTP_SECURE != null ? env.SMTP_SECURE === "1" : port === 465;
  return { host, port, secure, user, pass, from };
}

let warned = false;

export async function sendEmail(msg: EmailMessage): Promise<boolean> {
  const cfg = smtpConfigFromEnv();
  if (!cfg) {
    if (!warned) console.warn("SMTP_HOST/SMTP_USER/SMTP_PASS/EMAIL_FROM not set; skipping email delivery");
    warned = true;
    return false;
  }
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  try {
    await transport.sendMail({
      from: cfg.from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      replyTo: msg.replyTo || undefined,
    });
    return true;
  } catch (err) {
    console.error(`smtp send to ${msg.to} failed:`, err instanceof Error ? err.message : err);
    return false;
  } finally {
    transport.close();
  }
}
