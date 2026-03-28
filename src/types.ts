export type TaskStatus = 'todo' | 'in-progress' | 'blocked' | 'review' | 'done' | 'cancelled';
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';
export type GanttGranularity = 'day' | 'week' | 'month' | 'quarter';
export type ViewMode = 'table' | 'gantt' | 'kanban';
export type DueDateFilter = 'any' | 'overdue' | 'this-week' | 'this-month' | 'no-date';
export type TaskType = 'task' | 'milestone' | 'subtask';

export interface Recurrence {
  interval: 'daily' | 'weekly' | 'monthly' | 'yearly';
  every: number;    // e.g. every 2 weeks
  endDate?: string; // YYYY-MM-DD
}

export interface TimeLog {
  date: string;  // YYYY-MM-DD
  hours: number;
  note: string;
}

export interface CustomFieldDef {
  id: string;
  name: string;
  type: 'text' | 'number' | 'date' | 'select' | 'multiselect' | 'person' | 'checkbox' | 'url';
  options?: string[]; // for select / multiselect
  icon?: string;      // emoji or lucide icon name
}

export interface Task {
  id: string;
  title: string;
  description: string;
  type: TaskType;          // 'task' or 'milestone' (zero-duration)
  status: TaskStatus;
  priority: TaskPriority;
  start: string;           // YYYY-MM-DD, empty string = unset
  due: string;             // YYYY-MM-DD, empty string = unset
  progress: number;        // 0–100
  assignees: string[];
  tags: string[];
  subtasks: Task[];
  dependencies: string[];  // task IDs
  recurrence?: Recurrence;
  timeEstimate?: number;   // hours
  timeLogs?: TimeLog[];
  customFields: Record<string, unknown>;
  collapsed: boolean;
  createdAt: string;
  updatedAt: string;
  filePath?: string;   // vault path to this task's .md file
}

export interface Project {
  id: string;
  title: string;
  description: string;
  color: string;   // hex
  icon: string;    // emoji
  tasks: Task[];
  customFields: CustomFieldDef[];
  teamMembers: string[];
  createdAt: string;
  updatedAt: string;
  filePath: string; // resolved vault path
  savedViews: SavedView[];
}

export interface FilterState {
  text: string;
  statuses: TaskStatus[];
  priorities: TaskPriority[];
  assignees: string[];
  tags: string[];
  dueDateFilter: DueDateFilter;
}

export interface SavedView {
  id: string;
  name: string;
  filter: FilterState;
  sortKey: string;
  sortDir: 'asc' | 'desc';
}

export interface StatusConfig {
  id: TaskStatus;
  label: string;
  color: string;
  icon: string;
}

export interface PriorityConfig {
  id: TaskPriority;
  label: string;
  color: string;
  icon: string;
}

