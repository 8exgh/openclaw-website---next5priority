"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  EFFORTS,
  effortLabel,
  initials,
  STATES,
  STATE_LABELS,
  userName,
  type Attachment,
  type Effort,
  type Task,
  type TaskState,
  type User,
} from "../../lib/project-types";

export async function api(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error || "Request failed. Please try again.");
  return body;
}
export function command(
  url: string,
  method: string,
  data: object,
  files: File[] = [],
) {
  if (!files.length) return api(url, { method, body: JSON.stringify(data) });
  const form = new FormData();
  form.set("data", JSON.stringify(data));
  files.forEach((file) => form.append("files", file));
  return api(url, { method, body: form });
}
export const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
export const dateLabel = (date: string) =>
  new Date(date).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
export function StateControl({
  task,
  canEdit,
  disabled = false,
  onChange,
}: {
  task: Task;
  canEdit: boolean;
  disabled?: boolean;
  onChange: (state: TaskState) => void;
}) {
  return canEdit ? (
    <select
      className={`status state-control status-${task.state}`}
      aria-label={`State for ${task.title}`}
      value={task.state}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as TaskState)}
    >
      {STATES.map((state) => (
        <option key={state} value={state}>
          {STATE_LABELS[state]}
        </option>
      ))}
    </select>
  ) : (
    <span className={`status status-${task.state}`}>
      {STATE_LABELS[task.state]}
    </span>
  );
}
export function Avatar({
  user,
  large = false,
}: {
  user?: User;
  large?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [user?.avatarId]);
  return (
    <span
      className={`avatar${large ? " avatar-large" : ""}`}
      title={user ? userName(user) : "Automation"}
    >
      {user?.avatarId && !failed ? (
        <img
          src={`/api/assets/${user.avatarId}`}
          alt={userName(user)}
          onError={() => setFailed(true)}
        />
      ) : user ? (
        initials(user)
      ) : (
        "AU"
      )}
    </span>
  );
}
export function Modal({
  title,
  eyebrow,
  close,
  children,
  wide = false,
}: {
  title: string;
  eyebrow?: string;
  close: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal${wide ? " detail-modal" : ""}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="modal-head">
        <div>
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h2 id={titleId}>{title}</h2>
        </div>
        <button
          className="icon-button close-button"
          onClick={close}
          aria-label="Close dialog"
        >
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function ErrorNotice({ error }: { error: string }) {
  return error ? (
    <p className="error error-notice" role="alert">
      {error}
    </p>
  ) : null;
}
export function FilePicker({
  files,
  setFiles,
  avatar = false,
  disabled = false,
}: {
  files: File[];
  setFiles: (files: File[]) => void;
  avatar?: boolean;
  disabled?: boolean;
}) {
  const [error, setError] = useState("");
  return (
    <div className="file-picker">
      <label className="file-label">
        {avatar ? "Upload profile picture" : "Attach files"}
        <input
          type="file"
          aria-label={avatar ? "Upload profile picture" : "Attach files"}
          multiple={!avatar}
          accept={
            avatar ? "image/png,image/jpeg,image/gif,image/webp" : undefined
          }
          disabled={disabled}
          onChange={(event) => {
            const selected = Array.from(event.target.files || []);
            const next = avatar ? selected : [...files, ...selected];
            event.target.value = "";
            if (
              next.length > (avatar ? 1 : 10) ||
              next.reduce((sum, file) => sum + file.size, 0) >
                (avatar ? 5 : 25) * 1024 * 1024
            ) {
              setError(
                avatar
                  ? "Choose one picture under 5 MB."
                  : "Choose up to 10 files, totaling at most 25 MB.",
              );
              return;
            }
            setError("");
            setFiles(next);
          }}
        />
      </label>
      <span className="subtle small">
        {avatar
          ? "PNG, JPEG, GIF or WebP · up to 5 MB"
          : "Any file type · up to 25 MB total"}
      </span>
      {!!files.length && (
        <ul className="staged-files">
          {files.map((file, i) => (
            <li key={`${file.name}-${i}`}>
              <span>
                {file.name}{" "}
                <small>({Math.max(1, Math.round(file.size / 1024))} KB)</small>
              </span>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove ${file.name}`}
                disabled={disabled}
                onClick={() =>
                  setFiles(files.filter((_, index) => i !== index))
                }
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <ErrorNotice error={error} />
    </div>
  );
}
export function Attachments({ attachments }: { attachments: Attachment[] }) {
  return (
    <div className="attachments">
      {attachments.map((file) => (
        <figure className="attachment" key={file.id}>
          {file.mime.startsWith("image/") && (
            <a href={`/api/assets/${file.id}`} target="_blank" rel="noreferrer">
              <img
                src={`/api/assets/${file.id}`}
                alt={file.name}
                loading="lazy"
              />
            </a>
          )}
          <figcaption>
            <a href={`/api/assets/${file.id}?download=1`} download={file.name}>
              ↓ {file.name}
            </a>
            <span>{Math.max(1, Math.round(file.size / 1024))} KB</span>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
export function PersonSelect({
  label,
  value,
  onChange,
  users,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  users: User[];
}) {
  return (
    <label className="field">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Unassigned</option>
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {userName(user)}
          </option>
        ))}
      </select>
    </label>
  );
}
export function EffortBadge({
  effort,
  detailed = false,
}: {
  effort: Effort | null;
  detailed?: boolean;
}) {
  if (!effort) return null;
  return (
    <span
      className={`effort${detailed ? " effort-detailed" : ""}`}
      role="img"
      aria-label={`Effort ${effort} of 5`}
      title={`Effort ${effortLabel(effort)}`}
    >
      <span className="effort-dots" aria-hidden="true">
        {EFFORTS.map((step) => (
          <i key={step} className={step <= effort ? "filled" : ""} />
        ))}
      </span>
      <span aria-hidden="true">
        {detailed ? `Effort ${effortLabel(effort)}` : effort}
      </span>
    </span>
  );
}
export function EffortSelect({
  value,
  onChange,
}: {
  value: Effort | null;
  onChange: (effort: Effort | null) => void;
}) {
  return (
    <label className="field">
      Effort
      <select
        value={value ?? ""}
        onChange={(event) =>
          onChange(
            event.target.value ? (Number(event.target.value) as Effort) : null,
          )
        }
      >
        <option value="">Not set</option>
        {EFFORTS.map((step) => (
          <option key={step} value={step}>
            {effortLabel(step)}
          </option>
        ))}
      </select>
    </label>
  );
}
/** Searchable single-item chooser: type to filter, pick with mouse or keys. */
export function ItemPicker({
  label,
  items,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  items: Task[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputId = useId(),
    listId = useId();
  const selected = items.find((item) => item.id === value);
  const needle = query.trim().toLowerCase();
  const matches = items
    .filter(
      (item) =>
        !needle ||
        `${item.publicId || ""} ${item.title}`.toLowerCase().includes(needle),
    )
    .slice(0, 8);
  const caption = (item: Task) =>
    `${item.publicId || "Feature"} · ${item.title}`;
  const choose = (item: Task) => {
    onChange(item.id);
    setQuery("");
    setOpen(false);
  };
  const clear = () => {
    onChange("");
    setQuery("");
    setActive(0);
    setOpen(true);
  };
  const listOpen = open && !selected;
  return (
    <div className="field item-picker">
      <label htmlFor={inputId}>{label}</label>
      <div className="item-picker-input">
        <input
          id={inputId}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-expanded={listOpen}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            listOpen && matches[active]
              ? `${listId}-${matches[active].id}`
              : undefined
          }
          placeholder="Type a title or SAV ID…"
          disabled={disabled}
          readOnly={!!selected}
          value={selected ? caption(selected) : query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(event) => {
            if (selected) {
              if (event.key === "Backspace" || event.key === "Delete") {
                event.preventDefault();
                clear();
              }
              return;
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              setActive((index) => Math.min(index + 1, matches.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) => Math.max(index - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              if (listOpen && matches[active]) choose(matches[active]);
            } else if (event.key === "Escape" && listOpen) {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
            }
          }}
        />
        {selected && (
          <button
            type="button"
            className="icon-button"
            aria-label="Clear selected item"
            disabled={disabled}
            onClick={clear}
          >
            ×
          </button>
        )}
      </div>
      {listOpen && (
        <ul id={listId} role="listbox" aria-label={`${label} suggestions`}>
          {matches.map((item, index) => (
            <li
              key={item.id}
              id={`${listId}-${item.id}`}
              role="option"
              aria-selected={index === active}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(item)}
            >
              {item.publicId && <strong>{item.publicId}</strong>}
              {item.title}
            </li>
          ))}
          {!matches.length && (
            <li className="no-matches" role="presentation">
              No matching items
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
