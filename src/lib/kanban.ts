import {
  isDoneState,
  STATES,
  STATE_LABELS,
  type Task,
  type TaskState,
} from "./project-types.ts";
export const DONE_WINDOW_MS = 28 * 24 * 60 * 60 * 1000;
export type KanbanColumn = { state: TaskState; label: string; tasks: Task[] };

export function kanbanColumns(items: Task[], now = Date.now()): KanbanColumn[] {
  const cutoff = now - DONE_WINDOW_MS;
  const visible = items.filter((task) => {
    if (task.parentId) return false;
    if (task.kind === "bug" && task.priority !== "P1" && task.priority !== "P2")
      return false;
    if (isDoneState(task.state)) {
      // Finished features remain visible even after moving back to the backlog
      // to free a priority slot. Old work remains accessible in the list views.
      const completed = task.completedAt ? Date.parse(task.completedAt) : NaN;
      return (
        Number.isFinite(completed) && completed >= cutoff && completed <= now
      );
    }
    return task.kind === "bug" || task.sectionId === "next-five";
  });
  return STATES.map((state) => ({
    state,
    label: STATE_LABELS[state],
    tasks: visible
      .filter((task) => task.state === state)
      .sort((a, b) => {
        if (isDoneState(state))
          return (
            (b.completedAt || "").localeCompare(a.completedAt || "") ||
            a.id.localeCompare(b.id)
          );
        if (a.kind !== b.kind) return a.kind === "feature" ? -1 : 1;
        return a.kind === "feature"
          ? a.position - b.position
          : (a.priority || "P4").localeCompare(b.priority || "P4") ||
              b.createdAt.localeCompare(a.createdAt) ||
              a.id.localeCompare(b.id);
      }),
  }));
}
