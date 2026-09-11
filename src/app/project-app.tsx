"use client";
import { useCallback, useEffect, useState } from "react";
import {
  PRIORITIES,
  STATES,
  STATE_LABELS,
  type ItemKind,
  type Priority,
  type Section,
  type Task,
  type User,
} from "../lib/project-types";
import { Kanban } from "./components/kanban";
import { Admin, Login, Profile } from "./components/account";
import { NewItem } from "./components/item-form";
import { ItemView } from "./components/item-detail";
import {
  api,
  Avatar,
  command,
  ErrorNotice,
  errorMessage,
  StateControl,
} from "./components/project-ui";

type CreateOptions = {
  kind: ItemKind;
  sectionId?: string;
  parent?: Task;
  initialPriority?: Priority;
};
type BoardTab = "feature" | "bugs-high" | "bugs-low" | "kanban";
const TAB_PATHS: Record<BoardTab, string> = {
  feature: "/",
  "bugs-high": "/bugs/p1-p2",
  "bugs-low": "/bugs/p3-p4",
  kanban: "/kanban",
};
function itemTab(item: Task): BoardTab {
  return item.kind === "feature"
    ? "feature"
    : item.priority === "P1" || item.priority === "P2"
      ? "bugs-high"
      : "bugs-low";
}
function tabUrl(tab: BoardTab) {
  const url = new URL(window.location.href);
  url.pathname = TAB_PATHS[tab];
  url.searchParams.delete("view");
  return url;
}
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
  const [expanded, setExpanded] = useState(false);
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
        {!task.leaf && (
          <button
            className="subtask-toggle"
            aria-label={`${expanded ? "Collapse" : "Expand"} subtasks for ${task.title}`}
            aria-expanded={expanded}
            aria-controls={`subtasks-${task.id}`}
            onClick={() => setExpanded(!expanded)}
          >
            <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
          </button>
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
        <StateControl
          task={task}
          canEdit={canEdit}
          disabled={busy}
          onChange={(state) => patch({ id: task.id, state })}
        />
        {canEdit ? (
          <select
            className={`priority priority-${task.priority}`}
            aria-label={`Priority for ${task.publicId || task.title}`}
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
        )}
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
      {!task.leaf && (
        <div id={`subtasks-${task.id}`} hidden={!expanded}>
          {expanded &&
            task.children.map((child) => (
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
      )}
    </div>
  );
}
export function ProjectApp({
  initialTab = "feature",
}: {
  initialTab?: BoardTab;
}) {
  const [me, setMe] = useState<User | null>(null),
    [users, setUsers] = useState<User[]>([]),
    [sections, setSections] = useState<Section[]>([]),
    [items, setItems] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<BoardTab>(initialTab),
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
    const sync = () => {
      const params = new URLSearchParams(window.location.search);
      setSelected(params.get("item") || null);
      const path = window.location.pathname;
      const next =
        (Object.keys(TAB_PATHS) as BoardTab[]).find(
          (key) => TAB_PATHS[key] === path,
        ) || "feature";
      // Existing bug bookmarks still open the high-priority group. An item
      // link will resolve to its actual group once its data has loaded.
      const legacy = path === "/" && params.get("view") === "bugs";
      setTab(legacy ? "bugs-high" : next);
      if (legacy) window.history.replaceState({}, "", tabUrl("bugs-high"));
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [load]);
  useEffect(() => {
    if (!selected || tab === "kanban") return;
    const item = items.find(
      (item) => item.id === selected || item.publicId === selected,
    );
    if (!item) return;
    const next = itemTab(item);
    // Keep the item's URL current after creation, conversion, or a priority
    // change, and resolve older /?item= links into the matching list.
    if (next !== tab || window.location.pathname !== TAB_PATHS[next]) {
      setTab(next);
      window.history.replaceState({}, "", tabUrl(next));
    }
  }, [items, selected, tab]);
  const selectTab = (next: BoardTab) => {
    setTab(next);
    setSearch("");
    setStateFilter("");
    const url = tabUrl(next);
    if (url.href !== window.location.href)
      window.history.pushState({}, "", url);
  };
  const open = (id: string | null) => {
    setSelected(id);
    const item = id
      ? items.find((item) => item.id === id || item.publicId === id)
      : undefined;
    const next = item && tab !== "kanban" ? itemTab(item) : tab;
    setTab(next);
    const url = tabUrl(next);
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
  const bugTab = tab === "bugs-high" || tab === "bugs-low";
  const visible = sections.filter((s) =>
    tab === "feature" ? !s.id.startsWith("bugs-") : s.id === tab,
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
  const highBugs =
    sections.find((s) => s.id === "bugs-high")?.tasks.length || 0;
  const lowBugs = sections.find((s) => s.id === "bugs-low")?.tasks.length || 0;
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
      <main className={`board${tab === "kanban" ? " board-kanban" : ""}`}>
        <section className="hero">
          <div>
            <p className="eyebrow">
              {tab === "kanban"
                ? "THE WORK IN MOTION"
                : tab === "feature"
                  ? "PLAN WITH PURPOSE"
                  : "KEEP QUALITY IN FOCUS"}
            </p>
            <h1>
              {tab === "kanban"
                ? "Keep the work moving."
                : tab === "feature"
                  ? "Make the next five count."
                  : "Every bug, in its place."}
            </h1>
            <p>
              {tab === "kanban"
                ? "Your next five features and urgent bugs, from first review to done."
                : tab === "feature"
                  ? "Choose five features to focus on. Keep everything else in the backlog, ready for its turn."
                  : tab === "bugs-high"
                    ? "P1 and P2 bugs, sorted by priority and newest report."
                    : "P3 and P4 bugs, sorted by priority and newest report."}
            </p>
          </div>
          {canEdit && (
            <button
              className="primary new-item-button"
              onClick={() =>
                setCreating({
                  kind: bugTab ? "bug" : "feature",
                  sectionId: "feature-backlog",
                  initialPriority: tab === "bugs-high" ? "P2" : "P3",
                })
              }
            >
              ＋ {bugTab ? "Report a bug" : "New feature"}
            </button>
          )}
        </section>
        <div className="board-toolbar">
          <nav className="board-tabs" aria-label="Work type">
            <button
              aria-pressed={tab === "feature"}
              onClick={() => selectTab("feature")}
            >
              Features <span>{features}</span>
            </button>
            <button
              aria-pressed={tab === "bugs-high"}
              onClick={() => selectTab("bugs-high")}
            >
              P1/P2 Bugs <span>{highBugs}</span>
            </button>
            <button
              aria-pressed={tab === "bugs-low"}
              onClick={() => selectTab("bugs-low")}
            >
              P3/P4 Bugs <span>{lowBugs}</span>
            </button>
            <button
              aria-pressed={tab === "kanban"}
              onClick={() => selectTab("kanban")}
            >
              Kanban
            </button>
          </nav>
          <div className="board-filters">
            <input
              type="search"
              aria-label="Search items"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                tab === "kanban"
                  ? "Search priority work…"
                  : bugTab
                    ? "Search bugs or SAV ID…"
                    : "Search features…"
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
        {tab === "kanban" ? (
          <Kanban
            items={items}
            users={users}
            canEdit={canEdit}
            busy={busy}
            search={search}
            stateFilter={stateFilter}
            open={open}
            patch={patch}
          />
        ) : (
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
                              : bugTab
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
                          setCreating({
                            kind: "feature",
                            sectionId: section.id,
                          })
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
        )}
        <p className="board-footnote">
          {tab === "kanban"
            ? "Completed cards stay visible for 28 days from completion. Earlier work remains available in Features and Bugs."
            : tab === "feature"
              ? "Change an item’s state from its label. Parent and subtask states are independent."
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
