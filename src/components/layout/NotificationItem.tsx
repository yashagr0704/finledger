import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlarmClock, AlertTriangle, CalendarClock, CheckCircle2, FileCheck2, MessageSquare, Send, Undo2, UserPlus } from 'lucide-react';
import { timeAgo } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { store } from '@/store/store';
import { useUI } from '@/store/ui';
import type { AppNotification, NotificationType } from '@/types';

export const NOTIFICATION_META: Record<NotificationType, { icon: ReactNode; tone: string; label: string }> = {
  assigned: { icon: <UserPlus />, tone: 'bg-brand-50 text-brand-600', label: 'Assignments' },
  due_soon: { icon: <AlarmClock />, tone: 'bg-amber-50 text-amber-600', label: 'Deadlines' },
  overdue: { icon: <AlertTriangle />, tone: 'bg-red-50 text-red-600', label: 'Overdue' },
  submitted: { icon: <Send />, tone: 'bg-violet-50 text-violet-600', label: 'Reviews' },
  approved: { icon: <CheckCircle2 />, tone: 'bg-emerald-50 text-emerald-600', label: 'Reviews' },
  changes_requested: { icon: <Undo2 />, tone: 'bg-orange-50 text-orange-600', label: 'Reviews' },
  due_changed: { icon: <CalendarClock />, tone: 'bg-amber-50 text-amber-600', label: 'Deadlines' },
  comment: { icon: <MessageSquare />, tone: 'bg-slate-100 text-ink-600', label: 'Comments' },
  document: { icon: <FileCheck2 />, tone: 'bg-sky-50 text-sky-600', label: 'Documents' },
};

export function NotificationItem({ n, onNavigate, dense }: { n: AppNotification; onNavigate?: () => void; dense?: boolean }) {
  const { openTask } = useUI();
  const navigate = useNavigate();
  const m = NOTIFICATION_META[n.type];
  const go = () => {
    if (!n.read) store.markNotificationRead(n.id);
    onNavigate?.();
    if (n.taskId) openTask(n.taskId);
    else if (n.clientId) navigate(`/clients/${n.clientId}`);
  };
  return (
    <button
      onClick={go}
      className={cn(
        'group flex w-full items-start gap-3 text-left transition-colors hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none',
        dense ? 'px-3 py-2.5' : 'px-4 py-3',
        !n.read && 'bg-brand-50/30',
      )}
    >
      <span className={cn('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full [&_svg]:size-3.5', m.tone)}>{m.icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className={cn('text-[13px] text-ink-900', !n.read && 'font-semibold')}>{n.title}</span>
          <span className="ml-auto shrink-0 text-2xs text-ink-400">{timeAgo(n.createdAt)}</span>
        </span>
        <span className="mt-0.5 line-clamp-2 block text-xs leading-snug text-ink-600">{n.body}</span>
      </span>
      {!n.read && <span className="mt-2 size-2 shrink-0 rounded-full bg-brand-500" aria-label="Unread" />}
    </button>
  );
}