export interface PMSettings {
  projectsFolder: string;
  defaultView: ViewMode;
  ganttGranularity: GanttGranularity;
  statuses: StatusConfig[];
  priorities: PriorityConfig[];
  globalTeamMembers: string[];
  notificationsEnabled: boolean;
  notificationLeadDays: number;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_STATUSES: StatusConfig[] = [
  { id: 'todo',        label: 'To Do',       color: '#94a3b8', icon: '○' },
  { id: 'in-progress', label: 'In Progress', color: '#6366f1', icon: '◑' },
  { id: 'blocked',     label: 'Blocked',     color: '#ef4444', icon: '⊘' },
  { id: 'review',      label: 'In Review',   color: '#f59e0b', icon: '◎' },
  { id: 'done',        label: 'Done',        color: '#22c55e', icon: '●' },
  { id: 'cancelled',   label: 'Cancelled',   color: '#6b7280', icon: '✕' },
];

export const DEFAULT_PRIORITIES: PriorityConfig[] = [
  { id: 'critical', label: 'Critical', color: '#dc2626', icon: '🔴' },
  { id: 'high',     label: 'High',     color: '#ea580c', icon: '🟠' },
  { id: 'medium',   label: 'Medium',   color: '#ca8a04', icon: '🟡' },
  { id: 'low',      label: 'Low',      color: '#16a34a', icon: '🟢' },
];

export const DEFAULT_SETTINGS: PMSettings = {
  projectsFolder: 'Projects',
  defaultView: 'table',
  ganttGranularity: 'week',
  statuses: DEFAULT_STATUSES,
  priorities: DEFAULT_PRIORITIES,
  globalTeamMembers: [],
  notificationsEnabled: true,
  notificationLeadDays: 2,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function makeId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function makeTask(overrides: Partial<Task> = {}): Task {
  const now = new Date().toISOString();
  return {
    id: makeId(),
    title: 'New Task',
    description: '',
    type: 'task',
    status: 'todo',
    priority: 'medium',
    start: new Date().toISOString().slice(0, 10),
    due: '',
    progress: 0,
    assignees: [],
    tags: [],
    subtasks: [],
    dependencies: [],
    customFields: {},
    collapsed: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function makeProject(title: string, filePath: string): Project {
  const now = new Date().toISOString();
  return {
    id: makeId(),
    title,
    description: '',
    color: '#6366f1',
    icon: '📋',
    tasks: [],
    customFields: [],
    teamMembers: [],
    createdAt: now,
    updatedAt: now,
    filePath,
    savedViews: [],
  };
}

export function makeDefaultFilter(): FilterState {
  return {
    text: '',
    statuses: [],
    priorities: [],
    assignees: [],
    tags: [],
    dueDateFilter: 'any',
  };
}

/** Flatten a task tree into a list, preserving depth info */
export interface FlatTask {
  task: Task;
  depth: number;
  parentId: string | null;
  visible: boolean;
}

export function flattenTasks(
  tasks: Task[],
  depth = 0,
  parentId: string | null = null,
  ancestorCollapsed = false,
): FlatTask[] {
  const result: FlatTask[] = [];
  for (const task of tasks) {
    const visible = !ancestorCollapsed;
    result.push({ task, depth, parentId, visible });
    if (task.subtasks.length > 0) {
      result.push(
        ...flattenTasks(task.subtasks, depth + 1, task.id, ancestorCollapsed || task.collapsed),
      );
    }
  }
  return result;
}

/** Find a task anywhere in the tree by id */
export function findTask(tasks: Task[], id: string): Task | null {
  for (const t of tasks) {
    if (t.id === id) return t;
    const found = findTask(t.subtasks, id);
    if (found) return found;
  }
  return null;
}

/** Mutate task tree: update a task by id */
export function updateTaskInTree(tasks: Task[], id: string, patch: Partial<Task>): boolean {
  for (const t of tasks) {
    if (t.id === id) {
      Object.assign(t, patch, { updatedAt: new Date().toISOString() });
      return true;
    }
    if (updateTaskInTree(t.subtasks, id, patch)) return true;
  }
  return false;
}

/** Mutate task tree: delete a task by id */
export function deleteTaskFromTree(tasks: Task[], id: string): boolean {
  for (let i = 0; i < tasks.length; i++) {
    if (tasks[i].id === id) {
      tasks.splice(i, 1);
      return true;
    }
    if (deleteTaskFromTree(tasks[i].subtasks, id)) return true;
  }
  return false;
}

/** Add a subtask under a parent; or top-level if parentId is null */
export function addTaskToTree(tasks: Task[], newTask: Task, parentId: string | null): void {
  if (!parentId) {
    tasks.push(newTask);
    return;
  }
  const parent = findTask(tasks, parentId);
  if (parent) parent.subtasks.push(newTask);
  else tasks.push(newTask);
}

/** Move a task before or after another task in the tree (same level) */
export function moveTaskInTree(
  tasks: Task[],
  taskId: string,
  targetId: string,
  position: 'before' | 'after',
): boolean {
  // Try at this level first
  const taskIdx = tasks.findIndex(t => t.id === taskId);
  const targetIdx = tasks.findIndex(t => t.id === targetId);
  if (taskIdx !== -1 && targetIdx !== -1) {
    const [task] = tasks.splice(taskIdx, 1);
    const insertIdx = tasks.findIndex(t => t.id === targetId);
    tasks.splice(position === 'before' ? insertIdx : insertIdx + 1, 0, task);
    return true;
  }
  // Recurse into subtasks
  for (const t of tasks) {
    if (moveTaskInTree(t.subtasks, taskId, targetId, position)) return true;
  }
  return false;
}

/** Sum all logged hours for a task */
export function totalLoggedHours(task: Task): number {
  if (!task.timeLogs?.length) return 0;
  return task.timeLogs.reduce((sum, log) => sum + log.hours, 0);
}
