"use client";
import { useEffect, useState } from "react";
import {
  PRIORITIES,
  STATES,
  STATE_LABELS,
  userName,
  type ItemDetail,
  type Task,
  type User,
} from "../../lib/project-types";
import {
  api,
  Attachments,
  Avatar,
  command,
  dateLabel,
  ErrorNotice,
  errorMessage,
  FilePicker,
  Modal,
  PersonSelect,
  StateControl,
} from "./project-ui";

export function ItemView({
  id,
  me,
  users,
  items,
  close,
  changed,
  open,
  addChild,
}: {
  id: string;
  me: User;
  users: User[];
  items: Task[];
  close: () => void;
  changed: () => Promise<void>;
  open: (id: string) => void;
  addChild: (task: Task) => void;
}) {
  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<Task>>({});
  const [files, setFiles] = useState<File[]>([]),
    [commentFiles, setCommentFiles] = useState<File[]>([]);
  const [comment, setComment] = useState(""),
    [target, setTarget] = useState(""),
    [relation, setRelation] = useState("related_to");
  const canEdit = me.role !== "read";
  useEffect(() => {
    let active = true;
    api(`/api/project?id=${encodeURIComponent(id)}`)
      .then((result) => {
        if (active) setDetail(result.detail);
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [id]);
  async function act(data: object, method = "POST", uploads: File[] = []) {
    setBusy(true);
    setError("");
    try {
      const result = await command(
        "/api/project",
        method,
        { id, ...data },
        uploads,
      );
      setDetail(
        data && "id" in data && data.id !== id
          ? (await api(`/api/project?id=${encodeURIComponent(id)}`)).detail
          : result.detail,
      );
      await changed();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  function beginEdit() {
    if (!detail) return;
    const task = detail.task;
    setDraft({
      title: task.title,
      description: task.description,
      state: task.state,
      priority: task.priority,
      implementorId: task.implementorId,
      reviewerId: task.reviewerId,
    });
    setFiles([]);
    setEditing(true);
    setError("");
  }
  const task = detail?.task;
  const following = !!detail?.followers.some((u) => u.id === me.id);
  const person = (userId: string | null) => users.find((u) => u.id === userId);
  const candidates = items.filter(
    (t) => t.id !== task?.id && (task?.kind === "bug" || t.kind === "bug"),
  );
  return (
    <Modal
      title={task?.title || "Item details"}
      eyebrow={
        task
          ? `${task.publicId || "FEATURE"} · ${task.kind === "bug" ? "BUG TRACKER" : task.sectionId === "next-five" ? "NEXT 5" : "BACKLOG"}`
          : "LOADING"
      }
      close={close}
      wide
    >
      <ErrorNotice error={error} />
      {!detail || !task ? (
        <p className="subtle">
          {error
            ? "Close this window and try opening the item again."
            : "Loading item…"}
        </p>
      ) : (
        <>
          <div className="detail-toolbar">
            <StateControl
              task={task}
              canEdit={canEdit}
              disabled={busy || editing}
              onChange={(state) => act({ state }, "PATCH")}
            />
            {task.priority && (
              <span className={`priority priority-${task.priority}`}>
                {task.priority}
              </span>
            )}
            <span className="subtle small">
              Logged {dateLabel(task.createdAt)}
            </span>
            <div className="toolbar-actions">
              <button
                disabled={busy}
                aria-pressed={following}
                onClick={() => act({ action: "follow", follow: !following })}
              >
                {following ? "✓ Following" : "+ Follow"}
              </button>
              {canEdit && !editing && (
                <button onClick={beginEdit}>Edit item</button>
              )}
            </div>
          </div>
          <div className="detail-layout">
            <div className="detail-main">
              {editing ? (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (await act(draft, "PATCH", files)) {
                      setEditing(false);
                      setFiles([]);
                    }
                  }}
                >
                  <fieldset disabled={busy} className="form-fields">
                    <label className="field">
                      Title
                      <input
                        required
                        maxLength={500}
                        value={draft.title}
                        onChange={(e) =>
                          setDraft({ ...draft, title: e.target.value })
                        }
                      />
                    </label>
                    <label className="field">
                      Description
                      <textarea
                        rows={8}
                        maxLength={100000}
                        value={draft.description}
                        onChange={(e) =>
                          setDraft({ ...draft, description: e.target.value })
                        }
                      />
                    </label>
                    <Attachments attachments={detail.attachments} />
                    <FilePicker
                      files={files}
                      setFiles={setFiles}
                      disabled={busy}
                    />
                    <div className="field-grid">
                      <label className="field">
                        State
                        <select
                          value={draft.state}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              state: e.target.value as Task["state"],
                            })
                          }
                        >
                          {STATES.map((s) => (
                            <option key={s} value={s}>
                              {STATE_LABELS[s]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        Priority
                        <select
                          value={draft.priority || "P3"}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              priority: e.target.value as Task["priority"],
                            })
                          }
                        >
                          {PRIORITIES.map((p) => (
                            <option key={p}>{p}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="field-grid">
                      <PersonSelect
                        label="Implementor"
                        users={users}
                        value={draft.implementorId || ""}
                        onChange={(value) =>
                          setDraft({ ...draft, implementorId: value || null })
                        }
                      />
                      <PersonSelect
                        label="Reviewer"
                        users={users}
                        value={draft.reviewerId || ""}
                        onChange={(value) =>
                          setDraft({ ...draft, reviewerId: value || null })
                        }
                      />
                    </div>
                    <div className="form-actions">
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(false);
                          setFiles([]);
                        }}
                      >
                        Cancel edit
                      </button>
                      <button type="submit" className="primary">
                        {busy ? "Saving…" : "Save changes"}
                      </button>
                    </div>
                  </fieldset>
                </form>
              ) : (
                <section className="detail-section">
                  <div className="detail-section-heading">
                    <h3>Description</h3>
                    {canEdit && (
                      <button className="quiet-button" onClick={beginEdit}>
                        Edit / attach files
                      </button>
                    )}
                  </div>
                  <p
                    className={`description${!task.description ? " subtle" : ""}`}
                  >
                    {task.description || "No description yet."}
                  </p>
                  <Attachments attachments={detail.attachments} />
                </section>
              )}
              {!!task.children.length && (
                <section className="detail-section">
                  <h3>Subtasks</h3>
                  {task.children.map((child) => (
                    <div className="subtask-detail-row" key={child.id}>
                      <button
                        className="linked-item"
                        onClick={() => open(child.id)}
                      >
                        {child.title}
                      </button>
                      <StateControl
                        task={child}
                        canEdit={canEdit}
                        disabled={busy || editing}
                        onChange={(state) =>
                          act({ id: child.id, state }, "PATCH")
                        }
                      />
                    </div>
                  ))}
                </section>
              )}
              <section className="detail-section">
                <h3>
                  Comments{" "}
                  <span className="count">{detail.comments.length}</span>
                </h3>
                {!detail.comments.length && (
                  <p className="subtle small">
                    Start the conversation. Share an update, a screenshot, or a
                    file.
                  </p>
                )}
                <div className="comments">
                  {detail.comments.map((entry) => (
                    <article className="comment" key={entry.id}>
                      <Avatar user={person(entry.userId)} />
                      <div className="comment-content">
                        <div className="comment-meta">
                          <strong>
                            {person(entry.userId)
                              ? userName(person(entry.userId)!)
                              : "Automation"}
                          </strong>
                          <time dateTime={entry.createdAt}>
                            {dateLabel(entry.createdAt)}
                          </time>
                        </div>
                        {entry.body && (
                          <p className="description">{entry.body}</p>
                        )}
                        <Attachments attachments={entry.attachments} />
                      </div>
                    </article>
                  ))}
                </div>
                {canEdit && (
                  <form
                    className="comment-form"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (
                        await act(
                          { action: "comment", body: comment },
                          "POST",
                          commentFiles,
                        )
                      ) {
                        setComment("");
                        setCommentFiles([]);
                      }
                    }}
                  >
                    <fieldset className="form-fields" disabled={busy}>
                      <label className="field">
                        Add a comment
                        <textarea
                          rows={3}
                          maxLength={20000}
                          value={comment}
                          onChange={(e) => setComment(e.target.value)}
                          placeholder="Write an update…"
                        />
                      </label>
                      <FilePicker
                        files={commentFiles}
                        setFiles={setCommentFiles}
                        disabled={busy}
                      />
                      <div className="form-actions">
                        <button
                          className="primary"
                          disabled={!comment.trim() && !commentFiles.length}
                        >
                          {busy ? "Saving…" : "Post comment"}
                        </button>
                      </div>
                    </fieldset>
                  </form>
                )}
              </section>
            </div>
            <aside className="detail-sidebar">
              <section>
                <h3>People</h3>
                {(
                  [
                    ["Implementor", task.implementorId],
                    ["Reviewer", task.reviewerId],
                  ] as const
                ).map(([label, userId]) => (
                  <div className="person-line" key={label}>
                    <span className="subtle small">{label}</span>
                    <div>
                      {userId && <Avatar user={person(userId)} />}
                      <span>
                        {person(userId)
                          ? userName(person(userId)!)
                          : "Unassigned"}
                      </span>
                    </div>
                  </div>
                ))}
              </section>
              <section>
                <h3>
                  Followers{" "}
                  <span className="count">{detail.followers.length}</span>
                </h3>
                <div className="follower-list">
                  {detail.followers.map((user) => (
                    <div key={user.id}>
                      <Avatar user={user} />
                      <span>{userName(user)}</span>
                    </div>
                  ))}
                </div>
                <p className="subtle small">
                  Follow to receive email about status changes, comments, and
                  new followers.
                </p>
              </section>
              <section>
                <h3>Linked items</h3>
                {detail.links.map((link) => (
                  <div className="link-card" key={link.id}>
                    <span className="subtle small">
                      {link.relation === "related_to"
                        ? "Related to"
                        : link.incoming
                          ? "Causes"
                          : "Caused by"}
                    </span>
                    <button
                      className="link-title"
                      onClick={() => open(link.other.id)}
                    >
                      {link.other.publicId && (
                        <strong>{link.other.publicId} </strong>
                      )}
                      {link.other.title}
                    </button>
                    {canEdit && (
                      <button
                        className="quiet-button"
                        disabled={busy}
                        onClick={() =>
                          act({ action: "unlink", linkId: link.id })
                        }
                      >
                        Remove link
                      </button>
                    )}
                  </div>
                ))}
                {canEdit && (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (
                        await act({
                          action: "link",
                          targetId: target,
                          relation,
                        })
                      )
                        setTarget("");
                    }}
                  >
                    <fieldset disabled={busy} className="form-fields">
                      <label className="field">
                        Relationship
                        <select
                          value={relation}
                          onChange={(e) => setRelation(e.target.value)}
                        >
                          <option value="related_to">Related to</option>
                          {task.kind === "bug" && (
                            <option value="caused_by">Caused by</option>
                          )}
                        </select>
                      </label>
                      <label className="field">
                        Link to item
                        <select
                          required
                          value={target}
                          onChange={(e) => setTarget(e.target.value)}
                        >
                          <option value="">Choose a bug or feature</option>
                          {candidates.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.publicId || "Feature"} · {t.title}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button type="submit" disabled={!target}>
                        Add link
                      </button>
                    </fieldset>
                  </form>
                )}
                {!canEdit && !detail.links.length && (
                  <p className="subtle small">No linked items.</p>
                )}
              </section>
              {canEdit && (
                <section className="item-actions">
                  <h3>Item actions</h3>
                  <button
                    disabled={busy || editing}
                    onClick={() =>
                      act({
                        action: "convert",
                        kind: task.kind === "feature" ? "bug" : "feature",
                      })
                    }
                  >
                    Convert to {task.kind === "feature" ? "bug" : "feature"}
                  </button>
                  <p className="subtle small">
                    {task.kind === "bug"
                      ? "The feature goes into the backlog and keeps its SAV ID and history."
                      : task.children.length
                        ? "Subtasks stay as features in the backlog, linked to the new bug."
                        : task.parentId
                          ? "The bug becomes a separate item, linked to its current parent."
                          : "The bug goes into the list matching its priority and keeps its history."}
                  </p>
                  {task.kind === "feature" && (
                    <>
                      <button disabled={busy} onClick={() => addChild(task)}>
                        Add subtask
                      </button>
                      {!task.parentId && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            act(
                              {
                                sectionId:
                                  task.sectionId === "next-five"
                                    ? "feature-backlog"
                                    : "next-five",
                              },
                              "PATCH",
                            )
                          }
                        >
                          {task.sectionId === "next-five"
                            ? "Move to backlog"
                            : "Move to Next 5"}
                        </button>
                      )}
                    </>
                  )}
                  <button
                    className="danger-button"
                    disabled={busy}
                    onClick={async () => {
                      if (
                        !window.confirm(
                          `Delete “${task.title}”${task.children.length ? " and all its subtasks" : ""}?`,
                        )
                      )
                        return;
                      setBusy(true);
                      try {
                        await api(`/api/project?id=${task.id}`, {
                          method: "DELETE",
                        });
                        await changed();
                        close();
                      } catch (e) {
                        setError(errorMessage(e));
                        setBusy(false);
                      }
                    }}
                  >
                    Delete {task.kind}
                  </button>
                </section>
              )}
            </aside>
          </div>
        </>
      )}
    </Modal>
  );
}
