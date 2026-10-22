import type { Database, Task, TaskStatus, User } from '@/types';
import { canEditTask, canReviewTask, canWorkOnTask } from './permissions';

export interface Transition {
  to: TaskStatus;
  label: string;
  variant: 'primary' | 'secondary' | 'success' | 'danger';
  /** Returning work requires a written explanation. */
  requiresNote?: boolean;
}

/**
 * Status transitions available to `user` for `task`.
 *
 *   Not Started → In Progress → Submitted for Review → Completed
 *   Submitted for Review → Changes Requested → In Progress → …
 *
 * Tasks that require review can never jump straight to Completed.
 */
export function availableTransitions(db: Database, user: User, task: Task): Transition[] {
  const worker = canWorkOnTask(db, user, task);
  const out: Transition[] = [];
  switch (task.status) {
    case 'not_started':
      if (worker) out.push({ to: 'in_progress', label: 'Start work', variant: 'primary' });
      break;
    case 'in_progress':
      if (worker) {
        if (task.requiresReview) out.push({ to: 'in_review', label: 'Submit for review', variant: 'primary' });
        else out.push({ to: 'completed', label: 'Mark complete', variant: 'success' });
        out.push({ to: 'not_started', label: 'Move to Not Started', variant: 'secondary' });
      }
      break;
    case 'in_review':
      if (canReviewTask(user, task)) {
        out.push({ to: 'completed', label: 'Approve', variant: 'success' });
        out.push({ to: 'changes_requested', label: 'Request changes', variant: 'danger', requiresNote: true });
      }
      if (task.assigneeId === user.id) out.push({ to: 'in_progress', label: 'Withdraw submission', variant: 'secondary' });
      break;
    case 'changes_requested':
      if (worker) out.push({ to: 'in_progress', label: 'Resume work', variant: 'primary' });
      break;
    case 'completed':
      if (canEditTask(db, user, task)) out.push({ to: 'in_progress', label: 'Reopen task', variant: 'secondary' });
      break;
  }
  return out;
}

export function canTransition(db: Database, user: User, task: Task, to: TaskStatus) {
  return availableTransitions(db, user, task).find((t) => t.to === to);
}

/** Explains why a drop/transition is not allowed (for Kanban feedback). */
export function transitionBlockReason(db: Database, user: User, task: Task, to: TaskStatus) {
  if (task.status === to) return null;
  if (canTransition(db, user, task, to)) return null;
  if (to === 'completed' && task.requiresReview && task.status !== 'in_review')
    return 'This task requires review. Submit it for review instead of completing it directly.';
  if ((to === 'completed' || to === 'changes_requested') && task.status === 'in_review')
    return 'Only the assigned reviewer can approve or return this task.';
  if (to === 'in_review' && !task.requiresReview) return 'This task does not require review — mark it complete instead.';
  if (!canWorkOnTask(db, user, task)) return 'You can only update tasks assigned to you.';
  return `Tasks can’t move directly from this status to that column.`;
}
