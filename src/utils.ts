import type { Task } from './types';

/** Deterministic HSL color from a string (e.g. assignee name) */
export function stringToColor(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360}, 55%, 45%)`;
}

/** Short date: "Mar 28" */
export function formatDateShort(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Long date: "Mar 28, '26" */
export function formatDateLong(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
}

/** Today at midnight (00:00:00.000) */
export function todayMidnight(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Is a task overdue? (past due, not done/cancelled) */
export function isTaskOverdue(task: Task): boolean {
  if (!task.due) return false;
  const dueDate = new Date(task.due);
  return dueDate < todayMidnight() && task.status !== 'done' && task.status !== 'cancelled';
}

/** Is a task due within `days` days from today? (not overdue) */
export function isTaskDueSoon(task: Task, days: number): boolean {
  if (!task.due) return false;
  if (task.status === 'done' || task.status === 'cancelled') return false;
  const today = todayMidnight();
  const dueDate = new Date(task.due);
  dueDate.setHours(0, 0, 0, 0);
  return dueDate >= today && dueDate.getTime() <= today.getTime() + days * 86400_000;
}

/** Truncate a title for display (e.g. tab header) */
export function truncateTitle(title: string, maxLen = 20): string {
  if (title.length <= maxLen) return title;
  return title.slice(0, maxLen - 1) + '…';
}

/** Replace characters illegal in file names */
export function sanitizeFileName(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, '-');
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Create an SVG element with attributes in one call */
export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      el.setAttribute(k, String(v));
    }
  }
  return el;
}
