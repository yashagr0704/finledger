import type { ReactNode } from 'react';
import { ChevronDown, MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { Avatar, DueDate, PriorityIcon, StatusBadge } from '@/components/badges';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger, Tooltip } from '@/components/ui/menu';
import { STATUS_META } from '@/lib/constants';
import { useLookup } from '@/lib/lookup';
import { cn } from '@/lib/utils';
import { availableTransitions } from '@/lib/workflow';
import { store, useCurrentUser, useDb } from '@/store/store';
import { useUI } from '@/store/ui';
import type { Task } from '@/types';

/** Dropdown of the workflow transitions the current user may apply. */
export function QuickStatusMenu({ task, trigger }: { task: Task; trigger?: 'badge' | 'icon' }) {
  const db = useDb();
  const me = useCurrentUser();
  const { openTask } = useUI();
  const transitions = availableTransitions(db, me, task);
  if (!transitions.length) return trigger === 'badge' ? <StatusBadge status={task.status} /> : null;
  return (
    <Menu>
      <MenuTrigger asChild onClick={(e) => e.stopPropagation()}>
        {trigger === 'icon' ? (
          <button className="rounded p-1 text-ink-400 hover:bg-slate-100 hover:text-ink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40" aria-label={`Update status of ${task.id}`}>
            <MoreHorizontal className="size-4" />
          </button>
        ) : (
          <button className="group/st inline-flex items-center gap-0.5 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40" aria-label={`Change status of ${task.id}`}>
            <StatusBadge status={task.status} />
            <ChevronDown className="size-3 text-ink-400 opacity-0 transition-opacity group-hover/st:opacity-100" />
          </button>
        )}
      </MenuTrigger>
      <MenuContent onClick={(e) => e.stopPropagation()}>
        <MenuLabel>Move to</MenuLabel>
        {transitions.map((t) => (
          <MenuItem
            key={t.to + t.label}
            onSelect={() => {
              if (t.requiresNote) return openTask(task.id);
              if (store.transitionTask(task.id, t.to)) toast.success(`${task.id}: ${t.label}`);
            }}
          >
            <span className={cn('size-2 rounded-full', STATUS_META[t.to].dot)} />
            {t.label}
            {t.requiresNote && <span className="ml-auto text-2xs text-ink-400">needs note</span>}
          </MenuItem>
        ))}
        <MenuItem onSelect={() => openTask(task.id)}>Open details…</MenuItem>
      </MenuContent>
    </Menu>
  );
}

export function TaskListItem({ task, showAssignee = true, showClient = true, trailing }: { task: Task; showAssignee?: boolean; showClient?: boolean; trailing?: ReactNode }) {
  const { users, clients } = useLookup();
  const { openTask } = useUI();
  const db = useDb();
  const client = clients.get(task.clientId);
  const assignee = users.get(task.assigneeId);
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={() => openTask(task.id)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), openTask(task.id))}
        className="group flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none"
      >
        <PriorityIcon priority={task.priority} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-ink-900 group-hover:text-brand-700">{task.title}</p>
          <p className="truncate text-xs text-ink-500">
            <span className="font-mono text-2xs">{task.id}</span>
            {showClient && client && <> · {client.name}</>}
          </p>
        </div>
        {trailing}
        <div className="hidden sm:block">
          <QuickStatusMenu task={task} trigger="badge" />
        </div>
        <DueDate task={task} atRiskDays={db.firm.atRiskDays} className="w-24 justify-end" />
        {showAssignee && (
          <Tooltip content={assignee?.name ?? 'Unassigned'}>
            <span>
              <Avatar user={assignee} size="sm" />
            </span>
          </Tooltip>
        )}
      </div>
    </li>
  );
}
