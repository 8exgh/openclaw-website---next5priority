import assert from "node:assert/strict";
import test from "node:test";
import {
  ancestors,
  assignedTo,
  backlogItems,
  defaultFilters,
  filterList,
  listForItem,
  listUrl,
  readListLocation,
} from "./list-view.ts";
import type { Task } from "./project-types.ts";

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    publicId: null,
    kind: "feature",
    sectionId: "feature-backlog",
    parentId: null,
    sprintId: null,
    title: id,
    description: "",
    state: "needs_review",
    ownState: "needs_review",
    priority: "P3",
    effort: null,
    implementorId: null,
    reviewerId: null,
    createdBy: null,
    position: 0,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    completedAt: null,
    leaf: true,
    children: [],
    ...overrides,
  };
}

test("backlog combines bugs and waiting root features, sorted by severity then newest report", () => {
  const bug = task("bug", {
    kind: "bug",
    sectionId: "bugs-high",
    priority: "P1",
  });
  const newer = task("newer", {
    priority: "P1",
    createdAt: "2026-09-14T00:00:00Z",
  });
  const low = task("low", {
    kind: "bug",
    sectionId: "bugs-low",
    priority: "P4",
  });
  const next = task("next", { sectionId: "next-five" });
  const child = task("child", { parentId: newer.id });
  assert.deepEqual(
    backlogItems([low, newer, next, child, bug]).map((item) => item.id),
    ["newer", "bug", "low"],
  );
  assert.equal(listForItem(next), "next-five");
  assert.equal(listForItem(bug), "backlog");
  assert.equal(listForItem(low), "backlog");
});

test("class, severity, state, and text filters combine while severity selections form a union", () => {
  const items = [
    task("feature", { priority: "P1" }),
    task("bug-one", {
      kind: "bug",
      priority: "P1",
      publicId: "SAV-000001",
      state: "in_progress",
    }),
    task("bug-two", { kind: "bug", priority: "P2", state: "in_progress" }),
    task("bug-three", { kind: "bug", priority: "P3" }),
  ];
  const filters = {
    ...defaultFilters(),
    ticketClass: "bug" as const,
    severities: ["P1", "P2"] as const,
  };
  assert.deepEqual(
    filterList(items, { ...filters, severities: [...filters.severities] }).map(
      (item) => item.id,
    ),
    ["bug-one", "bug-two"],
  );
  assert.deepEqual(
    filterList(items, {
      ...filters,
      severities: ["P1", "P2"],
      search: "sav-000001",
      state: "in_progress",
    }).map((item) => item.id),
    ["bug-one"],
  );
  assert.equal(
    filterList(items, { ...defaultFilters(), severities: [] }).length,
    0,
  );
  assert.equal(filterList(items, defaultFilters()).length, 4);
});

test("most recently added orders by creation time across priorities without mutating items or flattening subtasks", () => {
  const older = task("older", {
    priority: "P1",
    updatedAt: "2026-10-01T00:00:00Z",
    leaf: false,
    children: [
      task("older-child", { parentId: "older" }),
      task("newer-child", {
        parentId: "older",
        createdAt: "2026-09-30T00:00:00Z",
      }),
    ],
  });
  const newer = task("newer", {
    kind: "bug",
    priority: "P4",
    createdAt: "2026-09-20T00:00:00Z",
  });
  const tied = task("tied", { createdAt: newer.createdAt });
  const items = backlogItems([tied, newer, older]);
  const original = structuredClone(items);
  const filters = { ...defaultFilters(), sort: "newest" as const };
  const visible = filterList(items, filters);
  assert.deepEqual(visible.map((item) => item.id), ["newer", "tied", "older"]);
  assert.deepEqual(visible[2].children.map((item) => item.id), [
    "newer-child",
    "older-child",
  ]);
  assert.deepEqual(items, original);
  assert.deepEqual(
    filterList(items, defaultFilters()).map((item) => item.id),
    ["older", "tied", "newer"],
  );
  assert.deepEqual(
    filterList(items, { ...filters, ticketClass: "feature" }).map(
      (item) => item.id,
    ),
    ["tied", "older"],
  );
});

