import { useState } from 'react';
import { MessageSquare, Paperclip, Repeat } from 'lucide-react';
import { toast } from 'sonner';
import { Avatar, CategoryTag, DueDate, PriorityIcon } from '@/components/badges';
import { QuickStatusMenu } from '@/components/tasks/TaskList';
import { STATUS_LONG_LABEL, STATUS_META, STATUS_ORDER } from '@/lib/constants';
import { useLookup } from '@/lib/lookup';
import { isOverdue } from '@/lib/metrics';
import { cn } from '@/lib/utils';
import { canTransition, transitionBlockReason } from '@/lib/workflow';
import { store, useCurrentUser, useDb } from '@/store/store';
import { useUI } from '@/store/ui';
import type { Task, TaskStatus } from '@/types';

export function KanbanBoard({ tasks, completedNote }: { tasks: Task[]; completedNote?: string }) {
  const db = useDb();
  const me = useCurrentUser();
  const { users, clients, categories } = useLookup();
  const { openTask } = useUI();
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);
  const dragTask = dragId ? tasks.find((t) => t.id === dragId) : undefined;
  const commentCounts = new Map<string, number>();
  db.comments.forEach((c) => commentCounts.set(c.taskId, (commentCounts.get(c.taskId) ?? 0) + 1));

  const drop = (to: TaskStatus) => {
    setOver(null);
    const task = dragTask;
    setDragId(null);
    if (!task || task.status === to) return;
    const reason = transitionBlockReason(db, me, task, to);
    if (reason) return void toast.error('Can’t move task', { description: reason });
    const tr = canTransition(db, me, task, to)!;
    if (tr.requiresNote) {
      openTask(task.id);
      toast.info('Add an explanation to return this task', { description: 'A note is required when requesting changes.' });
      return;
    }
    if (store.transitionTask(task.id, to)) toast.success(`${task.id} → ${STATUS_LONG_LABEL[to]}`);
  };

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {STATUS_ORDER.map((status) => {
        const col = tasks.filter((t) => t.status === status);
        const allowed = dragTask ? dragTask.status !== status && !!canTransition(db, me, dragTask, status) : false;
        return (
          <section
            key={status}
            aria-label={STATUS_META[status].label}
            onDragOver={(e) => {
              if (!dragTask) return;
              // Always accept the drop so invalid moves can explain why they were rejected.
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setOver(status);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              drop(status);
            }}
            className={cn(
              'flex w-[280px] shrink-0 flex-col rounded-lg border border-line bg-slate-50/70 transition-colors',
              dragTask && allowed && 'border-dashed border-brand-300 bg-brand-50/40',
              dragTask && !allowed && dragTask.status !== status && 'opacity-60',
              over === status && allowed && 'border-brand-400 bg-brand-50',
            )}
          >
            <header className="flex items-center gap-2 px-3 py-2.5">
              <span className={cn('size-2 rounded-full', STATUS_META[status].dot)} />
              <h3 className="text-xs font-semibold text-ink-800">{STATUS_LONG_LABEL[status]}</h3>
              <span className="rounded-full bg-white px-1.5 text-2xs font-semibold tabular-nums text-ink-500 ring-1 ring-line">{col.length}</span>
            </header>
            {status === 'completed' && completedNote && <p className="-mt-1 px-3 pb-2 text-2xs text-ink-400">{completedNote}</p>}
            <div className="flex max-h-[calc(100vh-300px)] min-h-[120px] flex-col gap-2 overflow-y-auto px-2 pb-2">
              {col.length === 0 && <p className="rounded-md border border-dashed border-line px-3 py-6 text-center text-2xs text-ink-400">No tasks</p>}
              {col.map((t) => {
                const assignee = users.get(t.assigneeId);
                const done = t.checklist.filter((c) => c.done).length;
                const comments = commentCounts.get(t.id) ?? 0;
                return (
                  <article
                    key={t.id}
                    draggable
                    onDragStart={(e) => {
                      setDragId(t.id);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', t.id);
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setOver(null);
                    }}
                    onClick={() => openTask(t.id)}
                    onKeyDown={(e) => e.key === 'Enter' && openTask(t.id)}
                    tabIndex={0}
                    className={cn(
                      'group cursor-pointer rounded-md border border-line bg-white p-2.5 shadow-card transition-all hover:border-slate-300 hover:shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
                      dragId === t.id && 'rotate-1 opacity-50',
                      isOverdue(t) && 'border-l-2 border-l-red-500',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-mono text-2xs text-ink-400">{t.id}</span>
                      <div className="flex items-center gap-1">
                        <PriorityIcon priority={t.priority} />
                        <QuickStatusMenu task={t} trigger="icon" />
                      </div>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[13px] font-medium leading-snug text-ink-900">{t.title}</p>
                    <p className="mt-0.5 truncate text-xs text-ink-500">{clients.get(t.clientId)?.name}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <CategoryTag category={categories.get(t.categoryId)} className="h-4" />
                      {t.recurrence && <Repeat className="size-3 text-ink-400" aria-label="Recurring" />}
                    </div>
                    <div className="mt-2.5 flex items-center gap-2 border-t border-line pt-2">
                      <DueDate task={t} atRiskDays={db.firm.atRiskDays} className="text-2xs" />
                      <span className="ml-auto flex items-center gap-2 text-2xs text-ink-400">
                        {t.checklist.length > 0 && (
                          <span className={cn('tabular-nums', done === t.checklist.length && 'text-emerald-600')}>
                            {done}/{t.checklist.length}
                          </span>
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
                        <Avatar user={assignee} size="xs" />
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
