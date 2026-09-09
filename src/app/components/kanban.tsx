"use client";
import { useEffect, useState } from "react";
import { kanbanColumns } from "../../lib/kanban";
import {
  STATES,
  STATE_LABELS,
  userName,
  type Task,
  type TaskState,
  type User,
} from "../../lib/project-types";
import { Avatar, dateLabel } from "./project-ui";

export function Kanban({
  items,
  users,
  canEdit,
  busy,
  search,
  stateFilter,
  open,
  patch,
}: {
  items: Task[];
  users: User[];
  canEdit: boolean;
  busy: boolean;
  search: string;
  stateFilter: string;
  open: (id: string) => void;
  patch: (data: object) => Promise<void>;
}) {
  const [, refreshClock] = useState(0);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<TaskState | null>(null);
  useEffect(() => {
    const timer = setInterval(() => refreshClock((tick) => tick + 1), 60_000);
    return () => clearInterval(timer);
  }, []);
  const columns = kanbanColumns(items);
  const matches = (task: Task) =>
    (!stateFilter || task.state === stateFilter) &&
    (!search ||
      `${task.publicId || ""} ${task.title} ${task.description}`
        .toLowerCase()
        .includes(search.toLowerCase()));
  return (
    <>
      <p className="kanban-hint">
        Active work: Next 5 features and P1/P2 bugs. Done: completed features
        and P1/P2 bugs from the last 4 weeks.
        {canEdit && " Move a card between columns, or use its state menu."}
      </p>
      <div
        className="kanban-scroll"
        role="region"
        aria-label="Kanban board"
        tabIndex={0}
      >
        <div className="kanban-board">
          {columns.map((column) => {
            const cards = column.tasks.filter(matches);
            return (
              <section
                key={column.state}
                aria-label={`${column.label} column`}
                className={`kanban-column kanban-${column.state}${over === column.state ? " drag-over" : ""}`}
                onDragOver={(event) => {
                  if (dragging && canEdit && !busy) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setOver(column.state);
                  }
                }}
                onDragLeave={(event) => {
                  if (
                    !event.currentTarget.contains(event.relatedTarget as Node)
                  )
                    setOver(null);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setOver(null);
                  setDragging(null);
                  const id = event.dataTransfer.getData("text/plain");
                  const task = items.find((item) => item.id === id);
                  if (
                    canEdit &&
                    !busy &&
                    task?.leaf &&
                    task.id === dragging &&
                    task.state !== column.state
                  )
                    void patch({ id, state: column.state });
                }}
              >
                <div className="kanban-heading">
                  <h2>{column.label}</h2>
                  <span className="count">{cards.length}</span>
                </div>
                {column.state === "done" && (
                  <p className="kanban-window">Completed in the last 4 weeks</p>
                )}
                <div className="kanban-cards">
                  {cards.map((task) => {
                    const childCount = items.filter(
                      (item) => item.parentId === task.id,
                    ).length;
                    const implementor = users.find(
                      (user) => user.id === task.implementorId,
                    );
                    const reviewer = users.find(
                      (user) => user.id === task.reviewerId,
                    );
                    return (
                      <article
                        key={task.id}
                        className={`kanban-card${dragging === task.id ? " dragging" : ""}`}
                        aria-label={task.title}
                        draggable={canEdit && task.leaf && !busy}
                        onDragStart={(event) => {
                          if (!canEdit || !task.leaf || busy) {
                            event.preventDefault();
                            return;
                          }
                          event.dataTransfer.setData("text/plain", task.id);
                          event.dataTransfer.effectAllowed = "move";
                          setDragging(task.id);
                        }}
                        onDragEnd={() => {
                          setDragging(null);
                          setOver(null);
                        }}
                      >
                        <div className="kanban-card-meta">
                          <span
                            className={`priority priority-${task.priority}`}
                          >
                            {task.priority}
                          </span>
                          {task.kind === "feature" ? (
                            <span className="feature-badge">
                              {task.sectionId === "next-five"
                                ? `#${task.position + 1} · Next 5`
                                : "Feature"}
                            </span>
                          ) : (
                            <span className="item-id">{task.publicId}</span>
                          )}
                        </div>
                        <button
                          className="kanban-card-title"
                          onClick={() => open(task.id)}
                        >
                          {task.title}
                        </button>
                        {task.description && (
                          <p className="kanban-description">
                            {task.description}
                          </p>
                        )}
                        {!task.leaf && (
                          <p className="kanban-computed">
                            {childCount}{" "}
                            {childCount === 1 ? "subtask" : "subtasks"}
                            {" · state follows subtasks"}
                          </p>
                        )}
                        <div className="kanban-people">
                          {implementor && (
                            <span
                              title={`Implementor: ${userName(implementor)}`}
                            >
                              <Avatar user={implementor} />
                              <span>{userName(implementor)}</span>
                            </span>
                          )}
                          {reviewer && (
                            <span title={`Reviewer: ${userName(reviewer)}`}>
                              <Avatar user={reviewer} />
                              <small>Review</small>
                            </span>
                          )}
                        </div>
                        {task.state === "done" && task.completedAt && (
                          <p className="kanban-completed">
                            Completed {dateLabel(task.completedAt)}
                          </p>
                        )}
                        {canEdit && task.leaf && (
                          <select
                            aria-label={`State for ${task.title}`}
                            value={task.state}
                            disabled={busy}
                            onChange={(event) =>
                              patch({ id: task.id, state: event.target.value })
                            }
                          >
                            {STATES.map((state) => (
                              <option key={state} value={state}>
                                {STATE_LABELS[state]}
                              </option>
                            ))}
                          </select>
                        )}
                      </article>
                    );
                  })}
                  {!cards.length && (
                    <p className="kanban-empty">
                      {search || stateFilter ? "No matching items" : "No items"}
                    </p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}
