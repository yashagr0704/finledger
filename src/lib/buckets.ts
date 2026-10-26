import type { Service, Task } from '@/types';
import { daysUntil } from './dates';
import { isOpen } from './metrics';

/** Dashboard groups from the design brief. */
export const DASHBOARD_GROUPS = [
  { id: 'all', label: 'All Tasks', categories: null },
  { id: 'gst', label: 'GST', categories: ['gst'] },
  { id: 'itr', label: 'Income Tax', categories: ['itr'] },
  { id: 'tds', label: 'TDS', categories: ['tds'] },
  { id: 'mca', label: 'MCA', categories: ['roc'] },
  { id: 'other', label: 'Other', categories: ['acc', 'aud', 'pay', 'adv'] },
  { id: 'todo', label: 'To-do', categories: null },
] as const;
export type DashboardGroup = (typeof DASHBOARD_GROUPS)[number]['id'];

export function inGroup(t: Task, group: DashboardGroup, meId: string) {
  if (group === 'todo') return t.createdBy === meId && t.assigneeId === meId;
  const g = DASHBOARD_GROUPS.find((x) => x.id === group)!;
  if (!g.categories) return true;
  return (g.categories as readonly string[]).includes(t.categoryId) || (group === 'other' && !['gst', 'itr', 'tds', 'roc'].includes(t.categoryId));
}

export const BUCKETS = [
  { id: 'today', label: 'Due', sub: 'Today', tone: 'text-amber-600', test: (d: number) => d === 0 },
  { id: 'tomorrow', label: 'Due', sub: 'Tomorrow', tone: 'text-emerald-600', test: (d: number) => d === 1 },
  { id: 'week', label: 'Due', sub: 'In 7 Days', tone: 'text-brand-600', test: (d: number) => d >= 2 && d <= 7 },
  { id: 'later', label: 'Due', sub: 'After 7 Days', tone: 'text-brand-600', test: (d: number) => d > 7 },
  { id: 'od7', label: 'Overdue', sub: 'Up To 7 Days', tone: 'text-red-600', test: (d: number) => d < 0 && d >= -7 },
  { id: 'od7plus', label: 'Overdue', sub: 'More Than 7 Days', tone: 'text-red-800', test: (d: number) => d < -7 },
  { id: 'total', label: 'Due', sub: 'Total', tone: 'text-violet-700', test: () => true },
] as const;
export type BucketId = (typeof BUCKETS)[number]['id'];

export function inBucket(t: Task, bucket: BucketId) {
  if (!isOpen(t)) return false;
  return BUCKETS.find((b) => b.id === bucket)!.test(daysUntil(t.dueDate));
}

/** "Period" column: the return period a task covers. */
export function periodOf(t: Task) {
  if (t.recurrence) return t.recurrence.periodLabel;
  const m = t.title.match(/—\s*(.+)$/);
  return m ? m[1] : '—';
}

export function serviceLabel(t: Task, services: Map<string, Service>) {
  const s = t.serviceId ? services.get(t.serviceId) : undefined;
  return s ? `${s.name}${s.frequency !== 'Monthly' && s.frequency !== 'As required' && s.frequency !== 'One-time' ? ` (${s.frequency})` : ''}` : t.title;
}

/** Proximity colour used by the dot calendar: green = comfortable, yellow = close, red = passed. */
export function proximityTone(t: Task, atRiskDays: number): 'green' | 'yellow' | 'red' | 'done' {
  if (!isOpen(t)) return 'done';
  const d = daysUntil(t.dueDate);
  if (d < 0) return 'red';
  if (d <= atRiskDays) return 'yellow';
  return 'green';
}

export const TONE_CLASS = { green: 'bg-emerald-500', yellow: 'bg-amber-400', red: 'bg-red-500', done: 'bg-slate-300' } as const;
