"use client";
import { useState } from "react";
import { type Role, type User, userName } from "../../lib/project-types";
import {
  api,
  Avatar,
  command,
  ErrorNotice,
  errorMessage,
  FilePicker,
  Modal,
} from "./project-ui";
export function Login({ onDone }: { onDone: () => Promise<void> }) {
  const [email, setEmail] = useState(""),
    [code, setCode] = useState(""),
    [sent, setSent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (!sent) {
        await command("/api/auth/request-code", "POST", { email });
        setSent(true);
      } else {
        await command("/api/auth/verify", "POST", { email, code });
        await onDone();
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-shell">
      <div className="login-card">
        <div className="brand-mark">N5</div>
        <p className="eyebrow">NEXT 5 PRIORITY</p>
        <h1>Keep the work moving.</h1>
        <p className="subtle">
          A shared home for your next five features, your backlog, and every bug
          along the way.
        </p>
        <form onSubmit={submit}>
          <label htmlFor="login-input">
            {sent ? "Six-digit code" : "Work email"}
          </label>
          <input
            id="login-input"
            autoFocus
            type={sent ? "text" : "email"}
            inputMode={sent ? "numeric" : "email"}
            autoComplete={sent ? "one-time-code" : "email"}
            required
            value={sent ? code : email}
            onChange={(e) =>
              sent ? setCode(e.target.value) : setEmail(e.target.value)
            }
            placeholder={sent ? "000000" : "you@company.com"}
          />
          <ErrorNotice error={error} />
          <button className="primary" disabled={busy}>
            {busy ? "Working…" : sent ? "Sign in" : "Email me a code"}
          </button>
          {sent && (
            <button
              className="text-button"
              type="button"
              disabled={busy}
              onClick={() => {
                setSent(false);
                setCode("");
              }}
            >
              Use another email
            </button>
          )}
        </form>
      </div>
    </main>
  );
}
export function Profile({
  me,
  close,
  saved,
}: {
  me: User;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const [name, setName] = useState(me.name || ""),
    [files, setFiles] = useState<File[]>([]),
    [removeAvatar, setRemoveAvatar] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal title="Your profile" eyebrow="ACCOUNT" close={close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await command(
              "/api/profile",
              "PATCH",
              { name, removeAvatar },
              files,
            );
            await saved();
            close();
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy} className="form-fields">
          <div className="profile-preview">
            <Avatar
              user={{
                ...me,
                name,
                avatarId: removeAvatar ? null : me.avatarId,
              }}
              large
            />
            <div>
              <strong>{me.email}</strong>
              <p className="subtle small">
                Your photo replaces your two initials across the project.
              </p>
            </div>
          </div>
          <label className="field">
            Display name
            <input
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="First and last name"
            />
          </label>
          <FilePicker
            files={files}
            setFiles={(value) => {
              setFiles(value);
              setRemoveAvatar(false);
            }}
            avatar
            disabled={busy}
          />
          {me.avatarId && (
            <button
              type="button"
              onClick={() => {
                setRemoveAvatar(true);
                setFiles([]);
              }}
            >
              Use initials instead
            </button>
          )}
          <ErrorNotice error={error} />
          <div className="form-actions">
            <button type="button" onClick={close}>
              Cancel
            </button>
            <button className="primary">
              {busy ? "Saving…" : "Save profile"}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
export function Admin({
  users,
  close,
  changed,
}: {
  users: User[];
  close: () => void;
  changed: () => Promise<void>;
}) {
  const [email, setEmail] = useState(""),
    [role, setRole] = useState<Role>("edit"),
    [name, setName] = useState("Automation bot"),
    [key, setKey] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  return (
    <Modal title="Team & integrations" eyebrow="ADMINISTRATION" close={close}>
      <ErrorNotice error={error} />
      <div className="team-list">
        {users.map((user) => (
          <div key={user.id}>
            <Avatar user={user} />
            <span>{userName(user)}</span>
            <span className="subtle small">{user.role}</span>
          </div>
        ))}
      </div>
      <h3>Add a teammate or update access</h3>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await command("/api/admin/users", "POST", { email, role });
            setMessage(`Access saved for ${email}. An email has been queued.`);
            setEmail("");
            await changed();
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy} className="form-fields">
          <div className="form-row">
            <label className="field">
              Email
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@company.com"
              />
            </label>
            <label className="field">
              Access
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
              >
                <option value="read">Read only</option>
                <option value="edit">Editor</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <button type="submit">Save access</button>
          </div>
        </fieldset>
      </form>
      {message && (
        <p className="success" role="status">
          {message}
        </p>
      )}
      <hr />
      <h3>Bot API key</h3>
      <p className="subtle small">
        Use <code>Authorization: Bearer KEY</code> with{" "}
        <code>/api/v1/tasks</code> to manage features and bugs.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const result = await api("/api/admin/api-keys", {
              method: "POST",
              body: JSON.stringify({ name, role: "edit" }),
            });
            setKey(result.key);
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-row">
          <label className="field">
            Key name
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button disabled={busy}>Create key</button>
        </div>
      </form>
      {key && (
        <div className="key-box">
          <strong>Copy now — shown once:</strong>
          <code>{key}</code>
        </div>
      )}
    </Modal>
  );
}
