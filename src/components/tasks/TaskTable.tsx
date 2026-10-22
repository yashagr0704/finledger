import { ArrowDown, MessageSquare, Paperclip, Repeat } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip } from '@/components/ui/menu';
import { Avatar, CategoryTag, DueDate, PriorityLabel } from '@/components/badges';
import { QuickStatusMenu } from '@/components/tasks/TaskList';
import { formatDate } from '@/lib/dates';
import { useLookup } from '@/lib/lookup';
import { isOverdue } from '@/lib/metrics';
import { cn } from '@/lib/utils';
import { useDb } from '@/store/store';
import { useUI } from '@/store/ui';
import type { Task } from '@/types';
import type { TaskFilters } from '@/lib/taskFilters';

export function TaskTable({
  tasks,
  selectable,
  selected,
  onSelect,
  sort,
  onSort,
}: {
  tasks: Task[];
  selectable: boolean;
  selected: Set<string>;
  onSelect: (ids: Set<string>) => void;
  sort: TaskFilters['sort'];
  onSort: (s: TaskFilters['sort']) => void;
}) {
  const db = useDb();
  const { users, clients, categories } = useLookup();
  const { openTask, activeTaskId } = useUI();
  const commentCounts = new Map<string, number>();
  db.comments.forEach((c) => commentCounts.set(c.taskId, (commentCounts.get(c.taskId) ?? 0) + 1));

  const allChecked = tasks.length > 0 && tasks.every((t) => selected.has(t.id));
  const someChecked = tasks.some((t) => selected.has(t.id));

  const SortHead = ({ k, children, className }: { k: TaskFilters['sort']; children: string; className?: string }) => (
    <th className={cn('px-2 py-2 font-medium', className)} aria-sort={sort === k ? 'ascending' : 'none'}>
      <button onClick={() => onSort(k)} className={cn('inline-flex items-center gap-1 uppercase tracking-wide hover:text-ink-700', sort === k && 'text-ink-700')}>
        {children}
        {sort === k && <ArrowDown className="size-3" />}
      </button>
    </th>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1120px] table-fixed text-left">
        <colgroup>
          {selectable && <col className="w-10" />}
          <col className="w-[84px]" />
          <col />
          <col className="w-[190px]" />
          <col className="w-[150px]" />
          <col className="w-[96px]" />
          <col className="w-[160px]" />
          <col className="w-[110px]" />
          <col className="w-[92px]" />
        </colgroup>
        <thead className="sticky top-0 z-10 bg-white">
          <tr className="border-b border-line text-2xs font-medium uppercase tracking-wide text-ink-400">
            {selectable && (
              <th className="py-2 pl-4 pr-1">
                <Checkbox
                  checked={allChecked ? true : someChecked ? 'indeterminate' : false}
                  onCheckedChange={(v) => {
                    const next = new Set(selected);
                    tasks.forEach((t) => (v ? next.add(t.id) : next.delete(t.id)));
                    onSelect(next);
                  }}
                  aria-label="Select all on this page"
                />
              </th>
            )}
            <th className={cn('py-2 font-medium', selectable ? 'px-2' : 'pl-4 pr-2')}>ID</th>
            <th className="px-2 py-2 font-medium">Task</th>
            <th className="px-2 py-2 font-medium">Client</th>
            <th className="px-2 py-2 font-medium">Assignee</th>
            <SortHead k="priority">Priority</SortHead>
            <th className="px-2 py-2 font-medium">Status</th>
            <SortHead k="due">Due</SortHead>
            <th className="px-2 py-2 pr-4 text-right font-medium">Progress</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {tasks.map((t) => {
            const client = clients.get(t.clientId);
            const assignee = users.get(t.assigneeId);
            const done = t.checklist.filter((c) => c.done).length;
            const comments = commentCounts.get(t.id) ?? 0;
            const isSel = selected.has(t.id);
            return (
              <tr
                key={t.id}
                onClick={() => openTask(t.id)}
                className={cn(
                  'group cursor-pointer transition-colors hover:bg-slate-50',
                  isSel && 'bg-brand-50/50 hover:bg-brand-50/70',
                  activeTaskId === t.id && 'bg-slate-50',
                  isOverdue(t) && 'shadow-[inset_2px_0_0_0_#ef4444]',
                )}
              >
                {selectable && (
                  <td className="py-2 pl-4 pr-1" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={isSel}
                      onCheckedChange={(v) => {
                        const next = new Set(selected);
                        if (v) next.add(t.id);
                        else next.delete(t.id);
                        onSelect(next);
                      }}
                      aria-label={`Select ${t.id}`}
                    />
                  </td>
                )}
                <td className={cn('py-2 font-mono text-2xs text-ink-500', selectable ? 'px-2' : 'pl-4 pr-2')}>{t.id}</td>
                <td className="px-2 py-2">
                  <button
                    onClick={(e) => (e.stopPropagation(), openTask(t.id))}
                    className="block max-w-full truncate text-left text-[13px] font-medium text-ink-900 hover:text-brand-700 focus-visible:outline-none focus-visible:underline"
                  >
                    {t.title}
                  </button>
                  <span className="mt-0.5 flex items-center gap-2 text-2xs text-ink-400">
                    <CategoryTag category={categories.get(t.categoryId)} className="h-4" />
                    {t.recurrence && (
                      <Tooltip content={`Recurring · ${t.recurrence.periodLabel}`}>
                        <Repeat className="size-3" />
                      </Tooltip>
                    )}
                    {comments > 0 && (
                      <span className="flex items-center gap-0.5">
                        <MessageSquare className="size-3" />
                        {comments}
                      </span>
                    )}
                    {t.attachments.length > 0 && (
                      <span className="flex items-center gap-0.5">
                        <Paperclip className="size-3" />
                        {t.attachments.length}
                      </span>
                    )}
                  </span>
                </td>
                <td className="truncate px-2 py-2 text-xs text-ink-700" title={client?.name}>
                  {client?.name}
                </td>
                <td className="px-2 py-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Avatar user={assignee} size="xs" />
                    <span className="truncate text-xs text-ink-700">{assignee?.name}</span>
                  </span>
                </td>
                <td className="px-2 py-2">
                  <PriorityLabel priority={t.priority} />
                </td>
                <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                  <QuickStatusMenu task={t} trigger="badge" />
                </td>
                <td className="px-2 py-2">
                  <DueDate task={t} atRiskDays={db.firm.atRiskDays} />
                  <span className="block pl-[18px] text-2xs text-ink-400">{formatDate(t.dueDate, 'd MMM')}</span>
                </td>
                <td className="px-2 py-2 pr-4 text-right">
                  {t.checklist.length ? (
                    <span className="inline-flex items-center gap-1.5 text-2xs tabular-nums text-ink-500">
                      <svg viewBox="0 0 16 16" className="size-3.5 -rotate-90" aria-hidden>
                        <circle cx="8" cy="8" r="6" fill="none" stroke="#e2e8f0" strokeWidth="2.5" />
                        <circle
                          cx="8"
                          cy="8"
                          r="6"
                          fill="none"
                          stroke={done === t.checklist.length ? '#10b981' : '#5b5bd6'}
                          strokeWidth="2.5"
                          strokeDasharray={`${(done / t.checklist.length) * 37.7} 37.7`}
                          strokeLinecap="round"
                        />
                      </svg>
                      {done}/{t.checklist.length}
                    </span>
                  ) : (
                    <span className="text-2xs text-ink-300">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
