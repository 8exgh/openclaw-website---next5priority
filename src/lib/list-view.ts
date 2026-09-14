import {
  PRIORITIES,
  STATES,
  type ItemKind,
  type Priority,
  type Task,
  type TaskState,
} from "./project-types.ts";

export type BoardTab = "next-five" | "backlog" | "kanban";
export type ListFilters = {
  ticketClass: "all" | ItemKind;
  severities: Priority[];
  search: string;
  state: TaskState | "";
};
export type ListTask = Task & { filterContext?: boolean; children: ListTask[] };
export const defaultFilters = (): ListFilters => ({
  ticketClass: "all",
  severities: [...PRIORITIES],
  search: "",
  state: "",
});
const paths: Record<BoardTab, string> = {
  "next-five": "/",
  backlog: "/backlog",
  kanban: "/kanban",
};

export function readListLocation(url: URL): {
  tab: BoardTab;
  filters: ListFilters;
} {
  const filters = defaultFilters();
  const params = url.searchParams;
  const legacyHigh =
    url.pathname === "/bugs/p1-p2" ||
    (url.pathname === "/" && params.get("view") === "bugs");
  const legacyLow = url.pathname === "/bugs/p3-p4";
  const tab =
    url.pathname === "/kanban"
      ? "kanban"
      : url.pathname === "/backlog" || legacyHigh || legacyLow
        ? "backlog"
        : "next-five";
  if (legacyHigh || legacyLow) {
    filters.ticketClass = "bug";
    filters.severities = legacyHigh ? ["P1", "P2"] : ["P3", "P4"];
  }
  if (tab === "backlog") {
    if (params.get("class") === "features") filters.ticketClass = "feature";
    if (params.get("class") === "bugs") filters.ticketClass = "bug";
    if (params.get("class") === "all") filters.ticketClass = "all";
    if (params.has("severity")) {
      const selected = params.get("severity")!.split(",");
      filters.severities = PRIORITIES.filter((priority) =>
        selected.includes(priority),
      );
    }
  }
  filters.search = params.get("q") || "";
  const state = params.get("state");
  filters.state = STATES.find((value) => value === state) || "";
  return { tab, filters };
}

export function listUrl(current: URL, tab: BoardTab, filters: ListFilters) {
  const url = new URL(current);
  url.pathname = paths[tab];
  for (const key of ["view", "class", "severity", "q", "state"])
    url.searchParams.delete(key);
  if (tab === "backlog") {
    if (filters.ticketClass !== "all")
      url.searchParams.set(
        "class",
        filters.ticketClass === "bug" ? "bugs" : "features",
      );
    if (filters.severities.length !== PRIORITIES.length)
      url.searchParams.set(
        "severity",
        PRIORITIES.filter((priority) =>
          filters.severities.includes(priority),
        ).join(",") || "none",
      );
  }
  if (filters.search) url.searchParams.set("q", filters.search);
  if (filters.state) url.searchParams.set("state", filters.state);
  return url;
}

export function listForItem(item: Task): BoardTab {
  return item.kind === "feature" && item.sectionId === "next-five"
    ? "next-five"
    : "backlog";
}

export function backlogItems(items: Task[]): Task[] {
  return items
    .filter(
      (item) =>
        !item.parentId &&
        (item.kind === "bug" || item.sectionId === "feature-backlog"),
    )
    .sort(
      (a, b) =>
        PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) ||
        b.createdAt.localeCompare(a.createdAt) ||
        a.id.localeCompare(b.id),
    );
}

export function filterList(items: Task[], filters: ListFilters): ListTask[] {
  const query = filters.search.trim().toLowerCase();
  return items.flatMap((item) => {
    const children = filterList(item.children, filters);
    const matches =
      (filters.ticketClass === "all" || item.kind === filters.ticketClass) &&
      filters.severities.includes(item.priority) &&
      (!filters.state || item.state === filters.state) &&
      (!query ||
        `${item.publicId || ""} ${item.title} ${item.description}`
          .toLowerCase()
          .includes(query));
    if (!matches && !children.length) return [];
    return [
      {
        ...item,
        children,
        leaf: children.length === 0,
        filterContext: !matches,
      },
    ];
  });
}
