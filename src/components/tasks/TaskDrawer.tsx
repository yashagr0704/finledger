import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowUpRight,
  Building2,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  FileText,
  Link2,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  Repeat,
  Send,
  Trash2,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, SheetContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/form';
import { Checkbox } from '@/components/ui/checkbox';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Tooltip } from '@/components/ui/menu';
import { EmptyState, Kbd, Progress, Tabs } from '@/components/ui/misc';
import { useConfirm } from '@/components/ui/confirm';
import { ActivityIcon, useActivityText } from '@/components/activity';
import { Avatar, CategoryTag, DueDate, PriorityLabel, StatusBadge } from '@/components/badges';
import { FILING_META, FILING_STAGES, PRIORITY_META, PRIORITY_ORDER, ROLE_META } from '@/lib/constants';
import { daysUntil, formatDate, formatDateTime, timeAgo } from '@/lib/dates';
import { useLookup } from '@/lib/lookup';
import { assignableUsers, canDeleteTask, canEditTask, canManageDocuments, canViewTask, canWorkOnTask, reviewerCandidates } from '@/lib/permissions';
import { cn, formatFileSize } from '@/lib/utils';
import { availableTransitions, type Transition } from '@/lib/workflow';
import { store, useCurrentUser, useDb } from '@/store/store';
import { useUI } from '@/store/ui';
import type { Task } from '@/types';

export function TaskDrawer() {
  const { activeTaskId, closeTask } = useUI();
  const db = useDb();
  const me = useCurrentUser();
  const task = activeTaskId ? db.tasks.find((t) => t.id === activeTaskId) : undefined;
  const allowed = task ? canViewTask(db, me, task) : false;

  return (
    <Dialog open={!!activeTaskId} onOpenChange={(v) => !v && closeTask()}>
      {activeTaskId && (
        <SheetContent title={task?.title ?? 'Task'}>
          {!task ? (
            <DrawerMessage icon={<FileText />} title="Task not found" description={`${activeTaskId} may have been deleted.`} onClose={closeTask} />
          ) : !allowed ? (
            <DrawerMessage
              icon={<AlertTriangle />}
              title="You don’t have access to this task"
              description="It isn’t assigned to you or your team. Switch role or ask an admin for access."
              onClose={closeTask}
            />
          ) : (
            <TaskDetail key={task.id} task={task} />
          )}
        </SheetContent>
      )}
    </Dialog>
  );
}

function DrawerMessage({ icon, title, description, onClose }: { icon: ReactNode; title: string; description: string; onClose: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex justify-end p-3">
        <Button size="icon" variant="ghost" onClick={onClose} aria-label="Close">
          <X />
        </Button>
      </div>
      <EmptyState icon={icon} title={title} description={description} />
    </div>
  );
}

