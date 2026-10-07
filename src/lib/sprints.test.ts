import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  availableSprints, currentSprint, isSprintId, matchingSprints,
  shiftSprint, sprintAssignmentOptions, sprintForDate, sprintItems,
} from "./sprints.ts";
import { allTasks, itemDetail, projectDb } from "./project-store.ts";
import { convertItem, createItem, deleteItem, updateItem } from "./project-commands.ts";
import { defaultFilters, listUrl, readListLocation } from "./list-view.ts";
import type { User } from "./project-types.ts";

const actor: User = { id: "editor", email: "editor@example.test", role: "edit" };
const current = "2026-10-05-to-10-11";
const next = "2026-10-12-to-10-18";

test("sprints use Monday–Sunday calendar dates across month, year, leap-day, and DST boundaries", () => {
  for (const [date, expected] of [
    ["2026-10-05", current], ["2026-10-07", current], ["2026-10-11", current],
    ["2026-10-12", next], ["2026-09-30", "2026-09-28-to-10-04"],
    ["2027-01-01", "2026-12-28-to-01-03"],
    ["2028-02-29", "2028-02-28-to-03-05"],
    ["2026-03-08", "2026-03-02-to-03-08"],
    ["2026-11-01", "2026-10-26-to-11-01"],
  ]) {
    assert.equal(sprintForDate(date), expected);
    assert.equal(isSprintId(expected), true);
  }
  for (const invalid of ["2026-02-29", "2026-13-01", "2026-1-01", "not a date"])
    assert.equal(sprintForDate(invalid), null);
  assert.equal(isSprintId("2026-10-06-to-10-12"), false);
  assert.equal(isSprintId("2026-10-05-to-10-12"), false);
  assert.equal(isSprintId(123), false);
  assert.equal(shiftSprint(current, 1), next);
  assert.equal(shiftSprint("2026-12-28-to-01-03", 1), "2027-01-04-to-01-10");
  // UTC is already Monday, but it is still Sunday in Edmonton.
  assert.equal(currentSprint(new Date("2026-10-12T05:59:59Z")), current);
  assert.equal(currentSprint(new Date("2026-10-12T06:00:00Z")), next);
});

test("assignments support roots of either kind, persist in events, and survive moves and conversion", () => {
  const db = projectDb(":memory:");
  try {
    const root = createItem(db, actor, { title: "Root", sprintId: current });
    const bug = createItem(db, actor, { title: "Bug", kind: "bug", sprintId: next });
    const child = createItem(db, actor, { title: "Child", parentId: root.id });
    assert.equal(child.sprintId, null);
    assert.equal(itemDetail(db, root.id)!.task.sprintId, current);
    assert.equal(updateItem(db, actor, { id: root.id, sectionId: "next-five" }).sprintId, current);
    assert.equal(convertItem(db, actor, { id: root.id, kind: "bug" }).sprintId, current);
    assert.equal(convertItem(db, actor, { id: bug.id, kind: "feature" }).sprintId, next);
    assert.equal(updateItem(db, actor, { id: root.id, sprintId: next }).sprintId, next);
    assert.equal(updateItem(db, actor, { id: root.id, title: "Renamed" }).sprintId, next);
    assert.equal(updateItem(db, actor, { id: root.id, sprintId: null }).sprintId, null);
    const history = (db.prepare(
      "SELECT data FROM events WHERE type='item_updated' ORDER BY rowid",
    ).all() as { data: string }[]).map((row) => JSON.parse(row.data).task.sprintId);
    assert.deepEqual(history, [current, next, next, null]);
  } finally { db.close(); }
});

test("invalid sprints, subtask assignment, and reader writes are rejected without partial edits", () => {
  const db = projectDb(":memory:");
  try {
    const root = createItem(db, actor, { title: "Root", sprintId: current });
    const child = createItem(db, actor, { title: "Child", parentId: root.id });
    for (const sprintId of ["2026-10-06-to-10-12", "2026-10-05-to-10-99", 42, {}, []]) {
      assert.throws(() => createItem(db, actor, { title: "Bad", sprintId }), /Choose a Monday/);
      assert.throws(() => updateItem(db, actor, { id: root.id, title: "Bad", sprintId }), /Choose a Monday/);
    }
    assert.throws(() => createItem(db, actor, {
      title: "Bad child", parentId: root.id, sprintId: current,
    }), /Only root items/);
    assert.throws(() => updateItem(db, actor, { id: child.id, sprintId: current }), /Only root items/);
    assert.throws(() => updateItem(db, { ...actor, role: "read" }, {
      id: root.id, sprintId: next,
    }), /Edit access required/);
    assert.equal(allTasks(db).length, 2);
    assert.equal(itemDetail(db, root.id)!.task.title, "Root");
    assert.equal(itemDetail(db, root.id)!.task.sprintId, current);
  } finally { db.close(); }
});

