import { AlertTriangle, CalendarClock, CheckCircle2, Clock } from 'lucide-react';
import { CHART_SERIES, FILING_META, PRIORITY_META, STATUS_META } from '@/lib/constants';
import { daysUntil, formatShortDate, relativeDay } from '@/lib/dates';
import { deadlineState } from '@/lib/metrics';
import { cn, initials } from '@/lib/utils';
import type { Category, FilingStage, Priority, Task, TaskStatus, User } from '@/types';
import { Tooltip } from './ui/menu';

export function StatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  const m = STATUS_META[status];
  return (
    <span className={cn('inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-2xs font-medium ring-1 ring-inset', m.tone, className)}>
      <span className={cn('size-1.5 rounded-full', m.dot)} />
      {m.label}
    </span>
  );
}

export function PriorityIcon({ priority, className }: { priority: Priority; className?: string }) {
  const m = PRIORITY_META[priority];
  if (priority === 'urgent') {
    return (
      <span className={cn('flex size-3.5 items-center justify-center rounded-[3px] bg-red-500 text-[9px] font-bold leading-none text-white', className)} aria-hidden>
        !
      </span>
    );
  }
  return (
    <span className={cn('flex h-3.5 items-end gap-[2px]', className)} aria-hidden>
      {[1, 2, 3].map((i) => (
        <span key={i} className={cn('w-[3px] rounded-sm', i <= m.bars ? (priority === 'high' ? 'bg-orange-500' : 'bg-ink-600') : 'bg-slate-200')} style={{ height: `${4 + i * 3}px` }} />
      ))}
    </span>
  );
}

export function PriorityLabel({ priority, className, hideLabel }: { priority: Priority; className?: string; hideLabel?: boolean }) {
  const m = PRIORITY_META[priority];
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', m.text, className)} title={`${m.label} priority`}>
      <PriorityIcon priority={priority} />
      {hideLabel ? <span className="sr-only">{m.label}</span> : m.label}
    </span>
  );
}

export function CategoryTag({ category, className }: { category?: Category; className?: string }) {
  if (!category) return null;
  return (
    <span className={cn('inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded border border-line bg-white px-1.5 text-2xs font-medium text-ink-700', className)}>
      <span className="size-1.5 rounded-sm" style={{ background: CHART_SERIES[category.colorSlot % CHART_SERIES.length] }} />
      {category.name}
    </span>
  );
}

export function FilingBadge({ stage }: { stage?: FilingStage }) {
  if (!stage) return null;
  const tone =
    stage === 'filed'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : stage === 'ready_to_file'
        ? 'bg-sky-50 text-sky-700 ring-sky-200'
        : 'bg-slate-50 text-ink-600 ring-slate-200';
  return <span className={cn('inline-flex h-5 items-center rounded px-1.5 text-2xs font-medium ring-1 ring-inset', tone)}>Filing · {FILING_META[stage]}</span>;
}

export function DueDate({ task, atRiskDays = 3, className, showIcon = true }: { task: Task; atRiskDays?: number; className?: string; showIcon?: boolean }) {
  const state = deadlineState(task, atRiskDays);
  const n = daysUntil(task.dueDate);
  const tone = {
    overdue: 'text-red-600 font-medium',
    today: 'text-amber-700 font-medium',
    soon: 'text-amber-700',
    later: 'text-ink-600',
    done: 'text-ink-400',
  }[state];
  const Icon = state === 'overdue' ? AlertTriangle : state === 'done' ? CheckCircle2 : state === 'later' ? CalendarClock : Clock;
  const label = state === 'overdue' ? `${-n}d overdue` : state === 'done' ? formatShortDate(task.dueDate) : relativeDay(task.dueDate);
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap text-xs tabular-nums', tone, className)} title={`Due ${formatShortDate(task.dueDate)}`}>
      {showIcon && <Icon className="size-3.5 shrink-0" />}
      {label}
    </span>
  );
}

const SIZE = { xs: 'size-5 text-[9px]', sm: 'size-6 text-[10px]', md: 'size-8 text-xs', lg: 'size-12 text-base' };

export function Avatar({ user, size = 'sm', className, ring }: { user?: Pick<User, 'name' | 'avatarHue'>; size?: keyof typeof SIZE; className?: string; ring?: boolean }) {
  if (!user) {
    return <span className={cn('inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-slate-300 text-ink-400', SIZE[size], className)}>?</span>;
  }
  return (
    <span
      className={cn('inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold', SIZE[size], ring && 'ring-2 ring-white', className)}
      style={{ background: `hsl(${user.avatarHue} 70% 93%)`, color: `hsl(${user.avatarHue} 45% 32%)` }}
      aria-hidden
    >
      {initials(user.name)}
    </span>
  );
}

export function UserChip({ user, size = 'xs', className, muted }: { user?: User; size?: keyof typeof SIZE; className?: string; muted?: boolean }) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <Avatar user={user} size={size} />
      <span className={cn('truncate text-xs', muted ? 'text-ink-500' : 'text-ink-800')}>{user?.name ?? 'Unassigned'}</span>
    </span>
  );
}

export function AvatarStack({ users, max = 4 }: { users: User[]; max?: number }) {
  const shown = users.slice(0, max);
  return (
    <div className="flex -space-x-1.5">
      {shown.map((u) => (
        <Tooltip key={u.id} content={u.name}>
          <span>
            <Avatar user={u} size="sm" ring />
          </span>
        </Tooltip>
      ))}
      {users.length > max && (
        <span className="inline-flex size-6 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-ink-600 ring-2 ring-white">+{users.length - max}</span>
      )}
    </div>
  );
}
