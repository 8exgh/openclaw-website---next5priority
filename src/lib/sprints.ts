import { site } from "./config.ts";
import { PRIORITIES, type Task } from "./project-types.ts";

const DAY = 24 * 60 * 60 * 1000;
function calendarDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? date
    : null;
}

/** Calendar arithmetic uses UTC to keep seven-day weeks intact across DST. */
export function sprintForDate(value: string): string | null {
  const date = calendarDate(value);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  const start = date.toISOString().slice(0, 10);
  const end = new Date(date.getTime() + 6 * DAY).toISOString().slice(5, 10);
  return `${start}-to-${end}`;
}

export function isSprintId(value: unknown): value is string {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}-to-\d{2}-\d{2}$/.test(value) &&
    sprintForDate(value.slice(0, 10)) === value;
}

export function currentSprint(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: site.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (name: string) => parts.find((value) => value.type === name)!.value;
  return sprintForDate(`${part("year")}-${part("month")}-${part("day")}`)!;
}

export function shiftSprint(sprint: string, weeks: number): string {
  const start = calendarDate(sprint.slice(0, 10))!;
  start.setUTCDate(start.getUTCDate() + weeks * 7);
  return sprintForDate(start.toISOString().slice(0, 10))!;
}

/** The current week is selectable even when empty; other weeks need root work. */
export function availableSprints(items: Task[], current: string): string[] {
  return [...new Set([
    current,
    ...items.flatMap((item) =>
      !item.parentId && isSprintId(item.sprintId) ? [item.sprintId] : [],
    ),
  ])].sort((a, b) => b.localeCompare(a));
}

export function sprintAssignmentOptions(items: Task[], current: string): string[] {
  return [...new Set([
    current,
    ...Array.from({ length: 12 }, (_, index) => shiftSprint(current, index + 1)),
    ...Array.from({ length: 4 }, (_, index) => shiftSprint(current, -index - 1)),
    ...availableSprints(items, current),
  ])];
}

export function matchingSprints(options: string[], query: string): string[] {
  const needle = query.trim();
  const exact = isSprintId(needle) ? needle : sprintForDate(needle);
  return [...new Set([
    ...(exact ? [exact] : []),
    ...options.filter((option) => option.includes(needle)),
  ])];
}

export function sprintItems(items: Task[], sprint: string): Task[] {
  return items
    .filter((item) => !item.parentId && item.sprintId === sprint)
    .map((item) => ({ ...item, children: [], leaf: true }))
    .sort((a, b) =>
      PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) ||
      b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
    );
}