function TaskDetail({ task }: { task: Task }) {
  const db = useDb();
  const me = useCurrentUser();
  const { users, clients, categories } = useLookup();
  const { closeTask, openTaskForm } = useUI();
  const { confirm, dialog } = useConfirm();
  const [tab, setTab] = useState<'comments' | 'activity'>('comments');
  const [returning, setReturning] = useState(false);

  const client = clients.get(task.clientId);
  const category = categories.get(task.categoryId);
  const assignee = users.get(task.assigneeId);
  const reviewer = task.reviewerId ? users.get(task.reviewerId) : undefined;
  const editable = canEditTask(db, me, task);
  const workable = canWorkOnTask(db, me, task);
  const transitions = availableTransitions(db, me, task);
  const comments = db.comments.filter((c) => c.taskId === task.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const activity = db.activities.filter((a) => a.taskId === task.id);
  const lastReturn = db.reviews.filter((r) => r.taskId === task.id && r.decision === 'returned').sort((a, b) => b.decidedAt.localeCompare(a.decidedAt))[0];
  const done = task.checklist.filter((c) => c.done).length;
  const overdue = task.status !== 'completed' && daysUntil(task.dueDate) < 0;

  const doTransition = (t: Transition, note?: string) => {
    if (t.requiresNote && !note) {
      setReturning(true);
      return;
    }
    const incomplete = task.checklist.length - done;
    const go = () => {
      if (store.transitionTask(task.id, t.to, note)) {
        setReturning(false);
        const msg: Record<string, string> = {
          in_progress: 'Moved to In Progress',
          in_review: `Submitted to ${reviewer?.name ?? 'reviewer'}`,
          completed: t.label === 'Approve' ? 'Approved and completed' : 'Marked complete',
          changes_requested: 'Returned with changes requested',
          not_started: 'Moved to Not Started',
        };
        toast.success(msg[t.to]);
      }
    };
    if ((t.to === 'in_review' || (t.to === 'completed' && t.label !== 'Approve')) && incomplete > 0) {
      confirm({
        title: 'Checklist incomplete',
        description: `${incomplete} of ${task.checklist.length} checklist items are still open. ${t.to === 'in_review' ? 'Submit for review anyway?' : 'Complete anyway?'}`,
        confirmLabel: t.label,
        onConfirm: go,
      });
    } else go();
  };

  return (
    <div className="flex h-full flex-col">
      {dialog}
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-line px-5 py-3">
        <span className="shrink-0 whitespace-nowrap font-mono text-xs font-medium text-ink-500">{task.id}</span>
        {client && (
          <>
            <span className="text-ink-300">/</span>
            <Link to={`/clients/${client.id}`} onClick={closeTask} className="flex min-w-0 items-center gap-1 truncate text-xs font-medium text-ink-700 hover:text-brand-700">
              <Building2 className="size-3.5 shrink-0 text-ink-400" />
              <span className="truncate">{client.name}</span>
            </Link>
          </>
        )}
        <div className="ml-auto flex items-center gap-1">
          {editable && (
            <Button size="sm" variant="ghost" onClick={() => openTaskForm({ mode: 'edit', taskId: task.id })}>
              <Pencil /> Edit
            </Button>
          )}
          <Menu>
            <MenuTrigger asChild>
              <Button size="icon" variant="ghost" aria-label="More actions">
                <MoreHorizontal />
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuItem
                onSelect={() => {
                  void navigator.clipboard?.writeText(`${window.location.origin}/tasks?task=${task.id}`);
                  toast.success('Link copied');
                }}
              >
                <Link2 /> Copy link
              </MenuItem>
              <MenuItem
                onSelect={() => {
                  void navigator.clipboard?.writeText(task.id);
                  toast.success(`${task.id} copied`);
                }}
              >
                <Copy /> Copy task ID
              </MenuItem>
              {canDeleteTask(me) && (
                <>
                  <MenuSeparator />
                  <MenuItem
                    className="text-red-600 [&_svg]:!text-red-500"
                    onSelect={() =>
                      confirm({
                        title: `Delete ${task.id}?`,
                        description: 'The task, its comments and checklist will be permanently removed. This cannot be undone.',
                        confirmLabel: 'Delete task',
                        tone: 'danger',
                        onConfirm: () => {
                          if (store.deleteTask(task.id)) {
                            toast.success(`${task.id} deleted`);
                            closeTask();
                          }
                        },
                      })
                    }
                  >
                    <Trash2 /> Delete task
                  </MenuItem>
                </>
              )}
            </MenuContent>
          </Menu>
          <Button size="icon" variant="ghost" onClick={closeTask} aria-label="Close task">
            <X />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Title + workflow */}
        <div className="px-5 pb-4 pt-4">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <StatusBadge status={task.status} />
            <CategoryTag category={category} />
            {task.recurrence && (
              <span className="inline-flex h-5 items-center gap-1 rounded border border-line px-1.5 text-2xs font-medium text-ink-600">
                <Repeat className="size-3" /> {task.recurrence.periodLabel}
              </span>
            )}
          </div>
          <h2 className="text-lg font-semibold leading-snug tracking-tight text-ink-900">{task.title}</h2>

          {overdue && (
            <div className="mt-3 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              <AlertTriangle className="size-4 shrink-0" />
              Overdue by {-daysUntil(task.dueDate)} day{daysUntil(task.dueDate) === -1 ? '' : 's'} — was due {formatDate(task.dueDate)}.
            </div>
          )}
          {task.status === 'in_review' && (
            <div className="mt-3 flex items-center gap-2 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-800">
              <Clock className="size-4 shrink-0" />
              Awaiting review by <b className="font-semibold">{reviewer?.name ?? 'reviewer'}</b>
              {task.submittedAt && <> · submitted {timeAgo(task.submittedAt)}</>}
            </div>
          )}
          {task.status === 'changes_requested' && lastReturn && (
            <div className="mt-3 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-900">
              <div className="mb-0.5 flex items-center gap-1.5 font-semibold">
                <Undo2 className="size-3.5" /> Changes requested by {users.get(lastReturn.reviewerId)?.name} · {timeAgo(lastReturn.decidedAt)}
              </div>
              <p className="leading-relaxed">{lastReturn.note}</p>
            </div>
          )}
          {task.status === 'completed' && task.completedAt && (
            <div className="mt-3 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              <CheckCircle2 className="size-4 shrink-0" />
              Completed {formatDateTime(task.completedAt)}
              {task.requiresReview && ' · approved in review'}
            </div>
          )}

          {(transitions.length > 0 || returning) && (
            <div className="mt-4">
              {returning ? (
                <ReturnForm onCancel={() => setReturning(false)} onSubmit={(note) => doTransition(transitions.find((t) => t.requiresNote)!, note)} />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {transitions.map((t) => (
                    <Button key={t.to + t.label} variant={t.variant === 'danger' ? 'danger-outline' : t.variant} onClick={() => doTransition(t)}>
                      {t.to === 'in_review' && <Send />}
                      {t.label === 'Approve' && <Check />}
                      {t.to === 'changes_requested' && <Undo2 />}
                      {t.label}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}
          {!workable && !transitions.length && <p className="mt-3 text-xs text-ink-500">You have read-only access to this task.</p>}
        </div>

        {/* Properties */}
        <div className="grid grid-cols-1 gap-x-6 gap-y-0.5 border-y border-line bg-slate-50/50 px-5 py-3 sm:grid-cols-2">
          <Prop label="Assignee">
            {editable ? (
              <InlineSelect
                value={task.assigneeId}
                onChange={(v) => store.updateTask(task.id, { assigneeId: v }) && toast.success(`Reassigned to ${users.get(v)?.name}`)}
                options={[...assignableUsers(db, me), ...(assignableUsers(db, me).some((u) => u.id === task.assigneeId) ? [] : assignee ? [assignee] : [])].map((u) => ({
                  value: u.id,
                  label: u.name,
                }))}
                display={<UserLine user={assignee} />}
              />
            ) : (
              <UserLine user={assignee} />
            )}
          </Prop>
          <Prop label="Reviewer">
            {editable ? (
              <InlineSelect
                value={task.reviewerId ?? ''}
                onChange={(v) => {
                  if (v === task.assigneeId) return toast.error('Reviewer must be different from the assignee');
                  if (store.updateTask(task.id, { reviewerId: v || undefined, requiresReview: !!v })) toast.success(v ? `Reviewer set to ${users.get(v)?.name}` : 'Review no longer required');
                }}
                options={[{ value: '', label: 'No review required' }, ...reviewerCandidates(db).map((u) => ({ value: u.id, label: u.name }))]}
                display={reviewer ? <UserLine user={reviewer} /> : <span className="text-xs text-ink-500">No review required</span>}
              />
            ) : reviewer ? (
              <UserLine user={reviewer} />
            ) : (
              <span className="text-xs text-ink-500">No review required</span>
            )}
          </Prop>
          <Prop label="Due date">
            {editable ? (
              <label className="group relative flex cursor-pointer items-center gap-2 rounded px-1 -mx-1 py-0.5 hover:bg-white">
                <DueDate task={task} />
                <span className="text-2xs text-ink-400">{formatDate(task.dueDate, 'd MMM yyyy')}</span>
                <input
                  type="date"
                  value={task.dueDate}
                  aria-label="Change due date"
                  onChange={(e) => e.target.value && store.updateTask(task.id, { dueDate: e.target.value }) && toast.success('Due date updated')}
                  className="absolute inset-0 cursor-pointer opacity-0"
                />
              </label>
            ) : (
              <span className="flex items-center gap-2">
                <DueDate task={task} />
                <span className="text-2xs text-ink-400">{formatDate(task.dueDate, 'd MMM yyyy')}</span>
              </span>
            )}
          </Prop>
          <Prop label="Priority">
            {editable ? (
              <InlineSelect
                value={task.priority}
                onChange={(v) => store.updateTask(task.id, { priority: v as Task['priority'] }) && toast.success('Priority updated')}
                options={PRIORITY_ORDER.map((p) => ({ value: p, label: PRIORITY_META[p].label }))}
                display={<PriorityLabel priority={task.priority} />}
              />
            ) : (
              <PriorityLabel priority={task.priority} />
            )}
          </Prop>
          <Prop label="Start date">
            <span className="text-xs text-ink-800">{formatDate(task.startDate)}</span>
          </Prop>
          <Prop label="Estimated effort">
            <span className="text-xs text-ink-800">{task.estimateHours} hours</span>
          </Prop>
          <Prop label="Created">
            <span className="text-xs text-ink-800">
              {users.get(task.createdBy)?.name} · {formatDate(task.createdAt, 'd MMM')}
            </span>
          </Prop>
          <Prop label="Last updated">
            <span className="text-xs text-ink-800">
              {timeAgo(task.updatedAt)} by {users.get(task.updatedBy)?.name.split(' ')[0]}
            </span>
          </Prop>
        </div>

        {category?.isFiling && <FilingTracker task={task} canEdit={workable} />}

        <Section title="Description">
          {task.description ? (
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-700">{task.description}</p>
          ) : (
            <p className="text-[13px] text-ink-400">No description.</p>
          )}
        </Section>

        <Section
          title="Checklist"
          aside={
            task.checklist.length > 0 && (
              <span className="text-xs tabular-nums text-ink-500">
                {done}/{task.checklist.length}
              </span>
            )
          }
        >
          {task.checklist.length > 0 && <Progress value={(done / task.checklist.length) * 100} tone={done === task.checklist.length ? 'emerald' : 'brand'} className="mb-2" />}
          <ul className="space-y-0.5">
            {task.checklist.map((c) => (
              <li key={c.id} className="group flex items-center gap-2.5 rounded-md px-1.5 py-1 hover:bg-slate-50">
                <Checkbox id={c.id} checked={c.done} disabled={!workable} onCheckedChange={() => store.toggleChecklistItem(task.id, c.id)} />
                <label htmlFor={c.id} className={cn('flex-1 cursor-pointer text-[13px]', c.done ? 'text-ink-400 line-through' : 'text-ink-800')}>
                  {c.label}
                </label>
                {workable && (
                  <button
                    onClick={() => store.removeChecklistItem(task.id, c.id)}
                    className="rounded p-0.5 text-ink-300 opacity-0 hover:text-ink-600 focus:opacity-100 group-hover:opacity-100"
                    aria-label={`Remove ${c.label}`}
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {workable && <AddChecklistItem taskId={task.id} />}
          {!task.checklist.length && !workable && <p className="text-[13px] text-ink-400">No checklist items.</p>}
        </Section>

        <DocumentsSection task={task} canEdit={workable} />

        <div className="px-5 pt-2">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'comments', label: 'Comments', count: comments.length },
              { value: 'activity', label: 'Activity', count: activity.length },
            ]}
          />
        </div>
        <div className="px-5 py-4">
          {tab === 'comments' ? (
            <div className="space-y-4">
              {comments.length === 0 && <p className="text-[13px] text-ink-400">No comments yet. Start the conversation below.</p>}
              {comments.map((c) => {
                const author = users.get(c.authorId);
                return (
                  <div key={c.id} className="flex gap-3">
                    <Avatar user={author} size="sm" className="mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[13px] font-medium text-ink-900">{author?.name}</span>
                        <span className="text-2xs text-ink-400">{author && ROLE_META[author.role].short}</span>
                        <time className="ml-auto text-2xs text-ink-400" title={formatDateTime(c.createdAt)}>
                          {timeAgo(c.createdAt)}
                        </time>
                      </div>
                      <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-700">{c.body}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <Timeline items={activity} />
          )}
        </div>
      </div>

      {tab === 'comments' && <CommentComposer taskId={task.id} />}
    </div>
  );
}

function Prop({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center gap-3">
      <span className="w-28 shrink-0 text-xs text-ink-500">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function UserLine({ user }: { user?: { name: string; avatarHue: number; title?: string } }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Avatar user={user} size="xs" />
      <span className="truncate text-xs font-medium text-ink-800">{user?.name ?? 'Unassigned'}</span>
    </span>
  );
}

function InlineSelect({ value, onChange, options, display }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; display: ReactNode }) {
  return (
    <label className="relative -mx-1 flex cursor-pointer items-center rounded px-1 py-0.5 hover:bg-white focus-within:ring-2 focus-within:ring-brand-500/30">
      {display}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-b border-line px-5 py-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function ReturnForm({ onCancel, onSubmit }: { onCancel: () => void; onSubmit: (note: string) => void }) {
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const invalid = note.trim().length < 10;
  return (
    <div className="rounded-lg border border-orange-200 bg-orange-50/50 p-3">
      <label htmlFor="return-note" className="text-xs font-semibold text-ink-800">
        What needs to change?
      </label>
      <p className="mb-2 text-xs text-ink-500">This explanation is required and will be posted as a comment for the assignee.</p>
      <Textarea id="return-note" autoFocus value={note} onChange={(e) => setNote(e.target.value)} aria-invalid={touched && invalid} placeholder="e.g. The ITC on blocked credits needs to be reversed. Please attach the revised working." />
      {touched && invalid && <p className="mt-1 text-xs text-red-600">Please write at least 10 characters so the assignee knows what to fix.</p>}
      <div className="mt-2 flex justify-end gap-2">
        <Button size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={() => {
            setTouched(true);
            if (!invalid) onSubmit(note.trim());
          }}
        >
          <Undo2 /> Return to assignee
        </Button>
      </div>
    </div>
  );
}

function AddChecklistItem({ taskId }: { taskId: string }) {
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="mt-1 flex items-center gap-1.5 rounded px-1.5 py-1 text-xs font-medium text-ink-500 hover:text-brand-700">
        <Plus className="size-3.5" /> Add item
      </button>
    );
  const submit = () => {
    if (!value.trim()) return setOpen(false);
    store.addChecklistItem(taskId, value);
    setValue('');
  };
  return (
    <form
      className="mt-1 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="New checklist item" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} />
      <Button type="submit" size="md" variant="primary">
        Add
      </Button>
    </form>
  );
}

function FilingTracker({ task, canEdit }: { task: Task; canEdit: boolean }) {
  const stage = task.filingStage ?? 'preparation';
  const idx = FILING_STAGES.indexOf(stage);
  const [ref, setRef] = useState(task.filingReference ?? '');
  const blocked = task.requiresReview && task.status !== 'completed';
  return (
    <Section
      title="Filing status"
      aside={<span className="text-2xs text-ink-400">Tracked separately from internal task status</span>}
    >
      <ol className="flex items-center gap-1">
        {FILING_STAGES.map((s, i) => {
          const reached = i <= idx;
          const lockedForReview = blocked && (s === 'ready_to_file' || s === 'filed');
          return (
            <li key={s} className="flex flex-1 items-center gap-1">
              <Tooltip content={lockedForReview ? 'Available after review approval' : canEdit ? `Set to ${FILING_META[s]}` : FILING_META[s]}>
                <button
                  disabled={!canEdit || s === stage || lockedForReview}
                  onClick={() => store.setFilingStage(task.id, s) && toast.success(`Filing status: ${FILING_META[s]}`)}
                  className={cn(
                    'flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-2xs font-medium transition-colors disabled:cursor-default',
                    reached ? (s === 'filed' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-brand-200 bg-brand-50 text-brand-700') : 'border-line bg-white text-ink-500',
                    canEdit && !lockedForReview && s !== stage && 'hover:border-brand-300 hover:text-brand-700',
                    lockedForReview && 'opacity-60',
                  )}
                >
                  {reached && <Check className="size-3" />}
                  {FILING_META[s]}
                </button>
              </Tooltip>
              {i < FILING_STAGES.length - 1 && <span className={cn('h-px w-2 shrink-0', i < idx ? 'bg-brand-300' : 'bg-line')} />}
            </li>
          );
        })}
      </ol>
      {stage === 'filed' && (
        <div className="mt-3 flex items-center gap-2">
          <span className="shrink-0 text-xs text-ink-500">Acknowledgement no.</span>
          {canEdit ? (
            <Input
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              onBlur={() => ref !== (task.filingReference ?? '') && store.setFilingStage(task.id, 'filed', ref) && toast.success('Reference saved')}
              placeholder="Enter acknowledgement / ARN"
              className="h-7 max-w-64 font-mono text-xs"
            />
          ) : (
            <span className="font-mono text-xs text-ink-800">{task.filingReference ?? '—'}</span>
          )}
        </div>
      )}
    </Section>
  );
}

function DocumentsSection({ task, canEdit }: { task: Task; canEdit: boolean }) {
  const db = useDb();
  const me = useCurrentUser();
  const { users } = useLookup();
  const fileRef = useRef<HTMLInputElement>(null);
  const [requesting, setRequesting] = useState(false);
  const [docName, setDocName] = useState('');
  const client = db.clients.find((c) => c.id === task.clientId);
  const requests = db.documents.filter((d) => d.taskId === task.id);
  const canDocs = client ? canManageDocuments(db, me, client) : false;
  const pending = requests.filter((r) => r.status === 'pending').length;

  return (
    <Section
      title="Documents"
      aside={
        <div className="flex items-center gap-1">
          {canDocs && (
            <Button size="sm" variant="ghost" onClick={() => setRequesting((v) => !v)}>
              <Plus /> Request
            </Button>
          )}
          {canEdit && (
            <>
              <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()}>
                <Upload /> Upload
              </Button>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                multiple
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  files.forEach((f) => store.addAttachment(task.id, { name: f.name, sizeKb: f.size / 1024 }));
                  if (files.length) toast.success(`${files.length} file${files.length > 1 ? 's' : ''} attached`, { description: 'Demo mode stores file details only, not file contents.' });
                  e.target.value = '';
                }}
              />
            </>
          )}
        </div>
      }
    >
      {requesting && (
        <form
          className="mb-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (store.requestDocument({ clientId: task.clientId, taskId: task.id, name: docName, dueDate: task.dueDate })) {
              toast.success('Document requested', { description: 'Logged in-app. No email is sent in demo mode.' });
              setDocName('');
              setRequesting(false);
            }
          }}
        >
          <Input autoFocus value={docName} onChange={(e) => setDocName(e.target.value)} placeholder="e.g. Purchase register for September" />
          <Button type="submit" variant="primary" disabled={!docName.trim()}>
            Request
          </Button>
        </form>
      )}

      {requests.length > 0 && (
        <div className="mb-3">
          <p className="mb-1.5 text-xs font-medium text-ink-600">
            Requested from client {pending > 0 && <span className="text-amber-700">· {pending} pending</span>}
          </p>
          <ul className="divide-y divide-line rounded-md border border-line">
            {requests.map((r) => (
              <li key={r.id} className="flex items-center gap-2.5 px-3 py-2">
                {r.status === 'received' ? <CheckCircle2 className="size-4 text-emerald-500" /> : <Clock className="size-4 text-amber-500" />}
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink-800">{r.name}</span>
                <span className="text-2xs text-ink-400">{r.status === 'received' ? `Received ${formatDate(r.receivedAt, 'd MMM')}` : `Requested ${formatDate(r.requestedAt, 'd MMM')}`}</span>
                {canDocs && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => store.setDocumentStatus(r.id, r.status === 'received' ? 'pending' : 'received') && toast.success(r.status === 'received' ? 'Marked pending' : 'Marked received')}
                  >
                    {r.status === 'received' ? 'Undo' : 'Mark received'}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {task.attachments.length > 0 ? (
        <ul className="grid gap-2 sm:grid-cols-2">
          {task.attachments.map((a) => (
            <li key={a.id} className="group flex items-center gap-2.5 rounded-md border border-line px-2.5 py-2">
              <span className="flex size-8 shrink-0 items-center justify-center rounded bg-slate-100 text-ink-500">
                <Paperclip className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-ink-800" title={a.name}>
                  {a.name}
                </p>
                <p className="text-2xs text-ink-400">
                  {formatFileSize(a.sizeKb)} · {users.get(a.uploadedBy)?.name.split(' ')[0]} · {formatDate(a.uploadedAt, 'd MMM')}
                </p>
              </div>
              {canEdit && (
                <button onClick={() => store.removeAttachment(task.id, a.id)} className="rounded p-1 text-ink-300 opacity-0 hover:text-red-600 focus:opacity-100 group-hover:opacity-100" aria-label={`Remove ${a.name}`}>
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        !requests.length && <p className="text-[13px] text-ink-400">No documents yet.</p>
      )}
    </Section>
  );
}

function Timeline({ items }: { items: ReturnType<typeof useDb>['activities'] }) {
  const { users } = useLookup();
  const text = useActivityText();
  const sorted = useMemo(() => [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [items]);
  if (!sorted.length) return <p className="text-[13px] text-ink-400">No activity yet.</p>;
  return (
    <ol className="relative space-y-3 before:absolute before:bottom-2 before:left-3 before:top-2 before:w-px before:bg-line">
      {sorted.map((a) => (
        <li key={a.id} className="relative flex gap-3">
          <ActivityIcon type={a.type} />
          <div className="min-w-0 flex-1 pt-0.5 text-[13px] leading-snug text-ink-600">
            <span className="font-medium text-ink-900">{users.get(a.actorId)?.name}</span> {text(a)}
            <div className="text-2xs text-ink-400" title={formatDateTime(a.createdAt)}>
              {formatDateTime(a.createdAt)}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function CommentComposer({ taskId }: { taskId: string }) {
  const me = useCurrentUser();
  const [body, setBody] = useState('');
  const submit = () => {
    if (!body.trim()) return;
    if (store.addComment(taskId, body)) setBody('');
  };
  return (
    <div className="border-t border-line bg-white px-5 py-3">
      <div className="flex gap-3">
        <Avatar user={me} size="sm" className="mt-1" />
        <div className="flex-1">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Write a comment…"
            className="min-h-[56px] resize-none"
            aria-label="Comment"
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="hidden items-center gap-1 text-2xs text-ink-400 sm:flex">
              <Kbd>Ctrl</Kbd>+<Kbd>Enter</Kbd> to send
            </span>
            <Button size="sm" variant="primary" onClick={submit} disabled={!body.trim()} className="ml-auto">
              <Send /> Comment
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function OpenTaskLink({ task, className }: { task: Task; className?: string }) {
  const { openTask } = useUI();
  return (
    <button onClick={() => openTask(task.id)} className={cn('inline-flex items-center gap-1 text-left hover:text-brand-700', className)}>
      {task.title}
      <ArrowUpRight className="size-3 opacity-0 group-hover:opacity-100" />
    </button>
  );
}
