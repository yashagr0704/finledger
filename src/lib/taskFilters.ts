import { addDays, format } from 'date-fns';
import type { Task, TaskStatus, Priority } from '@/types';
import { PRIORITY_RANK } from './constants';
import { toDateKey, todayKey } from './dates';
import { isOpen } from './metrics';

export interface TaskFilters {
  q: string;
  status: string[]; // TaskStatus values or 'open'
  priority: Priority[];
  assignee: string[];
  client: string[];
  category: string[];
  due: string; // '', overdue, today, week, next30, later
  completed: string; // '', month
  sort: 'due' | 'priority' | 'updated';
}

export const DUE_OPTIONS = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Due today' },
  { value: 'week', label: 'Next 7 days' },
  { value: 'next30', label: 'Next 30 days' },
  { value: 'later', label: 'Later than 30 days' },
];

const list = (v: string | null) => (v ? v.split(',').filter(Boolean) : []);

export function readFilters(p: URLSearchParams): TaskFilters {
  return {
    q: p.get('q') ?? '',
    status: list(p.get('status')),
    priority: list(p.get('priority')) as Priority[],
    assignee: list(p.get('assignee')),
    client: list(p.get('client')),
    category: list(p.get('category')),
    due: p.get('due') ?? '',
    completed: p.get('completed') ?? '',
    sort: (p.get('sort') as TaskFilters['sort']) || 'due',
  };
}

export function countActive(f: TaskFilters) {
  return [f.q, f.status.length, f.priority.length, f.assignee.length, f.client.length, f.category.length, f.due, f.completed].filter(Boolean).length;
}

export function applyFilters(tasks: Task[], f: TaskFilters) {
  const today = todayKey();
  const week = toDateKey(addDays(new Date(), 7));
  const month = toDateKey(addDays(new Date(), 30));
  const q = f.q.trim().toLowerCase();
  const out = tasks.filter((t) => {
    if (q && !t.title.toLowerCase().includes(q) && !t.id.toLowerCase().includes(q)) return false;
    if (f.status.length) {
      const wantsOpen = f.status.includes('open');
      if (!(f.status.includes(t.status) || (wantsOpen && isOpen(t)))) return false;
    }
    if (f.priority.length && !f.priority.includes(t.priority)) return false;
    if (f.assignee.length && !f.assignee.includes(t.assigneeId)) return false;
    if (f.client.length && !f.client.includes(t.clientId)) return false;
    if (f.category.length && !f.category.includes(t.categoryId)) return false;
    if (f.completed === 'month' && !(t.completedAt && t.completedAt.slice(0, 7) === format(new Date(), 'yyyy-MM'))) return false;
    switch (f.due) {
      case 'overdue':
        return isOpen(t) && t.dueDate < today;
      case 'today':
        return isOpen(t) && t.dueDate === today;
      case 'week':
        return t.dueDate >= today && t.dueDate <= week;
      case 'next30':
        return t.dueDate >= today && t.dueDate <= month;
      case 'later':
        return t.dueDate > month;
    }
    return true;
  });
  return sortTasks(out, f.sort);
}

export function sortTasks(tasks: Task[], sort: TaskFilters['sort']) {
  const copy = [...tasks];
  if (sort === 'priority') copy.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.dueDate.localeCompare(b.dueDate));
  else if (sort === 'updated') copy.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  else copy.sort((a, b) => Number(a.status === 'completed') - Number(b.status === 'completed') || a.dueDate.localeCompare(b.dueDate) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
  return copy;
}

export const STATUS_FILTER_VALUES: (TaskStatus | 'open')[] = ['open', 'not_started', 'in_progress', 'in_review', 'changes_requested', 'completed'];
