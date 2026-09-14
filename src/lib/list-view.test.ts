import assert from "node:assert/strict";
import test from "node:test";
import {
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
    title: id,
    description: "",
    state: "needs_review",
    ownState: "needs_review",
    priority: "P3",
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