test("Backlog sort bookmarks round trip with filters and item links, and invalid sorts fall back to severity", () => {
  const filters = {
    ...defaultFilters(),
    sort: "newest" as const,
    ticketClass: "bug" as const,
    search: "login",
    mine: true,
  };
  const url = listUrl(
    new URL("https://app.test/?item=SAV-000042"),
    "backlog",
    filters,
  );
  assert.equal(url.searchParams.get("sort"), "newest");
  assert.equal(url.searchParams.get("item"), "SAV-000042");
  assert.deepEqual(readListLocation(url), { tab: "backlog", filters });
  const reset = listUrl(url, "backlog", defaultFilters());
  assert.equal(reset.searchParams.has("sort"), false);
  assert.equal(readListLocation(reset).filters.sort, "priority");
  assert.equal(
    readListLocation(new URL("https://app.test/backlog?sort=unknown")).filters.sort,
    "priority",
  );
  for (const tab of ["next-five", "kanban"] as const) {
    assert.equal(listUrl(url, tab, filters).searchParams.has("sort"), false);
    const otherView = listUrl(url, tab, filters);
    otherView.searchParams.set("sort", "newest");
    assert.equal(readListLocation(otherView).filters.sort, "priority");
  }
});

test("matching subtasks retain their ancestors as context without leaking unrelated children", () => {
  const children = [
    task("match", { parentId: "parent", priority: "P1" }),
    task("other", { parentId: "parent", priority: "P4" }),
  ];
  const parent = task("parent", { priority: "P3", leaf: false, children });
  const filtered = filterList([parent], {
    ...defaultFilters(),
    severities: ["P1"],
  });
  assert.equal(filtered[0].filterContext, true);
  assert.equal(filtered[0].leaf, false);
  assert.deepEqual(
    filtered[0].children.map((item) => item.id),
    ["match"],
  );
  assert.equal(parent.children.length, 2);
  assert.equal(
    filterList([parent], { ...defaultFilters(), ticketClass: "bug" }).length,
    0,
  );
});

test("no-action completion has a distinct state filter that survives bookmarks", () => {
  const filters = { ...defaultFilters(), state: "done_no_action_required" as const };
  const items = [
    task("closed", { state: "done_no_action_required" }),
    task("implemented", { state: "done" }),
    task("active"),
  ];
  assert.deepEqual(filterList(items, filters).map((item) => item.id), ["closed"]);
  for (const tab of ["next-five", "backlog", "kanban"] as const) {
    const url = listUrl(new URL("https://app.test/"), tab, filters);
    assert.equal(url.searchParams.get("state"), "done_no_action_required");
    assert.deepEqual(readListLocation(url), { tab, filters });
  }
});

test("filter bookmarks round trip including an empty severity selection and item links", () => {
  for (const severities of [
    [],
    ["P1", "P3"],
    ["P1", "P2", "P3", "P4"],
  ] as const) {
    const filters = {
      ...defaultFilters(),
      ticketClass: "feature" as const,
      severities: [...severities],
      search: "email & login",
      state: "in_qa" as const,
    };
    const url = listUrl(
      new URL("https://app.test/?item=SAV-000042"),
      "backlog",
      filters,
    );
    assert.equal(url.pathname, "/backlog");
    assert.equal(url.searchParams.get("item"), "SAV-000042");
    assert.deepEqual(readListLocation(url), { tab: "backlog", filters });
  }
});