test("Sprint view offers occupied weeks plus the current week and displays only assigned roots", () => {
  const db = projectDb(":memory:");
  try {
    const root = createItem(db, actor, { title: "Root", sprintId: next });
    const child = createItem(db, actor, { title: "Child", parentId: root.id });
    const bug = createItem(db, actor, { title: "Done bug", kind: "bug", state: "done", sprintId: next });
    createItem(db, actor, { title: "Unassigned" });
    createItem(db, actor, { title: "Next 5", sectionId: "next-five", sprintId: current });
    const items = allTasks(db);
    assert.deepEqual(availableSprints(items, current), [next, current]);
    const visible = sprintItems(items, next);
    assert.deepEqual(new Set(visible.map((item) => item.id)), new Set([root.id, bug.id]));
    assert.ok(visible.every((item) => item.children.length === 0 && !item.parentId));
    assert.equal(items.find((item) => item.id === root.id)!.children[0].id, child.id);
    assert.equal(sprintItems(items, current).length, 1);
    updateItem(db, actor, { id: root.id, sprintId: null });
    deleteItem(db, actor, bug.id);
    assert.deepEqual(availableSprints(allTasks(db), current), [current]);
    assert.deepEqual(availableSprints([], current), [current]);
    assert.deepEqual(sprintItems([], current), []);
    // Even malformed legacy child assignments cannot introduce selectable weeks.
    assert.deepEqual(availableSprints([
      { ...items.find((item) => item.id === child.id)!, sprintId: next },
    ], current), [current]);
  } finally { db.close(); }
});

test("sprint searches generate any week from a date or full identifier", () => {
  const choices = sprintAssignmentOptions([], current);
  assert.equal(choices[0], current);
  assert.ok(choices.includes(next));
  assert.ok(choices.includes("2026-09-28-to-10-04"));
  assert.deepEqual(matchingSprints(choices, "2030-05-15"), ["2030-05-13-to-05-19"]);
  assert.deepEqual(matchingSprints(choices, "2030-05-13-to-05-19"), ["2030-05-13-to-05-19"]);
  assert.deepEqual(matchingSprints(choices, "2026-10-05"), [current]);
  assert.deepEqual(matchingSprints(choices, "2026-02-30"), []);
});

test("Sprint URLs default to the current week and retain explicit selections and item links", () => {
  assert.deepEqual(readListLocation(new URL("https://app.test/sprint")), {
    tab: "sprint", filters: defaultFilters(),
  });
  const filters = { ...defaultFilters(), sprint: next };
  const url = listUrl(new URL("https://app.test/?item=abc"), "sprint", filters);
  assert.equal(url.pathname, "/sprint");
  assert.equal(url.searchParams.get("item"), "abc");
  assert.equal(url.searchParams.get("sprint"), next);
  assert.deepEqual(readListLocation(url), { tab: "sprint", filters });
  assert.equal(listUrl(url, "backlog", filters).searchParams.has("sprint"), false);
  assert.equal(readListLocation(new URL("https://app.test/sprint?sprint=invalid")).filters.sprint, "");
});

test("existing installations gain sprint storage once without changing item dates or history", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "n5-sprint-"));
  const file = path.join(dir, "site.db");
  let db = projectDb(file);
  try {
    const root = createItem(db, actor, { title: "Existing" });
    db.exec("ALTER TABLE tasks DROP COLUMN sprint_id; DELETE FROM project_migrations WHERE version=6");
    db.close();
    db = projectDb(file);
    assert.equal(itemDetail(db, root.id)!.task.sprintId, null);
    assert.equal(itemDetail(db, root.id)!.task.updatedAt, root.updatedAt);
    updateItem(db, actor, { id: root.id, sprintId: current });
    const count = db.prepare("SELECT COUNT(*) n FROM events").get();
    db.close();
    db = projectDb(file);
    assert.equal(itemDetail(db, root.id)!.task.sprintId, current);
    assert.deepEqual(db.prepare("SELECT COUNT(*) n FROM events").get(), count);
  } finally { db.close(); fs.rmSync(dir, { recursive: true }); }
});
