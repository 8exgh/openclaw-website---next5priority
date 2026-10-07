"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
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
import { BacklogFilters, MineFilter } from "./components/backlog-filters";
import { SprintPicker } from "./components/sprint-picker";
import {
  availableSprints,
  currentSprint,
  sprintAssignmentOptions,
  sprintItems,
} from "../lib/sprints";
import {
  backlogItems,
  defaultFilters,
  filterList,
  listForItem,
  listUrl,
  readListLocation,
  type BoardTab,
  type ListFilters,
  type ListTask,
} from "../lib/list-view";
import { Admin, Login, Profile } from "./components/account";
import { NewItem } from "./components/item-form";
import { ItemView } from "./components/item-detail";
import {
  api,
  Avatar,
  command,
  EffortBadge,
  ErrorNotice,
  errorMessage,
  StateControl,
} from "./components/project-ui";

type CreateOptions = {
  kind: ItemKind;
  sectionId?: string;
  parent?: Task;
  initialPriority?: Priority;
  initialSprint?: string | null;
};
function TaskRow({
  task,
  users,
  canEdit,
  open,
  patch,
  count,
  busy,
  sprintOptions,
  depth = 0,
}: {
  task: ListTask;
  users: User[];
  canEdit: boolean;
  open: (id: string) => void;
  patch: (data: object) => Promise<void>;
  count: number;
  busy: boolean;
  sprintOptions: string[];
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
          {task.filterContext && (
            <span className="computed">Matching subtask</span>
          )}
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
        <EffortBadge effort={task.effort} />
        {!task.parentId &&
          (canEdit ? (
            <div className="row-sprint">
              <SprintPicker
                ariaLabel={`Sprint for ${task.title}`}
                value={task.sprintId}
                options={sprintOptions}
                disabled={busy}
                onChange={(sprintId) => patch({ id: task.id, sprintId })}
              />
            </div>
          ) : task.sprintId ? (
            <span className="sprint-badge">{task.sprintId}</span>
          ) : null)}
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
                sprintOptions={sprintOptions}
                depth={depth + 1}
              />
            ))}
        </div>
      )}
    </div>
  );
}
export function ProjectApp({
  initialTab = "next-five",
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
  const [tab, setTab] = useState<BoardTab>(initialTab);
  const [lastListTab, setLastListTab] = useState<"next-five" | "backlog">(
    initialTab === "backlog" ? "backlog" : "next-five",
  );
  const [filters, setFilters] = useState<ListFilters>(defaultFilters);
  const [week, setWeek] = useState(currentSprint);
  const sprintWeeks = availableSprints(items, week);
  const activeSprint = sprintWeeks.includes(filters.sprint)
    ? filters.sprint
    : week;
  const sprintOptions = sprintAssignmentOptions(items, week);
  const search = filters.search,
    stateFilter = filters.state;
  const headerRef = useRef<HTMLElement>(null);
  const [headerHeight, setHeaderHeight] = useState(76);
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
      const current = new URL(window.location.href);
      const location = readListLocation(current);
      setSelected(current.searchParams.get("item"));
      setTab(location.tab);
      setFilters(location.filters);
      if (location.tab === "next-five" || location.tab === "backlog")
        setLastListTab(location.tab);
      const url = listUrl(current, location.tab, location.filters);
      if (url.href !== current.href) window.history.replaceState({}, "", url);
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [load]);
  useEffect(() => {
    const timer = setInterval(() => setWeek(currentSprint()), 60_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (
      loading || !me || tab !== "sprint" || !filters.sprint ||
      availableSprints(items, week).includes(filters.sprint)
    ) return;
    const next = { ...filters, sprint: "" };
    setFilters(next);
    window.history.replaceState(
      {}, "", listUrl(new URL(window.location.href), tab, next),
    );
  }, [items, week, filters, tab, loading, me]);
  useEffect(() => {
    if (!selected || tab === "kanban" || tab === "sprint") return;
    const item = items.find(
      (item) => item.id === selected || item.publicId === selected,
    );
    if (!item) return;
    const next = listForItem(item);
    // Item links still resolve to the current list after a move or conversion.
    if (next !== tab) {
      setTab(next);
      setLastListTab(next);
      window.history.replaceState(
        {},
        "",
        listUrl(new URL(window.location.href), next, filters),
      );
    }
  }, [items, selected, tab, filters]);
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const measure = () =>
      setHeaderHeight(header.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, [!!me]);
  const changeFilters = (next: ListFilters) => {
    setFilters(next);
    window.history.replaceState(
      {},
      "",
      listUrl(new URL(window.location.href), tab, next),
    );
  };
  const selectTab = (next: BoardTab) => {
    if (next === tab) return;
    setTab(next);
    if (next === "next-five" || next === "backlog") setLastListTab(next);
    const nextFilters = {
      ...filters, search: "", state: "" as const, sprint: "",
    };
    setFilters(nextFilters);
    const url = listUrl(new URL(window.location.href), next, nextFilters);
    if (url.href !== window.location.href)
      window.history.pushState({}, "", url);
  };
  const selectSprint = (sprint: string) => {
    const next = { ...filters, sprint: sprint === week ? "" : sprint };
    setFilters(next);
    setSelected(null);
    const url = listUrl(new URL(window.location.href), "sprint", next);
    url.searchParams.delete("item");
    if (url.href !== window.location.href) window.history.pushState({}, "", url);
  };
  const open = (id: string | null) => {
    setSelected(id);
    const item = id
      ? items.find((item) => item.id === id || item.publicId === id)
      : undefined;
    const next = item && tab !== "kanban" && tab !== "sprint"
      ? listForItem(item) : tab;
    setTab(next);
    if (next === "next-five" || next === "backlog") setLastListTab(next);
    const url = listUrl(new URL(window.location.href), next, filters);
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
  const nextFive =
    sections.find((section) => section.id === "next-five")?.tasks || [];
  const backlog = backlogItems(sections.flatMap((section) => section.tasks));
  const listItems = tab === "sprint"
    ? sprintItems(items, activeSprint)
    : tab === "next-five" ? nextFive : backlog;
  const activeFilters =
    tab === "sprint"
      ? defaultFilters()
      : tab === "backlog"
        ? filters
        : { ...defaultFilters(), search, state: filters.state, mine: filters.mine };
  const visibleItems = filterList(listItems, activeFilters, me.id);
  const filtered =
    tab !== "sprint" && (
      !!search || !!stateFilter || filters.mine ||
      (tab === "backlog" &&
        (filters.ticketClass !== "all" || filters.severities.length !== 4))
    );
  return (
    <>
      <header ref={headerRef} className="app-header">
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
      <main
        className={`board${tab === "kanban" ? " board-kanban" : ""}`}
        style={{ "--app-header-height": `${headerHeight}px` } as CSSProperties}
      >
        <section className="hero">
          <div>
            <p className="eyebrow">
              {tab === "kanban" ? "THE WORK IN MOTION" : "PLAN WITH PURPOSE"}
            </p>
            <h1>
              {tab === "kanban"
                ? "Keep the work moving."
                : tab === "sprint"
                  ? "Plan the week ahead."
                  : tab === "next-five"
                    ? "Make the next five count."
                    : "Make room for what’s next."}
            </h1>
            <p>
              {tab === "kanban"
                ? "Your next five features and urgent bugs, from first review to done."
                : tab === "sprint"
                  ? "Weekly sprints, Monday through Sunday. Assign root items to plan your work."
                  : tab === "next-five"
                    ? "Choose five features to focus on. Move them up or down as priorities change."
                    : "Features and bugs in one backlog. Find the right work by class, severity, and state."}
            </p>
          </div>
          {canEdit && (
            <div className="new-item-actions">
              <button
                className="primary"
                onClick={() =>
                  setCreating({
                    kind: "feature",
                    sectionId: "feature-backlog",
                    initialSprint: tab === "sprint" ? activeSprint : null,
                  })
                }
              >
                ＋ New feature
              </button>
              <button
                onClick={() =>
                  setCreating({
                    kind: "bug",
                    initialSprint: tab === "sprint" ? activeSprint : null,
                    initialPriority:
                      tab === "backlog" && !filters.severities.includes("P3")
                        ? PRIORITIES.find((priority) =>
                            filters.severities.includes(priority),
                          ) || "P3"
                        : "P3",
                  })
                }
              >
                ＋ Report a bug
              </button>
            </div>
          )}
        </section>
        <div className="board-toolbar">
          <nav className="board-tabs" aria-label="View">
            <button
              aria-pressed={tab === "next-five" || tab === "backlog"}
              onClick={() => selectTab(lastListTab)}
            >
              List
            </button>
            <button
              aria-pressed={tab === "kanban"}
              onClick={() => selectTab("kanban")}
            >
              Kanban
            </button>
            <button
              aria-pressed={tab === "sprint"}
              onClick={() => selectTab("sprint")}
            >
              Sprint
            </button>
          </nav>
          {(tab === "next-five" || tab === "kanban") && (
            <div className="board-filters">
              <input
                type="search"
                aria-label="Search items"
                value={search}
                onChange={(event) =>
                  changeFilters({ ...filters, search: event.target.value })
                }
                placeholder={
                  tab === "kanban"
                    ? "Search priority work…"
                    : "Search next five…"
                }
              />
              <select
                aria-label="Filter by state"
                value={stateFilter}
                onChange={(event) =>
                  changeFilters({
                    ...filters,
                    state: event.target.value as ListFilters["state"],
                  })
                }
              >
                <option value="">All states</option>
                {STATES.map((state) => (
                  <option key={state} value={state}>
                    {STATE_LABELS[state]}
                  </option>
                ))}
              </select>
              <MineFilter filters={filters} change={changeFilters} />
            </div>
          )}
          {tab === "sprint" && (
            <div className="sprint-controls">
              <label className="filter-field">
                Sprint
                <select
                  aria-label="Selected sprint"
                  value={activeSprint}
                  onChange={(event) => selectSprint(event.target.value)}
                >
                  {sprintWeeks.map((sprint) => (
                    <option key={sprint} value={sprint}>
                      {sprint}{sprint === week ? " · Current week" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button
                disabled={activeSprint === week}
                onClick={() => selectSprint(week)}
              >
                Current week
              </button>
            </div>
          )}
        </div>
        {(tab === "next-five" || tab === "backlog") && (
          <nav className="list-tabs" aria-label="List sections">
            <button
              aria-pressed={tab === "next-five"}
              onClick={() => selectTab("next-five")}
            >
              Next 5 <span>{nextFive.length} / 5</span>
            </button>
            <button
              aria-pressed={tab === "backlog"}
              onClick={() => selectTab("backlog")}
            >
              Backlog <span>{backlog.length}</span>
            </button>
          </nav>
        )}
        {tab === "backlog" && (
          <BacklogFilters filters={filters} change={changeFilters} />
        )}
        <ErrorNotice error={error} />
        {tab === "kanban" ? (
          <Kanban
            items={items}
            users={users}
            canEdit={canEdit}
            busy={busy}
            search={search}
            stateFilter={stateFilter}
            mine={filters.mine}
            userId={me.id}
            open={open}
            patch={patch}
          />
        ) : (
          <section
            className={`project-section ${tab === "next-five" ? "next-five-section" : "backlog-section"}`}
            aria-label={tab === "sprint" ? "Sprint items"
              : tab === "next-five" ? "Next 5 features" : "Backlog"}
          >
            <div className="section-head">
              <div>
                <h2>
                  {tab === "sprint" ? activeSprint
                    : tab === "next-five" ? "Next 5" : "Backlog"}
                </h2>
                <p>
                  {tab === "sprint"
                    ? "Root items assigned to this sprint"
                    : tab === "next-five"
                      ? "Ordered by focus · move features up or down"
                      : filters.sort === "newest"
                        ? "Features and bugs · most recently added first"
                        : "Features and bugs · severity first, then newest report"}
                </p>
              </div>
              <span className="section-count">
                {tab === "next-five"
                  ? `${nextFive.length} / 5`
                  : filtered
                    ? `${visibleItems.length} of ${listItems.length}`
                    : listItems.length}
              </span>
            </div>
            <div className="tasks">
              {visibleItems.length ? (
                visibleItems.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    users={users}
                    canEdit={canEdit}
                    open={open}
                    patch={patch}
                    count={nextFive.length}
                    busy={busy}
                    sprintOptions={sprintOptions}
                  />
                ))
              ) : (
                <div className="empty">
                  <span className="empty-symbol">◇</span>
                  <p>
                    {filtered
                      ? "No matching items."
                      : tab === "sprint"
                        ? "No items assigned to this sprint."
                        : tab === "next-five"
                          ? "Your next five start here."
                          : "Room for your next idea."}
                  </p>
                  {tab === "next-five" && !filtered && (
                    <span>
                      Move a feature from the backlog, or add one below.
                    </span>
                  )}
                </div>
              )}
            </div>
            {canEdit && tab === "next-five" && (
              <div className="section-footer">
                <button
                  disabled={busy || nextFive.length >= 5}
                  onClick={() =>
                    setCreating({ kind: "feature", sectionId: "next-five" })
                  }
                >
                  ＋ Add feature
                </button>
                {nextFive.length >= 5 && (
                  <span>All five spots are filled.</span>
                )}
              </div>
            )}
          </section>
        )}
        <p className="board-footnote">
          {tab === "kanban"
            ? "Completed cards stay visible for 28 days from completion. Earlier work remains available in List."
            : tab === "sprint"
              ? "Assign or move work using an item’s Sprint picker. Open an item to view its subtasks."
              : tab === "next-five"
                ? "Change an item’s state from its label. Parent and subtask states are independent."
                : "Next 5 features have their own list. Parents marked “Matching subtask” provide context for filtered results."}
        </p>
      </main>
      {selected && !creating && (
        <ItemView
          key={selected}
          id={selected}
          me={me}
          users={users}
          items={items}
          sprintOptions={sprintOptions}
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
          sprintOptions={sprintOptions}
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
