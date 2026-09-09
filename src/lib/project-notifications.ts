import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { appendEvent } from "./events.ts";
import { sendEmail, type EmailMessage } from "./email.ts";
import { projectDb, USER_SELECT } from "./project-store.ts";
import {
  userName,
  type TaskRecord as Task,
  type User,
} from "./project-types.ts";

// The outbox and the source command commit together. Message bodies capture
// the event at that time, so later edits cannot change a queued notification.
type QueuedEmail = EmailMessage & { linkPath?: string };
export function queueEmail(
  db: Database.Database,
  eventId: string,
  recipient: User,
  message: Omit<QueuedEmail, "to">,
) {
  const id = crypto.randomUUID();
  const email = { ...message, to: recipient.email };
  const inserted = db
    .prepare(
      "INSERT OR IGNORE INTO project_outbox (id,event_id,recipient_id,message) VALUES (?,?,?,?)",
    )
    .run(id, eventId, recipient.id, JSON.stringify(email));
  if (inserted.changes)
    appendEvent(db, "project_notification_queued", {
      id,
      eventId,
      recipientId: recipient.id,
      message: email,
    });
}
export function itemAudience(db: Database.Database, task: Task): string[] {
  const followers = db
    .prepare("SELECT user_id id FROM followers WHERE task_id=?")
    .all(task.id) as { id: string }[];
  return [
    ...new Set(
      [
        task.createdBy,
        task.implementorId,
        task.reviewerId,
        ...followers.map((f) => f.id),
      ].filter((id): id is string => !!id),
    ),
  ];
}
export function queueItemNotification(
  db: Database.Database,
  eventId: string,
  task: Task,
  actor: User,
  recipients: string[],
  action: string,
  detail = "",
) {
  const label = task.publicId || "Feature";
  for (const id of new Set(recipients)) {
    const recipient = db.prepare(`${USER_SELECT} WHERE id=?`).get(id) as
      | User
      | undefined;
    if (!recipient) continue;
    // Relative link is expanded only by the worker using the trusted SITE_URL.
    queueEmail(db, eventId, recipient, {
      subject: `${label}: ${action} — ${task.title}`.replace(/[\r\n]/g, " "),
      text: `${userName(actor)} ${action.toLowerCase()}: ${label} — ${task.title}\n\n${detail}`,
      linkPath: `/?item=${encodeURIComponent(task.publicId || task.id)}`,
    });
  }
}
type OutboxRow = { id: string; message: string; attempts: number };
export type ProjectNotifyOptions = {
  email?: (message: EmailMessage) => Promise<boolean>;
  siteUrl?: string;
  now?: number;
};
export async function runProjectNotifications(
  db: Database.Database,
  opts: ProjectNotifyOptions = {},
) {
  const sweepTime = opts.now ?? Date.now();
  const url = (opts.siteUrl ?? process.env.SITE_URL ?? "").replace(/\/+$/, "");
  const pending = db
    .prepare(
      "SELECT id,message,attempts FROM project_outbox WHERE sent_at IS NULL AND next_attempt_at<=? AND lease_until<=? ORDER BY rowid LIMIT 100",
    )
    .all(sweepTime, sweepTime) as OutboxRow[];
  const result = { owed: pending.length, sent: 0, failed: 0 };
  for (const row of pending) {
    const now = opts.now ?? Date.now();
    // Cross-process lease, claimed immediately before delivery, avoids two
    // workers delivering the same pending message during overlapping sweeps.
    const claim = db
      .prepare(
        "UPDATE project_outbox SET lease_until=? WHERE id=? AND sent_at IS NULL AND lease_until<=? AND next_attempt_at<=?",
      )
      .run(now + 120_000, row.id, now, now);
    if (!claim.changes) continue;
    const { linkPath, ...message } = JSON.parse(row.message) as QueuedEmail;
    if (linkPath) message.text += `\n\nOpen Next 5 Priority: ${url}${linkPath}`;
    let ok = false;
    try {
      if (/^https?:\/\//.test(url))
        ok = await (opts.email || sendEmail)(message);
    } catch {
      /* A provider exception remains retryable. */
    }
    if (ok) {
      db.transaction(() => {
        appendEvent(db, "project_notification_sent", {
          notificationId: row.id,
          to: message.to,
        });
        db.prepare(
          "UPDATE project_outbox SET sent_at=?,lease_until=0 WHERE id=?",
        ).run(new Date(now).toISOString(), row.id);
      })();
      result.sent++;
    } else {
      const delay = Math.min(
        3_600_000,
        30_000 * 2 ** Math.min(row.attempts, 7),
      );
      db.prepare(
        "UPDATE project_outbox SET attempts=attempts+1,next_attempt_at=?,lease_until=0 WHERE id=?",
      ).run(now + delay, row.id);
      result.failed++;
    }
  }
  return result;
}
export async function notifyProjectInBackground(): Promise<void> {
  const db = projectDb();
  try {
    await runProjectNotifications(db);
  } catch (error) {
    console.error("Project notification sweep failed:", error);
  } finally {
    db.close();
  }
}
