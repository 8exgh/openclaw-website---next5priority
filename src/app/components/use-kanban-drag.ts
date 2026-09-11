"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from "react";
import type { Task, TaskState } from "../../lib/project-types";

type DragSession = {
  id: string;
  pointerId: number;
  capture: HTMLElement;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
};

export function useKanbanDrag({
  items,
  canEdit,
  busy,
  patch,
}: {
  items: Task[];
  canEdit: boolean;
  busy: boolean;
  patch: (data: object) => Promise<void>;
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  const session = useRef<DragSession | null>(null);
  const frame = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const [over, setOver] = useState<TaskState | null>(null);

  const columnAt = (x: number, y: number) => {
    const column = document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>("[data-kanban-state]");
    return column && boardRef.current?.contains(column)
      ? (column.dataset.kanbanState as TaskState)
      : null;
  };
  const reset = useCallback(() => {
    const current = session.current;
    session.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (current?.capture.hasPointerCapture(current.pointerId))
      current.capture.releasePointerCapture(current.pointerId);
    setDragging(null);
    setOver(null);
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") reset();
    };
    window.addEventListener("keydown", escape);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", escape);
      window.removeEventListener("blur", reset);
      reset();
    };
  }, [reset]);
  useEffect(() => {
    if (busy || !canEdit) reset();
  }, [busy, canEdit, reset]);

  function scroll() {
    const current = session.current;
    const board = boardRef.current;
    if (!current?.active || !board) return;
    const bounds = board.getBoundingClientRect();
    if (current.y >= bounds.top && current.y <= bounds.bottom) {
      const direction =
        current.x < bounds.left + 60
          ? -1
          : current.x > bounds.right - 60
            ? 1
            : 0;
      if (direction) {
        board.scrollLeft += direction * 12;
        setOver(columnAt(current.x, current.y));
      }
    }
    frame.current = requestAnimationFrame(scroll);
  }
  function start(event: PointerEvent<HTMLElement>, task: Task) {
    if (
      !canEdit ||
      busy ||
      event.button !== 0 ||
      !event.isPrimary ||
      session.current
    )
      return;
    const capture = event.target as HTMLElement;
    if (capture.closest("select, input, textarea, a")) return;
    suppressClick.current = false;
    session.current = {
      id: task.id,
      pointerId: event.pointerId,
      capture,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      active: false,
    };
    capture.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLElement>) {
    const current = session.current;
    if (!current || event.pointerId !== current.pointerId) return;
    current.x = event.clientX;
    current.y = event.clientY;
    if (!current.active) {
      if (
        Math.hypot(current.x - current.startX, current.y - current.startY) < 6
      )
        return;
      current.active = true;
      frame.current = requestAnimationFrame(scroll);
    }
    event.preventDefault();
    setDragging({ id: current.id, x: current.x, y: current.y });
    setOver(columnAt(current.x, current.y));
  }
  function finish(event: PointerEvent<HTMLElement>) {
    const current = session.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const state = current.active
      ? columnAt(event.clientX, event.clientY)
      : null;
    const task = items.find((item) => item.id === current.id);
    if (current.active) {
      event.preventDefault();
      suppressClick.current = true;
      setTimeout(() => {
        suppressClick.current = false;
      }, 0);
    }
    // Release the capture and finish the gesture before the save moves the card
    // to a new column. The next drag always starts with a fresh session.
    reset();
    if (canEdit && !busy && state && task && task.state !== state)
      void patch({ id: task.id, state });
  }
  function click(event: MouseEvent<HTMLElement>) {
    if (suppressClick.current) {
      event.preventDefault();
      event.stopPropagation();
      suppressClick.current = false;
    }
  }
  return { boardRef, dragging, over, start, move, finish, reset, click };
}
