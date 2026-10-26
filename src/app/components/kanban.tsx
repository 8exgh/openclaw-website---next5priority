"use client";
import { useEffect, useState } from "react";
import { kanbanColumns } from "../../lib/kanban";
import { ancestors, assignedTo } from "../../lib/list-view";
import { isDoneState, userName, type Task, type User } from "../../lib/project-types";
import { plainText } from "../../lib/rich-text";
import { Avatar, dateLabel, EffortBadge, StateControl } from "./project-ui";
import { useKanbanDrag } from "./use-kanban-drag";

export function Kanban({
  items,
  users,
  canEdit,
  busy,
  search,
  stateFilter,
  mine,
  userId,
  open,
  patch,
}: {
  items: Task[];
  users: User[];
  canEdit: boolean;
  busy: boolean;
  search: string;
  stateFilter: string;
  mine: boolean;
  userId: string;
  open: (id: string) => void;
  patch: (data: object) => Promise<void>;
}) {
  const [, refreshClock] = useState(0);
  const drag = useKanbanDrag({ items, canEdit, busy, patch });
  useEffect(() => {
    const timer = setInterval(() => refreshClock((tick) => tick + 1), 60_000);
    return () => clearInterval(timer);
  }, []);
  const columns = kanbanColumns(items);
  // Cards are top-level items; a card also counts as mine when one of its
  // subtasks is assigned to me, mirroring the list view's context rows.
  const viaSubtask = (task: Task) =>
    !assignedTo(task, userId) &&
    items.some(
      (item) =>
        assignedTo(item, userId) &&
        ancestors(items, item).some((parent) => parent.id === task.id),
    );
  const matches = (task: Task) =>
    (!mine || assignedTo(task, userId) || viaSubtask(task)) &&
    (!stateFilter || task.state === stateFilter) &&
    (!search ||
      `${task.publicId || ""} ${task.title} ${task.description}`
        .toLowerCase()
        .includes(search.toLowerCase()));
  return (
    <>
      <p className="kanban-hint">
        Active work: Next 5 features and P1/P2 bugs. Both Done columns: completed features
        and P1/P2 bugs from the last 4 weeks.
        {canEdit && " Move a card between columns, or use its state menu."}
      </p>
      <div
        ref={drag.boardRef}
        className={`kanban-scroll${drag.dragging ? " is-dragging" : ""}`}
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
                data-kanban-state={column.state}
                className={`kanban-column kanban-${column.state}${drag.over === column.state ? " drag-over" : ""}`}
              >
                <div className="kanban-heading">
                  <h2>{column.label}</h2>
                  <span className="count">{cards.length}</span>
                </div>
                {isDoneState(column.state) && (
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
                        className={`kanban-card${canEdit ? " can-drag" : ""}${drag.dragging?.id === task.id ? " dragging" : ""}`}
                        aria-label={task.title}
                        onDragStart={(event) => event.preventDefault()}
                        onPointerDown={(event) => drag.start(event, task)}
                        onPointerMove={drag.move}
                        onPointerUp={drag.finish}
                        onPointerCancel={drag.reset}
                        onLostPointerCapture={drag.reset}
                        onClickCapture={drag.click}
                      >
                        <div className="kanban-card-meta">
                          <span
                            className={`priority priority-${task.priority}`}
                          >
                            {task.priority}
                          </span>
                          <EffortBadge effort={task.effort} />
                          {task.kind === "feature" ? (
                            <span className="feature-badge">
                              {task.sectionId === "next-five"
                                ? `#${task.position + 1} · Next 5`
                                : "Feature"}
                            </span>
                          ) : (
                            <span className="item-id">{task.publicId}</span>
                          )}
                          {canEdit && (
                            <span
                              className="kanban-drag-handle"
                              title="Drag to change state"
                              aria-hidden="true"
                            >
                              ⠿
                            </span>
                          )}
                        </div>
                        <button
                          className="kanban-card-title"
                          onClick={() => open(task.id)}
                        >
                          {task.title}
                        </button>
                        {plainText(task.description) && (
                          <p className="kanban-description">
                            {plainText(task.description)}
                          </p>
                        )}
                        {!task.leaf && (
                          <p className="kanban-computed">
                            {childCount}{" "}
                            {childCount === 1 ? "subtask" : "subtasks"}
                            {mine && viaSubtask(task) && " · Matching subtask"}
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
                        {isDoneState(task.state) && task.completedAt && (
                          <p className="kanban-completed">
                            Completed {dateLabel(task.completedAt)}
                          </p>
                        )}
                        <StateControl
                          task={task}
                          canEdit={canEdit}
                          disabled={busy}
                          onChange={(state) => patch({ id: task.id, state })}
                        />
                      </article>
                    );
                  })}
                  {!cards.length && (
                    <p className="kanban-empty">
                      {search || stateFilter || mine
                        ? "No matching items"
                        : "No items"}
                    </p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
      {drag.dragging && (
        <div
          className="kanban-drag-preview"
          aria-hidden="true"
          style={{ left: drag.dragging.x + 12, top: drag.dragging.y + 12 }}
        >
          {items.find((item) => item.id === drag.dragging!.id)?.title}
        </div>
      )}
    </>
  );
}
