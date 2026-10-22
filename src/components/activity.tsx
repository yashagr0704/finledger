import type { ReactNode } from 'react';
import {
  ArrowRightLeft,
  CalendarClock,
  CheckCircle2,
  CircleDot,
  FilePlus2,
  FileCheck2,
  FileQuestion,
  ListChecks,
  MessageSquare,
  Pencil,
  PlusCircle,
  Undo2,
  UserPlus,
  Building2,
  Landmark,
} from 'lucide-react';
import { FILING_META, ROLE_META, STATUS_LONG_LABEL } from '@/lib/constants';
import { formatDate, timeAgo } from '@/lib/dates';
import { useLookup } from '@/lib/lookup';
import type { Activity, FilingStage, Role, TaskStatus } from '@/types';
import { useUI } from '@/store/ui';
import { Link } from 'react-router-dom';
import { Avatar } from './badges';
import { cn } from '@/lib/utils';

const ICONS: Record<Activity['type'], { icon: ReactNode; tone: string }> = {
  task_created: { icon: <PlusCircle />, tone: 'text-brand-600 bg-brand-50' },
  status_changed: { icon: <CircleDot />, tone: 'text-blue-600 bg-blue-50' },
  reassigned: { icon: <ArrowRightLeft />, tone: 'text-ink-600 bg-slate-100' },
  due_changed: { icon: <CalendarClock />, tone: 'text-amber-700 bg-amber-50' },
  commented: { icon: <MessageSquare />, tone: 'text-ink-600 bg-slate-100' },
  review_approved: { icon: <CheckCircle2 />, tone: 'text-emerald-600 bg-emerald-50' },
  review_returned: { icon: <Undo2 />, tone: 'text-orange-600 bg-orange-50' },
  attachment_added: { icon: <FilePlus2 />, tone: 'text-ink-600 bg-slate-100' },
  checklist_updated: { icon: <ListChecks />, tone: 'text-ink-600 bg-slate-100' },
  filing_updated: { icon: <Landmark />, tone: 'text-sky-700 bg-sky-50' },
  client_created: { icon: <Building2 />, tone: 'text-brand-600 bg-brand-50' },
  client_updated: { icon: <Pencil />, tone: 'text-ink-600 bg-slate-100' },
  document_received: { icon: <FileCheck2 />, tone: 'text-emerald-600 bg-emerald-50' },
  document_requested: { icon: <FileQuestion />, tone: 'text-amber-700 bg-amber-50' },
  member_invited: { icon: <UserPlus />, tone: 'text-brand-600 bg-brand-50' },
  member_updated: { icon: <Pencil />, tone: 'text-ink-600 bg-slate-100' },
  task_updated: { icon: <Pencil />, tone: 'text-ink-600 bg-slate-100' },
};

function B({ children }: { children: ReactNode }) {
  return <span className="font-medium text-ink-900">{children}</span>;
}

export function useActivityText() {
  const { users, clients } = useLookup();
  const name = (id?: string) => users.get(id ?? '')?.name ?? 'Someone';
  return (a: Activity): ReactNode => {
    const m = a.meta ?? {};
    switch (a.type) {
      case 'task_created':
        return m.template ? <>generated this task from <B>{m.template}</B></> : 'created the task';
      case 'status_changed':
        if (m.to === 'in_review') return <>submitted for review</>;
        return (
          <>
            moved from <B>{STATUS_LONG_LABEL[m.from as TaskStatus]}</B> to <B>{STATUS_LONG_LABEL[m.to as TaskStatus]}</B>
          </>
        );
      case 'reassigned':
        return (
          <>
            reassigned from <B>{name(m.from)}</B> to <B>{name(m.to)}</B>
          </>
        );
      case 'due_changed':
        return (
          <>
            changed the due date from <B>{formatDate(m.from, 'd MMM')}</B> to <B>{formatDate(m.to, 'd MMM')}</B>
          </>
        );
      case 'commented':
        return 'commented';
      case 'review_approved':
        return <>approved the work</>;
      case 'review_returned':
        return <>requested changes{m.note ? <>: “{m.note}”</> : null}</>;
      case 'attachment_added':
        return <>uploaded <B>{m.name}</B></>;
      case 'checklist_updated':
        return <>added checklist item <B>{m.name}</B></>;
      case 'filing_updated':
        return <>set filing status to <B>{FILING_META[m.to as FilingStage]}</B></>;
      case 'client_created':
        return <>added client <B>{clients.get(a.clientId ?? '')?.name}</B></>;
      case 'client_updated':
        return <>updated client details</>;
      case 'document_received':
        return <>marked <B>{m.name}</B> as received</>;
      case 'document_requested':
        return <>requested <B>{m.name}</B></>;
      case 'member_invited':
        return <>invited <B>{name(a.userId)}</B> to the team</>;
      case 'member_updated':
        return (
          <>
            updated <B>{name(a.userId)}</B>
            {m.role ? <> — role set to {ROLE_META[m.role as Role].label}</> : m.status ? <> — {m.status}</> : null}
          </>
        );
      case 'task_updated':
        return 'edited task details';
    }
  };
}

/** Compact feed row used on dashboards, client and team pages. */
export function ActivityFeed({ items, showTask = true, empty }: { items: Activity[]; showTask?: boolean; empty?: ReactNode }) {
  const { users, tasks, clients } = useLookup();
  const text = useActivityText();
  const { openTask } = useUI();
  if (!items.length) return <>{empty}</>;
  return (
    <ul className="divide-y divide-line">
      {items.map((a) => {
        const actor = users.get(a.actorId);
        const task = a.taskId ? tasks.get(a.taskId) : undefined;
        const client = a.clientId ? clients.get(a.clientId) : undefined;
        return (
          <li key={a.id} className="flex gap-3 px-4 py-2.5">
            <Avatar user={actor} size="sm" className="mt-0.5" />
            <div className="min-w-0 flex-1 text-[13px] leading-snug text-ink-600">
              <span className="font-medium text-ink-900">{actor?.name ?? 'System'}</span> {text(a)}
              {showTask && task && (
                <button onClick={() => openTask(task.id)} className="mt-0.5 block max-w-full truncate text-left text-xs text-brand-700 hover:underline">
                  {task.id} · {task.title}
                </button>
              )}
              {showTask && !task && client && a.type !== 'client_created' && (
                <Link to={`/clients/${client.id}`} className="mt-0.5 block truncate text-xs text-brand-700 hover:underline">
                  {client.name}
                </Link>
              )}
            </div>
            <time className="shrink-0 pt-0.5 text-2xs text-ink-400" dateTime={a.createdAt}>
              {timeAgo(a.createdAt)}
            </time>
          </li>
        );
      })}
    </ul>
  );
}

export function ActivityIcon({ type }: { type: Activity['type'] }) {
  const m = ICONS[type];
  return <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full [&_svg]:size-3.5', m.tone)}>{m.icon}</span>;
}
