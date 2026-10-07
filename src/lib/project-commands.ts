import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { appendEvent } from "./events.ts";
import { ProjectError } from "./project-errors.ts";
import { isSprintId } from "./sprints.ts";
import {
  removeUploadEvent,
  saveUploads,
  validateUploads,
  type Upload,
} from "./project-assets.ts";
import {
  itemAudience,
  queueItemNotification,
} from "./project-notifications.ts";
import { itemDetail, moveTree, nextBugId, ownTask } from "./project-store.ts";
import {
  EFFORTS,
  PRIORITIES,
  STATES,
  STATE_LABELS,
  userName,
  type Effort,
  type ItemKind,
  type Priority,
  type TaskRecord as Task,
  type TaskState,
  type User,
} from "./project-types.ts";

type Input = Record<string, unknown>;
function text(
  input: unknown,
  label: string,
  max: number,
  required = false,
): string {
  if (
    typeof input !== "string" ||
    input.length > max ||
    (required && !input.trim())
  )
    throw new ProjectError(
      `${label} ${required ? "is required and " : ""}must be at most ${max.toLocaleString()} characters.`,
    );
  return required ? input.trim() : input;
}
function enumValue<T extends string>(
  value: unknown,
  values: readonly T[],
  label: string,
): T {
  if (!values.includes(value as T)) throw new ProjectError(`Invalid ${label}.`);
  return value as T;
}
function effortValue(value: unknown): Effort | null {
  if (value === null || value === undefined || value === "") return null;
  const effort =
    typeof value === "string" && value.trim() ? Number(value) : value;
  if (!EFFORTS.includes(effort as Effort))
    throw new ProjectError(
      "Effort must be a whole number from 1 (low) to 5 (high).",
    );
  return effort as Effort;
}
function assignee(db: Database.Database, value: unknown): string | null {
  if (value === null || value === "" || value === undefined) return null;
  if (
    typeof value !== "string" ||
    !db.prepare("SELECT 1 FROM users WHERE id=?").get(value)
  )
    throw new ProjectError("Choose an existing teammate for the assignment.");
  return value;
}
function sprintValue(value: unknown, parentId: string | null): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (parentId) throw new ProjectError("Only root items can be assigned to a sprint.");
  if (!isSprintId(value))
    throw new ProjectError("Choose a Monday–Sunday sprint in YYYY-MM-dd-to-MM-dd format.");
  return value;
}
function requireTask(db: Database.Database, id: unknown): Task {
  const task = typeof id === "string" ? ownTask(db, id) : undefined;
  if (!task) throw new ProjectError("Item not found.", 404);
  return task;
}
function writable(user: User) {
  if (user.role === "read")
    throw new ProjectError("Edit access required.", 403);
}
function personal(user: User) {
  if (user.id.startsWith("api:"))
    throw new ProjectError(
      "Sign in with a personal account to follow items or edit a profile.",
      403,
    );
}
function featureSection(value: unknown): string {
  return enumValue(value, ["next-five", "feature-backlog"], "feature list");
}
function checkCapacity(db: Database.Database) {
  const { count } = db
    .prepare(
      "SELECT COUNT(*) count FROM tasks WHERE kind='feature' AND parent_id IS NULL AND section_id='next-five'",
    )
    .get() as { count: number };
  if (count >= 5)
    throw new ProjectError(
      "Next 5 is full. Move a feature back to the backlog first.",
      409,
    );
}
function normalizePositions(db: Database.Database, sectionId: string) {
  const ids = db
    .prepare(
      "SELECT id FROM tasks WHERE section_id=? AND parent_id IS NULL ORDER BY position,created_at,id",
    )
    .all(sectionId) as { id: string }[];
  ids.forEach((task, index) =>
    db.prepare("UPDATE tasks SET position=? WHERE id=?").run(index, task.id),
  );
}
function command<T>(
  db: Database.Database,
  uploads: Upload[],
  run: (
    attach: (
      eventId: string,
      taskId?: string,
      commentId?: string,
      userId?: string,
    ) => void,
  ) => T,
): T {
  validateUploads(uploads);
  const uploadEvents: string[] = [];
  try {
    return db
      .transaction(() =>
        run((eventId, taskId, commentId, userId) => {
          if (!uploads.length) return;
          uploadEvents.push(eventId);
          const attachments = saveUploads(db, eventId, uploads, {
            taskId,
            commentId,
            userId: userId!,
          });
          appendEvent(db, "attachments_saved", { eventId, attachments });
        }),
      )
      .immediate();
  } catch (error) {
    for (const id of uploadEvents) removeUploadEvent(id);
    throw error;
  }
}
export function createItem(
  db: Database.Database,
  actor: User,
  input: Input,
  uploads: Upload[] = [],
): Task {
  writable(actor);
  return command(db, uploads, (attach) => {
    const parent = input.parentId ? requireTask(db, input.parentId) : null;
    const kind = enumValue(
      input.kind ?? parent?.kind ?? "feature",
      ["feature", "bug"] as const,
      "item type",
    ) as ItemKind;
    if (parent && (kind !== "feature" || parent.kind !== "feature"))
      throw new ProjectError(
        "Only features can have subtasks. Use links to connect bugs.",
      );
    const priority = enumValue(input.priority ?? "P3", PRIORITIES, "priority");
    const effort = effortValue(input.effort);
    const sprintId = sprintValue(input.sprintId, parent?.id ?? null);
    const sectionId =
      kind === "bug"
        ? priority === "P1" || priority === "P2"
          ? "bugs-high"
          : "bugs-low"
        : parent?.sectionId ||
          featureSection(input.sectionId ?? "feature-backlog");
    if (!parent && sectionId === "next-five") checkCapacity(db);
    const title = text(input.title, "Title", 500, true);
    const description = text(input.description ?? "", "Description", 100_000);
    const state = enumValue(input.state ?? "needs_review", STATES, "state");
    const implementorId = assignee(db, input.implementorId),
      reviewerId = assignee(db, input.reviewerId);
    const id = crypto.randomUUID(),
      now = new Date().toISOString();
    const publicId = kind === "bug" ? nextBugId(db) : null;
    const { position } = db
      .prepare(
        "SELECT COALESCE(MAX(position),-1)+1 position FROM tasks WHERE section_id=? AND parent_id IS ?",
      )
      .get(sectionId, parent?.id ?? null) as { position: number };
    db.prepare(
      `INSERT INTO tasks (id,section_id,parent_id,title,state,position,created_at,updated_at,kind,description,public_id,priority,implementor_id,reviewer_id,created_by,completed_at,effort,sprint_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      sectionId,
      parent?.id ?? null,
      title,
      state,
      position,
      now,
      now,
      kind,
      description,
      publicId,
      priority,
      implementorId,
      reviewerId,
      actor.id,
      state === "done" ? now : null,
      effort,
      sprintId,
    );
    const task = ownTask(db, id)!;
    const eventId = appendEvent(db, "item_created", { task, by: actor.id });
    attach(eventId, id, undefined, actor.id);
    queueAssignments(db, eventId, task, actor);
    return task;
  });
}
function queueAssignments(
  db: Database.Database,
  eventId: string,
  task: Task,
  actor: User,
  previous?: Task,
) {
  const ids = [
    task.implementorId !== previous?.implementorId ? task.implementorId : null,
    task.reviewerId !== previous?.reviewerId ? task.reviewerId : null,
  ].filter((id): id is string => !!id);
  for (const id of new Set(ids)) {
    const roles = [
      task.implementorId === id ? "implementor" : "",
      task.reviewerId === id ? "reviewer" : "",
    ]
      .filter(Boolean)
      .join(" and ");
    queueItemNotification(
      db,
      eventId,
      task,
      actor,
      [id],
      `Assigned you as ${roles}`,
    );
  }
}
export function updateItem(
  db: Database.Database,
  actor: User,
  input: Input,
  uploads: Upload[] = [],
): Task {
  writable(actor);
  return command(db, uploads, (attach) => {
    const old = requireTask(db, input.id);
    const task = { ...old };
    if (input.title !== undefined)
      task.title = text(input.title, "Title", 500, true);
    if (input.description !== undefined)
      task.description = text(input.description, "Description", 100_000);
    if (input.state !== undefined) {
      task.state = enumValue(input.state, STATES, "state") as TaskState;
    }
    if (input.priority !== undefined) {
      task.priority = enumValue(
        input.priority,
        PRIORITIES,
        "priority",
      ) as Priority;
      if (task.kind === "bug")
        task.sectionId =
          task.priority === "P1" || task.priority === "P2"
            ? "bugs-high"
            : "bugs-low";
    }
    if (input.effort !== undefined) task.effort = effortValue(input.effort);
    if (input.sprintId !== undefined)
      task.sprintId = sprintValue(input.sprintId, task.parentId);
    if (input.implementorId !== undefined)
      task.implementorId = assignee(db, input.implementorId);
    if (input.reviewerId !== undefined)
      task.reviewerId = assignee(db, input.reviewerId);
    if (input.sectionId !== undefined) {
      if (task.kind !== "feature" || task.parentId)
        throw new ProjectError(
          "Move a top-level feature; its subtasks move with it.",
        );
      task.sectionId = featureSection(input.sectionId);
    }
    if (task.sectionId !== old.sectionId) {
      if (task.sectionId === "next-five") checkCapacity(db);
      const { position } = db
        .prepare(
          "SELECT COALESCE(MAX(position),-1)+1 position FROM tasks WHERE section_id=? AND parent_id IS NULL",
        )
        .get(task.sectionId) as { position: number };
      task.position = position;
      moveTree(db, task.id, task.sectionId);
    }
    task.updatedAt = new Date().toISOString();
    task.completedAt =
      task.state === "done"
        ? old.state === "done"
          ? old.completedAt
          : task.updatedAt
        : null;
    db.prepare(
      "UPDATE tasks SET title=?,description=?,state=?,priority=?,effort=?,implementor_id=?,reviewer_id=?,section_id=?,position=?,updated_at=?,completed_at=?,sprint_id=? WHERE id=?",
    ).run(
      task.title,
      task.description,
      task.state,
      task.priority,
      task.effort,
      task.implementorId,
      task.reviewerId,
      task.sectionId,
      task.position,
      task.updatedAt,
      task.completedAt,
      task.sprintId,
      task.id,
    );
    if (input.position !== undefined) {
      if (
        task.kind !== "feature" ||
        task.parentId ||
        task.sectionId !== "next-five"
      )
        throw new ProjectError("Only Next 5 features can be reordered.");
      const ids = (
        db
          .prepare(
            "SELECT id FROM tasks WHERE section_id='next-five' AND parent_id IS NULL ORDER BY position,created_at,id",
          )
          .all() as { id: string }[]
      ).map((t) => t.id);
      if (
        !Number.isInteger(input.position) ||
        Number(input.position) < 0 ||
        Number(input.position) >= ids.length
      )
        throw new ProjectError("Invalid position.");
      ids.splice(ids.indexOf(task.id), 1);
      ids.splice(Number(input.position), 0, task.id);
      ids.forEach((id, index) =>
        db.prepare("UPDATE tasks SET position=? WHERE id=?").run(index, id),
      );
      appendEvent(db, "feature_order_changed", { ids, by: actor.id });
    }
    normalizePositions(db, old.sectionId);
    if (old.sectionId !== task.sectionId)
      normalizePositions(db, task.sectionId);
    const updated = ownTask(db, task.id)!;
    const eventId = appendEvent(db, "item_updated", {
      task: updated,
      by: actor.id,
    });
    attach(eventId, task.id, undefined, actor.id);
    queueAssignments(db, eventId, updated, actor, old);
    if (updated.state !== old.state) {
      const statusEventId = appendEvent(db, "item_status_changed", {
        task: updated,
        previousState: old.state,
        state: updated.state,
        by: actor.id,
      });
      queueItemNotification(
        db,
        statusEventId,
        updated,
        actor,
        itemAudience(db, updated).filter((id) => id !== actor.id),
        `Changed status from ${STATE_LABELS[old.state]} to ${STATE_LABELS[updated.state]}`,
        `Changed by: ${userName(actor)} (${actor.email})\nPrevious status: ${STATE_LABELS[old.state]}\nNew status: ${STATE_LABELS[updated.state]}`,
      );
    }
    return updated;
  });
}
export function convertItem(
  db: Database.Database,
  actor: User,
  input: Input,
): Task {
  writable(actor);
  return command(db, [], () => {
    const old = requireTask(db, input.id);
    const kind = enumValue(
      input.kind,
      ["feature", "bug"] as const,
      "item type",
    );
    if (kind === old.kind) return old;
    const detail = itemDetail(db, old.id)!.task;
    const now = new Date().toISOString();
    const sectionId =
      kind === "feature"
        ? "feature-backlog"
        : old.priority === "P1" || old.priority === "P2"
          ? "bugs-high"
          : "bugs-low";
    const position = (list: string) =>
      (
        db
          .prepare(
            "SELECT COALESCE(MAX(position),-1)+1 position FROM tasks WHERE section_id=? AND parent_id IS NULL",
          )
          .get(list) as { position: number }
      ).position;
    const descendants = db
      .prepare(
        "WITH RECURSIVE tree(id) AS (SELECT id FROM tasks WHERE parent_id=? UNION ALL SELECT t.id FROM tasks t JOIN tree ON t.parent_id=tree.id) SELECT id FROM tree",
      )
      .all(old.id) as { id: string }[];
    // Bugs stand alone. Preserve each child feature tree in the backlog and
    // replace the hierarchy edges with Related to links.
    for (const child of detail.children) {
      db.prepare(
        "UPDATE tasks SET parent_id=NULL,position=?,updated_at=? WHERE id=?",
      ).run(position("feature-backlog"), now, child.id);
      moveTree(db, child.id, "feature-backlog");
    }
    db.prepare(
      "UPDATE tasks SET kind=?,section_id=?,parent_id=NULL,public_id=?,state=?,completed_at=?,position=?,updated_at=? WHERE id=?",
    ).run(
      kind,
      sectionId,
      old.publicId || (kind === "bug" ? nextBugId(db) : null),
      detail.state,
      detail.completedAt,
      position(sectionId),
      now,
      old.id,
    );
    normalizePositions(db, old.sectionId);
    normalizePositions(db, sectionId);
    const converted = ownTask(db, old.id)!;
    appendEvent(db, "item_converted", {
      task: converted,
      previousKind: old.kind,
      previousParentId: old.parentId,
      movedFeatures: descendants.map(({ id }) => ownTask(db, id)),
      by: actor.id,
    });
    for (const targetId of [
      old.parentId,
      ...detail.children.map((child) => child.id),
    ]) {
      if (!targetId) continue;
      const linked = db
        .prepare(
          "SELECT 1 FROM item_links WHERE relation='related_to' AND ((source_id=? AND target_id=?) OR (source_id=? AND target_id=?))",
        )
        .get(old.id, targetId, targetId, old.id);
      if (!linked)
        linkItem(db, actor, { id: old.id, targetId, relation: "related_to" });
    }
    return converted;
  });
}

export function addComment(
  db: Database.Database,
  actor: User,
  input: Input,
  uploads: Upload[] = [],
) {
  writable(actor);
  return command(db, uploads, (attach) => {
    const task = requireTask(db, input.id);
    const body = text(input.body ?? "", "Comment", 20_000);
    if (!body.trim() && !uploads.length)
      throw new ProjectError("Write a comment or attach a file.");
    const comment = {
      id: crypto.randomUUID(),
      taskId: task.id,
      userId: actor.id,
      body,
      createdAt: new Date().toISOString(),
    };
    db.prepare("INSERT INTO comments VALUES (?,?,?,?,?)").run(
      comment.id,
      task.id,
      actor.id,
      body,
      comment.createdAt,
    );
    const eventId = appendEvent(db, "item_commented", {
      comment,
      by: actor.id,
    });
    attach(eventId, task.id, comment.id, actor.id);
    db.prepare("UPDATE tasks SET updated_at=? WHERE id=?").run(
      comment.createdAt,
      task.id,
    );
    queueItemNotification(
      db,
      eventId,
      task,
      actor,
      itemAudience(db, task).filter((id) => id !== actor.id),
      "Commented",
      body || `${uploads.length} attachment(s)`,
    );
    return comment;
  });
}
export function followItem(db: Database.Database, actor: User, input: Input) {
  personal(actor);
  return db
    .transaction(() => {
      const task = requireTask(db, input.id);
      if (typeof input.follow !== "boolean")
        throw new ProjectError("Specify whether to follow or unfollow.");
      const result = input.follow
        ? db
            .prepare("INSERT OR IGNORE INTO followers VALUES (?,?)")
            .run(task.id, actor.id)
        : db
            .prepare("DELETE FROM followers WHERE task_id=? AND user_id=?")
            .run(task.id, actor.id);
      if (!result.changes) return;
      const eventId = appendEvent(
        db,
        input.follow ? "item_followed" : "item_unfollowed",
        { taskId: task.id, userId: actor.id },
      );
      if (input.follow)
        queueItemNotification(
          db,
          eventId,
          task,
          actor,
          itemAudience(db, task),
          "Followed this item",
          "Followers receive email when someone comments on or follows this item.",
        );
    })
    .immediate();
}
export function linkItem(db: Database.Database, actor: User, input: Input) {
  writable(actor);
  return db
    .transaction(() => {
      const source = requireTask(db, input.id),
        target = requireTask(db, input.targetId);
      const relation = enumValue(
        input.relation,
        ["related_to", "caused_by"] as const,
        "relationship",
      );
      if (source.id === target.id)
        throw new ProjectError("An item cannot link to itself.");
      if (
        source.kind !== "bug" &&
        (target.kind !== "bug" || relation === "caused_by")
      )
        throw new ProjectError(
          "Link a bug to a feature or another bug. For ‘caused by’, start from the bug.",
        );
      const duplicate = db
        .prepare(
          "SELECT 1 FROM item_links WHERE relation=? AND ((source_id=? AND target_id=?) OR (?='related_to' AND source_id=? AND target_id=?))",
        )
        .get(relation, source.id, target.id, relation, target.id, source.id);
      if (duplicate)
        throw new ProjectError("These items already have that link.", 409);
      const link = {
        id: crypto.randomUUID(),
        sourceId: source.id,
        targetId: target.id,
        relation,
      };
      db.prepare("INSERT INTO item_links VALUES (?,?,?,?)").run(
        link.id,
        source.id,
        target.id,
        relation,
      );
      appendEvent(db, "items_linked", { link, by: actor.id });
      return link;
    })
    .immediate();
}
export function unlinkItem(db: Database.Database, actor: User, input: Input) {
  writable(actor);
  return db
    .transaction(() => {
      const task = requireTask(db, input.id);
      if (typeof input.linkId !== "string")
        throw new ProjectError("Link is required.");
      const link = db
        .prepare(
          "SELECT * FROM item_links WHERE id=? AND (source_id=? OR target_id=?)",
        )
        .get(input.linkId, task.id, task.id);
      if (!link) throw new ProjectError("Link not found.", 404);
      db.prepare("DELETE FROM item_links WHERE id=?").run(input.linkId);
      appendEvent(db, "items_unlinked", { link, by: actor.id });
    })
    .immediate();
}
export function deleteItem(db: Database.Database, actor: User, id: string) {
  writable(actor);
  return db
    .transaction(() => {
      const task = requireTask(db, id);
      const ids = db
        .prepare(
          "WITH RECURSIVE tree(id) AS (SELECT id FROM tasks WHERE id=? UNION ALL SELECT t.id FROM tasks t JOIN tree ON t.parent_id=tree.id) SELECT id FROM tree",
        )
        .all(task.id) as { id: string }[];
      for (const row of ids) {
        db.prepare(
          "DELETE FROM item_links WHERE source_id=? OR target_id=?",
        ).run(row.id, row.id);
        db.prepare("DELETE FROM followers WHERE task_id=?").run(row.id);
        db.prepare("DELETE FROM comments WHERE task_id=?").run(row.id);
        db.prepare("DELETE FROM tasks WHERE id=?").run(row.id);
      }
      // Retain event-owned files for the audit trail; the asset endpoint refuses
      // access to files whose task has been deleted.
      appendEvent(db, "item_deleted", {
        taskId: task.id,
        descendants: ids.map((r) => r.id),
        by: actor.id,
      });
      normalizePositions(db, task.sectionId);
    })
    .immediate();
}
export function updateProfile(
  db: Database.Database,
  actor: User,
  input: Input,
  uploads: Upload[] = [],
) {
  personal(actor);
  validateUploads(uploads, true);
  if (uploads.length > 1) throw new ProjectError("Choose one profile picture.");
  return command(db, uploads, (attach) => {
    const name = text(input.name ?? actor.name ?? "", "Name", 120);
    const eventId = appendEvent(db, "profile_updated", {
      userId: actor.id,
      name,
      removeAvatar: input.removeAvatar === true,
    });
    attach(eventId, undefined, undefined, actor.id);
    const avatar = db
      .prepare("SELECT id FROM attachments WHERE event_id=?")
      .get(eventId) as { id: string } | undefined;
    const avatarId =
      avatar?.id ||
      (input.removeAvatar === true ? null : actor.avatarId || null);
    db.prepare("UPDATE users SET name=?,avatar_id=? WHERE id=?").run(
      name.trim(),
      avatarId,
      actor.id,
    );
    return { ...actor, name: name.trim(), avatarId };
  });
}