test("old bug URLs become filtered backlog links and Kanban ignores class and severity", () => {
  for (const [path, expected] of [
    ["/bugs/p1-p2", ["P1", "P2"]],
    ["/bugs/p3-p4", ["P3", "P4"]],
    ["/?view=bugs", ["P1", "P2"]],
  ] as const) {
    const current = new URL(path, "https://app.test");
    const parsed = readListLocation(current);
    assert.equal(parsed.tab, "backlog");
    assert.equal(parsed.filters.ticketClass, "bug");
    assert.deepEqual(parsed.filters.severities, expected);
    assert.equal(
      listUrl(current, parsed.tab, parsed.filters).pathname,
      "/backlog",
    );
  }
  const parsed = readListLocation(
    new URL("https://app.test/kanban?class=bugs&severity=P4"),
  );
  assert.equal(parsed.tab, "kanban");
  assert.deepEqual(parsed.filters, defaultFilters());
});

test("My tickets keeps work assigned to the signed-in person as implementor or reviewer, with subtask context", () => {
  const items = [
    task("implementing", { implementorId: "me" }),
    task("reviewing", { kind: "bug", priority: "P2", reviewerId: "me" }),
    task("theirs", { implementorId: "them", reviewerId: "them" }),
    task("parent", {
      leaf: false,
      children: [task("child", { parentId: "parent", reviewerId: "me" })],
    }),
  ];
  const mine = { ...defaultFilters(), mine: true };
  const visible = filterList(items, mine, "me");
  assert.deepEqual(
    visible.map((item) => item.id),
    ["implementing", "reviewing", "parent"],
  );
  assert.equal(visible[2].filterContext, true);
  assert.deepEqual(
    visible[2].children.map((item) => item.id),
    ["child"],
  );
  assert.deepEqual(
    filterList(items, mine, "them").map((item) => item.id),
    ["theirs"],
  );
  assert.equal(filterList(items, mine, null).length, 0);
  assert.equal(filterList(items, mine).length, 0);
  assert.equal(filterList(items, defaultFilters(), "me").length, 4);
  assert.equal(
    filterList(items, { ...mine, ticketClass: "bug" }, "me")
      .map((item) => item.id)
      .join(),
    "reviewing",
  );
  assert.equal(assignedTo(items[0], "me"), true);
  assert.equal(assignedTo(items[1], "me"), true);
  assert.equal(assignedTo(items[2], "me"), false);
  assert.equal(assignedTo(items[0], undefined), false);
});

test("the My tickets flag round trips through every view's URL", () => {
  for (const tab of ["next-five", "backlog", "kanban"] as const) {
    const url = listUrl(new URL("https://app.test/?item=abc"), tab, {
      ...defaultFilters(),
      mine: true,
    });
    assert.equal(url.searchParams.get("mine"), "1");
    assert.equal(url.searchParams.get("item"), "abc");
    assert.deepEqual(readListLocation(url), {
      tab,
      filters: { ...defaultFilters(), mine: true },
    });
    const off = listUrl(url, tab, defaultFilters());
    assert.equal(off.searchParams.has("mine"), false);
    assert.equal(readListLocation(off).filters.mine, false);
  }
});

test("ancestors list a nested item's parents from the root down and stop at gaps or cycles", () => {
  const root = task("root", { leaf: false });
  const middle = task("middle", { parentId: "root", leaf: false });
  const leaf = task("leaf", { parentId: "middle" });
  const orphan = task("orphan", { parentId: "missing" });
  assert.deepEqual(
    ancestors([leaf, middle, root, orphan], leaf).map((item) => item.id),
    ["root", "middle"],
  );
  assert.deepEqual(
    ancestors([leaf, middle, root], middle).map((item) => item.id),
    ["root"],
  );
  assert.deepEqual(ancestors([root], root), []);
  assert.deepEqual(ancestors([orphan], orphan), []);
  const a = task("a", { parentId: "b" }),
    b = task("b", { parentId: "a" });
  assert.deepEqual(
    ancestors([a, b], a).map((item) => item.id),
    ["b"],
  );
});
