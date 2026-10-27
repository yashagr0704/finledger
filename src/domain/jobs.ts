import { differenceInCalendarDays, parseISO } from 'date-fns';
import { formatDate } from '@/lib/dates';
import { isOpen } from '@/lib/metrics';
import type { AppNotification, Database } from '@/types';
import { generateFromTemplate } from './commands';
import { idFactory, type Ctx } from './context';

export interface JobReport {
  dueSoon: number;
  overdue: number;
  reminders: number;
  dscExpiry: number;
  generated: number;
}

/** Days ahead of the due date at which recurring tasks are created automatically. */
export const RECURRING_LEAD_DAYS = 20;

/**
 * Scheduled work for one firm: deadline reminders, overdue alerts, personal
 * reminders, DSC expiry warnings and recurring task generation. Idempotent —
 * running it several times a day creates each alert only once.
 */
export function runScheduledJobs(db: Database, at = new Date()): { db: Database; report: JobReport } {
  const draft = structuredClone(db);
  const ids = idFactory(draft);
  const report: JobReport = { dueSoon: 0, overdue: 0, reminders: 0, dscExpiry: 0, generated: 0 };
  const day = at.toISOString().slice(0, 10);
  const existingKeys = new Set(draft.notifications.map((n) => n.refKey).filter(Boolean));
  const push = (userId: string, refKey: string, n: Omit<AppNotification, 'id' | 'userId' | 'createdAt' | 'read' | 'refKey'>) => {
    if (existingKeys.has(refKey)) return false;
    existingKeys.add(refKey);
    draft.notifications.unshift({ id: ids.newId('ntf'), userId, createdAt: at.toISOString(), read: false, refKey, ...n });
    return true;
  };
  const active = new Set(draft.users.filter((u) => u.status === 'active').map((u) => u.id));
  const admins = draft.users.filter((u) => u.role === 'admin' && u.status === 'active');
  const clientName = (id: string) => draft.clients.find((c) => c.id === id)?.name ?? '';

  for (const t of draft.tasks) {
    if (!isOpen(t) || !active.has(t.assigneeId)) continue;
    const d = differenceInCalendarDays(parseISO(t.dueDate), at);
    if (d >= 0 && d <= Math.min(2, draft.firm.atRiskDays)) {
      if (push(t.assigneeId, `due:${t.id}:${t.dueDate}`, { type: 'due_soon', title: 'Deadline approaching', body: `${t.title} is due ${d === 0 ? 'today' : d === 1 ? 'tomorrow' : `on ${formatDate(t.dueDate, 'd MMM')}`}`, taskId: t.id, clientId: t.clientId })) report.dueSoon += 1;
    } else if (d < 0) {
      if (push(t.assigneeId, `overdue:${t.id}:${day}`, { type: 'overdue', title: 'Task overdue', body: `${t.title} · ${clientName(t.clientId)} was due ${formatDate(t.dueDate, 'd MMM')}`, taskId: t.id, clientId: t.clientId })) report.overdue += 1;
      // Escalate to admins once a task is a week late.
      if (d <= -7) for (const a of admins) push(a.id, `escalate:${t.id}`, { type: 'overdue', title: 'Overdue escalation', body: `${t.title} · ${clientName(t.clientId)} is ${-d} days late`, taskId: t.id, clientId: t.clientId });
    }
  }

  for (const r of draft.reminders) {
    if (r.done || r.notifiedAt || r.dueAt > at.toISOString()) continue;
    push(r.userId, `reminder:${r.id}:${r.dueAt}`, { type: 'due_soon', title: 'Reminder', body: r.title, clientId: r.clientId });
    r.notifiedAt = at.toISOString();
    report.reminders += 1;
    if (r.repeat !== 'none') {
      // Roll a repeating reminder forward to its next occurrence.
      const next = parseISO(r.dueAt);
      if (r.repeat === 'daily') next.setDate(next.getDate() + 1);
      if (r.repeat === 'weekly') next.setDate(next.getDate() + 7);
      if (r.repeat === 'monthly') next.setMonth(next.getMonth() + 1);
      r.dueAt = next.toISOString();
      r.notifiedAt = undefined;
    }
  }

  for (const dsc of draft.dscs) {
    const d = differenceInCalendarDays(parseISO(dsc.expiresOn), at);
    const window = d < 0 ? 'expired' : d <= 7 ? '7' : d <= 30 ? '30' : null;
    if (!window) continue;
    for (const a of admins)
      if (push(a.id, `dsc:${dsc.id}:${window}`, { type: 'due_soon', title: d < 0 ? 'DSC expired' : 'DSC expiring soon', body: `${dsc.holder} (${clientName(dsc.clientId)}) — ${d < 0 ? 'expired' : `valid till ${formatDate(dsc.expiresOn, 'd MMM yyyy')}`}`, clientId: dsc.clientId })) report.dscExpiry += 1;
  }

  const system = admins[0];
  if (system) {
    const ctx: Ctx = { db: draft, me: system, newId: ids.newId, newTaskId: ids.newTaskId };
    for (const tpl of draft.templates.filter((t) => t.active)) {
      try {
        report.generated += generateFromTemplate(ctx, tpl.id, { onlyIfDueWithinDays: RECURRING_LEAD_DAYS }).created;
      } catch {
        // A template without an upcoming period is simply skipped.
      }
    }
  }
  return { db: draft, report };
}
