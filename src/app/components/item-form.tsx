"use client";
import { useState } from "react";
import { SprintPicker } from "./sprint-picker";
import {
  PRIORITIES,
  STATES,
  STATE_LABELS,
  type Effort,
  type ItemKind,
  type Priority,
  type Task,
  type TaskState,
  type User,
} from "../../lib/project-types";
import {
  command,
  EffortSelect,
  ErrorNotice,
  errorMessage,
  FilePicker,
  Modal,
  pasteImages,
  PersonSelect,
} from "./project-ui";
export function NewItem({
  kind,
  sectionId,
  parent,
  initialPriority = "P3",
  initialSprint = null,
  sprintOptions,
  users,
  close,
  created,
}: {
  kind: ItemKind;
  sectionId?: string;
  parent?: Task;
  initialPriority?: Priority;
  initialSprint?: string | null;
  sprintOptions: string[];
  users: User[];
  close: () => void;
  created: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [state, setState] = useState<TaskState>("needs_review");
  const [priority, setPriority] = useState<Priority>(initialPriority);
  const [effort, setEffort] = useState<Effort | null>(null);
  const [sprintId, setSprintId] = useState<string | null>(initialSprint);
  const [implementorId, setImplementor] = useState("");
  const [reviewerId, setReviewer] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await command(
        "/api/project",
        "POST",
        {
          kind,
          title,
          description,
          state,
          priority,
          effort,
          sprintId: parent ? null : sprintId,
          sectionId,
          parentId: parent?.id,
          implementorId,
          reviewerId,
        },
        files,
      );
      created(result.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        kind === "bug"
          ? "Report a bug"
          : parent
            ? "Add a subtask"
            : "New feature"
      }
      eyebrow={
        parent
          ? `UNDER ${parent.title}`
          : kind === "bug"
            ? "BUG TRACKER"
            : "FEATURE PLANNING"
      }
      close={close}
    >
      <form onSubmit={save}>
        <fieldset disabled={busy} className="form-fields">
          <label className="field">
            Title
            <input
              autoFocus
              required
              maxLength={500}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                kind === "bug"
                  ? "What is going wrong?"
                  : "What would you like to build?"
              }
            />
          </label>
          <label className="field">
            Description
            <textarea
              rows={6}
              maxLength={100000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onPaste={(e) =>
                pasteImages(e, {
                  files,
                  setFiles,
                  setValue: setDescription,
                  setError,
                })
              }
              placeholder={
                kind === "bug"
                  ? "Steps to reproduce, expected behavior, and what happened…"
                  : "Describe the feature and what success looks like…"
              }
            />
          </label>
          <FilePicker files={files} setFiles={setFiles} disabled={busy} />
          <div className="field-grid field-grid-three">
            <label className="field">
              State
              <select
                value={state}
                onChange={(e) => setState(e.target.value as TaskState)}
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
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
              >
                {PRIORITIES.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            <EffortSelect value={effort} onChange={setEffort} />
          </div>
          <div className="field-grid">
            <PersonSelect
              label="Implementor"
              value={implementorId}
              onChange={setImplementor}
              users={users}
            />
            <PersonSelect
              label="Reviewer"
              value={reviewerId}
              onChange={setReviewer}
              users={users}
            />
          </div>
          {!parent && (
            <SprintPicker
              value={sprintId}
              options={sprintOptions}
              onChange={setSprintId}
              disabled={busy}
            />
          )}
          <ErrorNotice error={error} />
          <div className="form-actions">
            <button type="button" onClick={close}>
              Cancel
            </button>
            <button className="primary" type="submit">
              {busy
                ? "Saving…"
                : kind === "bug"
                  ? "Create bug"
                  : "Create feature"}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
