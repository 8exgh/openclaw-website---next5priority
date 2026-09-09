"use client";
import { useCallback, useEffect, useState } from "react";
import {
  PRIORITIES,
  STATES,
  STATE_LABELS,
  type ItemKind,
  type Section,
  type Task,
  type User,
} from "../lib/project-types";
import { Admin, Login, Profile } from "./components/account";
import { NewItem } from "./components/item-form";
import { ItemView } from "./components/item-detail";
import {
  api,
  Avatar,
  command,
  ErrorNotice,
  errorMessage,
} from "./components/project-ui";

type CreateOptions = { kind: ItemKind; sectionId?: string; parent?: Task };
function TaskRow({
  task,
  users,
  canEdit,
  open,
  patch,
  count,
  busy,
  depth = 0,
}: {
  task: Task;
  users: User[];
  canEdit: boolean;
  open: (id: string) => void;
  patch: (data: object) => Promise<void>;
  count: number;
  busy: boolean;
  depth?: number;
}) {
  return (
    <div className="task-branch">
      <div
        className={`task-row state-${task.state}`}
        style={{ paddingLeft: `${14 + depth * 22}px` }}
      >
        {task.kind === "feature" &&
        !task.parentId &&
        task.sectionId === "next-five" ? (
          <span className="rank-number">{task.position + 1}</span>
        ) : (
          <span className={`item-symbol ${task.kind}`}>
            {task.kind === "bug" ? "!" : "◇"}
          </span>
        )}
        <button className="task-title" onClick={() => open(task.id)}>
          {task.publicId && <span className="item-id">{task.publicId}</span>}
          <span>{task.title}</span>
          {!task.leaf && (
            <span className="computed">{task.children.length} subtasks</span>
          )}
        </button>
        {task.implementorId && (
          <Avatar user={users.find((u) => u.id === task.implementorId)} />
        )}
        <span className={`status status-${task.state}`}>
          {STATE_LABELS[task.state]}
        </span>
        {task.kind === "bug" &&
          (canEdit ? (
            <select
              className={`priority priority-${task.priority}`}
              aria-label={`Priority for ${task.publicId}`}
              value={task.priority || "P3"}
              disabled={busy}
              onChange={(e) => patch({ id: task.id, priority: e.target.value })}
            >
              {PRIORITIES.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          ) : (
            <span className={`priority priority-${task.priority}`}>
              {task.priority}
            </span>
          ))}
        {canEdit && task.kind === "feature" && !task.parentId && (
          <div className="row-actions">
            {task.sectionId === "next-five" && (
              <>
                <button
                  disabled={busy || task.position === 0}
                  aria-label={`Move ${task.title} up`}
                  title="Move up"
                  onClick={() =>
                    patch({ id: task.id, position: task.position - 1 })
                  }
                >
                  ↑
                </button>
                <button
                  disabled={busy || task.position === count - 1}
                  aria-label={`Move ${task.title} down`}
                  title="Move down"
                  onClick={() =>
                    patch({ id: task.id, position: task.position + 1 })
                  }
                >
                  ↓
                </button>
              </>
            )}
            <button
              disabled={busy}
              className="move-button"
              onClick={() =>
                patch({
                  id: task.id,
                  sectionId:
                    task.sectionId === "next-five"
                      ? "feature-backlog"
                      : "next-five",
                })
              }
            >
              {task.sectionId === "next-five" ? "To backlog" : "To Next 5"}
            </button>
          </div>
        )}
      </div>
      {task.children.map((child) => (
        <TaskRow
          key={child.id}
          task={child}
          users={users}
          canEdit={canEdit}
          open={open}
          patch={patch}
          count={count}
          busy={busy}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}
export function ProjectApp() {
  const [me, setMe] = useState<User | null>(null),
    [users, setUsers] = useState<User[]>([]),
    [sections, setSections] = useState<Section[]>([]),
    [items, setItems] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<ItemKind>("feature"),
    [search, setSearch] = useState(""),
    [stateFilter, setStateFilter] = useState("");
  const [admin, setAdmin] = useState(false),
    [profile, setProfile] = useState(false),
    [creating, setCreating] = useState<CreateOptions | null>(null),
    [selected, setSelected] = useState<string | null>(null);
  const load = useCallback(async () => {
    const response = await fetch("/api/project");
    if (response.status === 401) {
      setMe(null);
      setLoading(false);
      return;
    }
    const body = await response.json();
    if (!response.ok)
      throw new Error(body.error || "Could not load the project.");
    setMe(body.user);
    setUsers(body.users);
    setSections(body.sections);
    setItems(body.items);
    setLoading(false);
  }, []);
  useEffect(() => {
    load().catch((e) => {
      setError(errorMessage(e));
      setLoading(false);
    });
    const sync = () =>
      setSelected(
        new URLSearchParams(window.location.search).get("item") || null,
      );
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [load]);
  const open = (id: string | null) => {
    setSelected(id);
    const item = items.find((item) => item.id === id || item.publicId === id);
    if (item) setTab(item.kind);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("item", id);
    else url.searchParams.delete("item");
    window.history.pushState({}, "", url);
  };
  async function patch(data: object) {
    setBusy(true);
    setError("");
    try {
      await command("/api/project", "PATCH", data);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  if (loading) return <main className="loading">Loading priorities…</main>;
  if (!me)
    return error ? (
      <main className="login-shell">
        <div className="login-card">
          <ErrorNotice error={error} />
          <button
            onClick={() => {
              setError("");
              setLoading(true);
              load().catch((e) => {
                setError(errorMessage(e));
                setLoading(false);
              });
            }}
          >
            Retry
          </button>
        </div>
      </main>
    ) : (
      <Login onDone={load} />
    );
  const canEdit = me.role !== "read";
  const visible = sections.filter((s) =>
    tab === "feature" ? !s.id.startsWith("bugs-") : s.id.startsWith("bugs-"),
  );
  const matching = (task: Task): boolean =>
    ((!search ||
      `${task.publicId || ""} ${task.title} ${task.description}`
        .toLowerCase()
        .includes(search.toLowerCase())) &&
      (!stateFilter || task.state === stateFilter)) ||
    task.children.some(matching);
  const features = items.filter(
    (t) => t.kind === "feature" && !t.parentId,
  ).length;
  const bugs = items.filter((t) => t.kind === "bug").length;
  return (
    <>
      <header className="app-header">
        <div className="identity">
          <div className="brand-mark small-mark">N5</div>
          <div>
            <p className="eyebrow">NEXT 5 PRIORITY</p>
            <strong>Project command centre</strong>
          </div>
        </div>
        <div className="account">
          <button
            className="profile-button"
            aria-label="Your profile"
            onClick={() => setProfile(true)}
          >
            <Avatar user={me} />
            <span>{me.name || me.email}</span>
          </button>
          {me.role === "admin" && (
            <button onClick={() => setAdmin(true)}>Team & API</button>
          )}
          <button
            onClick={async () => {
              try {
                await api("/api/auth/logout", { method: "POST" });
                setMe(null);
                setAdmin(false);
                setProfile(false);
                setCreating(null);
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      <main className="board">
        <section className="hero">
          <div>
            <p className="eyebrow">
              {tab === "feature"
                ? "PLAN WITH PURPOSE"
                : "KEEP QUALITY IN FOCUS"}
            </p>
            <h1>
              {tab === "feature"
                ? "Make the next five count."
                : "Every bug, in its place."}
            </h1>
            <p>
              {tab === "feature"
                ? "Choose five features to focus on. Keep everything else in the backlog, ready for its turn."
                : "Triage by priority. Track the fix from first report to final review."}
            </p>
          </div>
          {canEdit && (
            <button
              className="primary new-item-button"
              onClick={() =>
                setCreating({ kind: tab, sectionId: "feature-backlog" })
              }
            >
              ＋ {tab === "feature" ? "New feature" : "Report a bug"}
            </button>
          )}
        </section>
        <div className="board-toolbar">
          <nav className="board-tabs" aria-label="Work type">
            <button
              aria-pressed={tab === "feature"}
              onClick={() => {
                setTab("feature");
                setSearch("");
                setStateFilter("");
              }}
            >
              Features <span>{features}</span>
            </button>
            <button
              aria-pressed={tab === "bug"}
              onClick={() => {
                setTab("bug");
                setSearch("");
                setStateFilter("");
              }}
            >
              Bugs <span>{bugs}</span>
            </button>
          </nav>
          <div className="board-filters">
            <input
              type="search"
              aria-label="Search items"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                tab === "bug" ? "Search bugs or SAV ID…" : "Search features…"
              }
            />
            <select
              aria-label="Filter by state"
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
            >
              <option value="">All states</option>
              {STATES.map((s) => (
                <option key={s} value={s}>
                  {STATE_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <ErrorNotice error={error} />
        <div className={`section-grid ${tab}-grid`}>
          {visible.map((section) => {
            const tasks = section.tasks.filter(matching);
            return (
              <section
                className="project-section"
                key={section.id}
                aria-label={section.name}
              >
                <div className="section-head">
                  <div>
                    <h2>{section.name}</h2>
                    <p>
                      {section.id === "next-five"
                        ? "Ordered by focus · move features up or down"
                        : section.id === "feature-backlog"
                          ? "Good ideas, waiting for their turn"
                          : "Priority first, then newest report"}
                    </p>
                  </div>
                  <span className="section-count">
                    {section.id === "next-five"
                      ? `${section.tasks.length} / 5`
                      : section.tasks.length}
                  </span>
                </div>
                <div className="tasks">
                  {tasks.length ? (
                    tasks.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        users={users}
                        canEdit={canEdit}
                        open={open}
                        patch={patch}
                        count={section.tasks.length}
                        busy={busy}
                      />
                    ))
                  ) : (
                    <div className="empty">
                      <span className="empty-symbol">
                        {tab === "feature" ? "◇" : "✓"}
                      </span>
                      <p>
                        {search || stateFilter
                          ? "No matching items."
                          : section.id === "next-five"
                            ? "Your next five start here."
                            : tab === "bug"
                              ? "No bugs in this priority group."
                              : "Room for your next idea."}
                      </p>
                      <span>
                        {section.id === "next-five" && !search && !stateFilter
                          ? "Move a feature from the backlog, or add one below."
                          : ""}
                      </span>
                    </div>
                  )}
                </div>
                {canEdit && tab === "feature" && (
                  <div className="section-footer">
                    <button
                      disabled={
                        busy ||
                        (section.id === "next-five" &&
                          section.tasks.length >= 5)
                      }
                      onClick={() =>
                        setCreating({ kind: "feature", sectionId: section.id })
                      }
                    >
                      ＋ Add feature
                    </button>
                    {section.id === "next-five" &&
                      section.tasks.length >= 5 && (
                        <span>All five spots are filled.</span>
                      )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
        <p className="board-footnote">
          {tab === "feature"
            ? "Subtasks move with their parent. Parent states reflect the earliest unfinished stage beneath them."
            : "Changing a bug’s priority automatically places it in the correct list."}
        </p>
      </main>
      {selected && !creating && (
        <ItemView
          key={selected}
          id={selected}
          me={me}
          users={users}
          items={items}
          close={() => open(null)}
          changed={load}
          open={open}
          addChild={(parent) => setCreating({ kind: "feature", parent })}
        />
      )}
      {creating && (
        <NewItem
          {...creating}
          users={users}
          close={() => setCreating(null)}
          created={(id) => {
            setCreating(null);
            load().catch((e) => setError(errorMessage(e)));
            open(id);
          }}
        />
      )}
      {profile && (
        <Profile me={me} close={() => setProfile(false)} saved={load} />
      )}
      {admin && (
        <Admin users={users} close={() => setAdmin(false)} changed={load} />
      )}
    </>
  );
}
