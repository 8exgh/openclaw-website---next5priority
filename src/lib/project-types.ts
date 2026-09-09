export type Role = "read" | "edit" | "admin";
export const STATES = [
  "needs_review",
  "ready_for_development",
  "in_progress",
  "in_qa",
  "in_review",
  "done",
] as const;
export type TaskState = (typeof STATES)[number];
export const STATE_LABELS: Record<TaskState, string> = {
  needs_review: "Needs review",
  ready_for_development: "Ready for development",
  in_progress: "In progress",
  in_qa: "In QA",
  in_review: "In review",
  done: "Done",
};
export const PRIORITIES = ["P1", "P2", "P3", "P4"] as const;
export type Priority = (typeof PRIORITIES)[number];
export type ItemKind = "feature" | "bug";
export type User = {
  id: string;
  email: string;
  role: Role;
  name?: string;
  avatarId?: string | null;
};
export type Attachment = {
  id: string;
  eventId: string;
  taskId: string | null;
  commentId: string | null;
  userId: string;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
};
export type Task = {
  id: string;
  publicId: string | null;
  kind: ItemKind;
  sectionId: string;
  parentId: string | null;
  title: string;
  description: string;
  state: TaskState;
  ownState: TaskState;
  priority: Priority | null;
  implementorId: string | null;
  reviewerId: string | null;
  createdBy: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  leaf: boolean;
  children: Task[];
};
export type TaskRecord = Omit<Task, "leaf" | "children">;
export type Section = {
  id: string;
  name: string;
  position: number;
  tasks: Task[];
};
export type Comment = {
  id: string;
  taskId: string;
  userId: string;
  body: string;
  createdAt: string;
  attachments: Attachment[];
};
export type ItemLink = {
  id: string;
  sourceId: string;
  targetId: string;
  relation: "related_to" | "caused_by";
  other: Task;
  incoming: boolean;
};
export type ItemDetail = {
  task: Task;
  attachments: Attachment[];
  comments: Comment[];
  followers: User[];
  links: ItemLink[];
};
export const SECTIONS = [
  { id: "next-five", name: "Next 5 features", position: 0 },
  { id: "feature-backlog", name: "Feature backlog", position: 1 },
  { id: "bugs-high", name: "Bugs · P1 / P2", position: 2 },
  { id: "bugs-low", name: "Bugs · P3 / P4", position: 3 },
];
export function initials(user: User): string {
  const words = (user.name?.trim() || user.email.split("@")[0])
    .split(/[\s._-]+/)
    .filter(Boolean);
  return (
    words.length > 1
      ? words[0][0] + words.at(-1)![0]
      : (words[0] || "??").slice(0, 2)
  )
    .toUpperCase()
    .padEnd(2, "?");
}
export function userName(user: User): string {
  return user.name?.trim() || user.email;
}
