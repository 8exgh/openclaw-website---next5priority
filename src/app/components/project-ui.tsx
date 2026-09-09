"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  initials,
  userName,
  type Attachment,
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
