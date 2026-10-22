import { differenceInHours, endOfMonth, format, parseISO, startOfMonth, subMonths } from 'date-fns';
import type { Database, Task, User } from '@/types';
import { daysUntil, todayKey, toDateKey } from './dates';
import { PRIORITY_RANK } from './constants';

export const isOpen = (t: Task) => t.status !== 'completed';
export const isOverdue = (t: Task) => isOpen(t) && t.dueDate < todayKey();
export const isDueToday = (t: Task) => isOpen(t) && t.dueDate === todayKey();
export function isAtRisk(t: Task, atRiskDays: number) {
  if (!isOpen(t)) return false;
  const d = daysUntil(t.dueDate);
  return d >= 0 && d <= atRiskDays && (t.status === 'not_started' || t.status === 'changes_requested' || d <= 1);
}
export const awaitingReview = (t: Task) => t.status === 'in_review';

export function completedInMonth(t: Task, ref = new Date()) {
  return t.status === 'completed' && !!t.completedAt && t.completedAt.slice(0, 7) === format(ref, 'yyyy-MM');
}

export type DeadlineState = 'overdue' | 'today' | 'soon' | 'later' | 'done';
export function deadlineState(t: Task, atRiskDays = 3): DeadlineState {
  if (!isOpen(t)) return 'done';
  const d = daysUntil(t.dueDate);
  if (d < 0) return 'overdue';
  if (d === 0) return 'today';
  if (d <= atRiskDays) return 'soon';
  return 'later';
}

/** Sort open work: overdue first, then by due date, then by priority. */
export function byUrgency(a: Task, b: Task) {
  if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
}

export function workloadHours(tasks: Task[], userId: string) {
  return tasks.filter((t) => isOpen(t) && t.assigneeId === userId).reduce((sum, t) => {
    const remaining = t.checklist.length ? 1 - t.checklist.filter((c) => c.done).length / t.checklist.length : 1;
    return sum + t.estimateHours * Math.max(0.2, remaining);
  }, 0);
}

export type WorkloadLevel = 'light' | 'balanced' | 'heavy' | 'over';
/** Workload as share of weekly capacity for work due in the next 14 days (and overdue). */
export function workloadFor(tasks: Task[], user: User) {
  const horizon = toDateKey(new Date(Date.now() + 14 * 86400000));
  const near = tasks.filter((t) => t.dueDate <= horizon);
  const hours = Math.round(workloadHours(near, user.id));
  const pct = Math.round((hours / (user.capacityHours * 2)) * 100);
  const level: WorkloadLevel = pct >= 100 ? 'over' : pct >= 75 ? 'heavy' : pct >= 35 ? 'balanced' : 'light';
  return { hours, pct, level };
}

export function lastMonths(n: number, ref = new Date()) {
  return Array.from({ length: n }, (_, i) => subMonths(startOfMonth(ref), n - 1 - i));
}

/** Completed vs. created (due) per month, for trend charts. */
export function completionTrend(tasks: Task[], months: number) {
  return lastMonths(months).map((m) => {
    const key = format(m, 'yyyy-MM');
    const completed = tasks.filter((t) => t.completedAt?.slice(0, 7) === key);
    return {
      month: format(m, 'MMM'),
      key,
      completed: completed.length,
      onTime: completed.filter((t) => t.completedAt!.slice(0, 10) <= t.dueDate).length,
      late: completed.filter((t) => t.completedAt!.slice(0, 10) > t.dueDate).length,
      // Only count deadlines that have already arrived, so the current month isn't inflated.
      due: tasks.filter((t) => t.dueDate.slice(0, 7) === key && t.dueDate <= todayKey()).length,
    };
  });
}

/** Tasks past their due date at each month end (or today for the current month). */
export function overdueTrend(tasks: Task[], months: number) {
  const now = todayKey();
  return lastMonths(months).map((m) => {
    const endKey = toDateKey(endOfMonth(m));
    const asOf = endKey > now ? now : endKey;
    const count = tasks.filter(
      (t) => t.createdAt.slice(0, 10) <= asOf && t.dueDate < asOf && (!t.completedAt || t.completedAt.slice(0, 10) > asOf),
    ).length;
    const lateCompletions = tasks.filter((t) => t.completedAt?.slice(0, 7) === format(m, 'yyyy-MM') && t.completedAt.slice(0, 10) > t.dueDate).length;
    return { month: format(m, 'MMM'), overdue: count, lateCompletions };
  });
}

export function reviewTurnaround(db: Database, filter?: (taskId: string) => boolean) {
  const recs = db.reviews.filter((r) => !filter || filter(r.taskId));
  if (!recs.length) return { avgHours: 0, count: 0, returnedPct: 0 };
  const total = recs.reduce((s, r) => s + Math.max(0, differenceInHours(parseISO(r.decidedAt), parseISO(r.submittedAt))), 0);
  return {
    avgHours: total / recs.length,
    count: recs.length,
    returnedPct: Math.round((recs.filter((r) => r.decision === 'returned').length / recs.length) * 100),
  };
}

export function formatHours(h: number) {
  if (h < 1) return '<1h';
  if (h < 48) return `${Math.round(h)}h`;
  return `${(h / 24).toFixed(1)}d`;
}
