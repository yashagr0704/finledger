import { useMemo, useState } from 'react';
import { differenceInHours, parseISO } from 'date-fns';
import { Check, CheckCircle2, ClipboardCheck, Hourglass, Inbox, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, EmptyState, PageHeader, Segmented } from '@/components/ui/misc';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/form';
import { Avatar, CategoryTag, DueDate, StatusBadge } from '@/components/badges';
import { timeAgo } from '@/lib/dates';
import { useLookup } from '@/lib/lookup';
import { formatHours, reviewTurnaround } from '@/lib/metrics';
import { canReview, canReviewTask, visibleTasks } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { store, useCurrentUser, useDb } from '@/store/store';
import { useUI } from '@/store/ui';
import type { Task } from '@/types';

export default function ReviewQueue() {
  const db = useDb();
  const me = useCurrentUser();
  const { users } = useLookup();
  const reviewer = canReview(me);
  const [scope, setScope] = useState<'mine' | 'all'>(me.role === 'admin' ? 'all' : 'mine');
  const [returning, setReturning] = useState<Task | null>(null);

  const scoped = useMemo(() => visibleTasks(db, me), [db, me]);
  const pending = scoped
    .filter((t) => t.status === 'in_review')
    .filter((t) => (reviewer ? (scope === 'mine' ? t.reviewerId === me.id : true) : t.assigneeId === me.id))
    .sort((a, b) => (a.submittedAt ?? '').localeCompare(b.submittedAt ?? ''));
  const returned = scoped.filter((t) => t.status === 'changes_requested').filter((t) => (reviewer ? (scope === 'mine' ? t.reviewerId === me.id : true) : t.assigneeId === me.id));
  const visibleIds = new Set(scoped.map((t) => t.id));
  const decided = db.reviews
    .filter((r) => visibleIds.has(r.taskId) && (reviewer ? (scope === 'mine' ? r.reviewerId === me.id : true) : db.tasks.find((t) => t.id === r.taskId)?.assigneeId === me.id))
    .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt))
    .slice(0, 10);
  const tat = reviewTurnaround(db, (id) => visibleIds.has(id));
  const oldest = pending[0]?.submittedAt ? differenceInHours(new Date(), parseISO(pending[0].submittedAt)) : 0;

  return (
    <div className="animate-slide-up">
      <PageHeader
        title="Review Queue"
        description={reviewer ? 'Approve submitted work or return it with clear feedback.' : 'Your submissions and work returned for changes.'}
        actions={
          reviewer && (
            <Segmented
              value={scope}
              onChange={setScope}
              options={[
                { value: 'mine', label: 'Assigned to me' },
                { value: 'all', label: me.role === 'admin' ? 'All reviewers' : 'My team' },
              ]}
            />
          )
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <MiniStat label="Awaiting review" value={pending.length} icon={<ClipboardCheck />} tone="text-violet-600 bg-violet-50" />
        <MiniStat label="Oldest submission" value={pending.length ? formatHours(oldest) : '—'} icon={<Hourglass />} tone={oldest > 48 ? 'text-red-600 bg-red-50' : 'text-amber-600 bg-amber-50'} />
        <MiniStat label="Returned for changes" value={returned.length} icon={<Undo2 />} tone="text-orange-600 bg-orange-50" />
        <MiniStat label="Avg. turnaround" value={tat.count ? formatHours(tat.avgHours) : '—'} icon={<CheckCircle2 />} tone="text-emerald-600 bg-emerald-50" hint={`${tat.returnedPct}% returned`} />
      </div>

      <Card>
        <CardHeader title={reviewer ? 'Waiting for a decision' : 'Submitted by you'} description="Oldest submissions first" />
        {pending.length === 0 ? (
          <EmptyState compact icon={<Inbox />} title="Queue is clear" description={reviewer ? 'Nothing is waiting for your review right now.' : 'You have no submissions waiting for review.'} />
        ) : (
          <ul className="divide-y divide-line">
            {pending.map((t) => (
              <ReviewRow key={t.id} task={t} onReturn={() => setReturning(t)} canDecide={canReviewTask(me, t)} />
            ))}
          </ul>
        )}
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Returned for changes" description="Waiting on the assignee" />
          {returned.length === 0 ? (
            <EmptyState compact icon={<CheckCircle2 />} title="No returned work" />
          ) : (
            <ul className="divide-y divide-line">
              {returned.map((t) => {
                const last = db.reviews.filter((r) => r.taskId === t.id && r.decision === 'returned').sort((a, b) => b.decidedAt.localeCompare(a.decidedAt))[0];
                return <SimpleRow key={t.id} task={t} note={last?.note} meta={last ? `Returned ${timeAgo(last.decidedAt)} by ${users.get(last.reviewerId)?.name}` : undefined} />;
              })}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Recent decisions" />
          {decided.length === 0 ? (
            <EmptyState compact icon={<Inbox />} title="No decisions yet" />
          ) : (
            <ul className="divide-y divide-line">
              {decided.map((r) => {
                const t = db.tasks.find((x) => x.id === r.taskId);
                if (!t) return null;
                return (
                  <SimpleRow
                    key={r.id}
                    task={t}
                    meta={`${r.decision === 'approved' ? 'Approved' : 'Returned'} by ${users.get(r.reviewerId)?.name} · ${timeAgo(r.decidedAt)} · ${formatHours(differenceInHours(parseISO(r.decidedAt), parseISO(r.submittedAt)))} turnaround`}
                    decision={r.decision}
                  />
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <ReturnDialog task={returning} onClose={() => setReturning(null)} />
    </div>
  );
}

function MiniStat({ label, value, icon, tone, hint }: { label: string; value: number | string; icon: React.ReactNode; tone: string; hint?: string }) {
  return (
    <Card className="flex items-center gap-3 p-3.5">
      <span className={cn('flex size-8 items-center justify-center rounded-md [&_svg]:size-4', tone)}>{icon}</span>
      <div className="min-w-0">
        <p className="text-lg font-semibold leading-tight tabular-nums text-ink-900">{value}</p>
        <p className="truncate text-2xs text-ink-500">
          {label}
          {hint && <> · {hint}</>}
        </p>
      </div>
    </Card>
  );
}

function ReviewRow({ task, onReturn, canDecide }: { task: Task; onReturn: () => void; canDecide: boolean }) {
  const { users, clients, categories } = useLookup();
  const { openTask } = useUI();
  const assignee = users.get(task.assigneeId);
  const reviewer = task.reviewerId ? users.get(task.reviewerId) : undefined;
  const done = task.checklist.filter((c) => c.done).length;
  const waited = task.submittedAt ? differenceInHours(new Date(), parseISO(task.submittedAt)) : 0;
  return (
    <li className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center">
      <button onClick={() => openTask(task.id)} className="flex min-w-0 flex-1 items-start gap-3 text-left">
        <Avatar user={assignee} size="md" />
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-ink-900 hover:text-brand-700">{task.title}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
            <span className="font-mono text-2xs">{task.id}</span>
            <span>{clients.get(task.clientId)?.name}</span>
            <CategoryTag category={categories.get(task.categoryId)} className="h-4" />
          </p>
          <p className="mt-1 text-2xs text-ink-500">
            {assignee?.name} submitted {task.submittedAt ? timeAgo(task.submittedAt) : ''} · reviewer {reviewer?.name ?? '—'} · checklist {done}/{task.checklist.length} · {task.attachments.length} file{task.attachments.length === 1 ? '' : 's'}
          </p>
        </div>
      </button>
      <div className="flex shrink-0 items-center gap-3 md:justify-end">
        <span className={cn('text-2xs font-medium tabular-nums', waited > 48 ? 'text-red-600' : waited > 24 ? 'text-amber-700' : 'text-ink-500')}>waiting {formatHours(waited)}</span>
        <DueDate task={task} />
        {canDecide ? (
          <>
            <Button size="sm" variant="danger-outline" onClick={onReturn}>
              <Undo2 /> Return
            </Button>
            <Button
              size="sm"
              variant="success"
              onClick={() => store.transitionTask(task.id, 'completed') && toast.success(`${task.id} approved`, { description: 'Marked as completed. Filing (if any) is now Ready to File.' })}
            >
              <Check /> Approve
            </Button>
          </>
        ) : (
          <StatusBadge status={task.status} />
        )}
      </div>
    </li>
  );
}

function SimpleRow({ task, note, meta, decision }: { task: Task; note?: string; meta?: string; decision?: 'approved' | 'returned' }) {
  const { openTask } = useUI();
  const { users } = useLookup();
  return (
    <li>
      <button onClick={() => openTask(task.id)} className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-slate-50">
        {decision ? (
          decision === 'approved' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" /> : <Undo2 className="mt-0.5 size-4 shrink-0 text-orange-500" />
        ) : (
          <Avatar user={users.get(task.assigneeId)} size="sm" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-ink-900">{task.title}</p>
          {meta && <p className="truncate text-2xs text-ink-500">{meta}</p>}
          {note && <p className="mt-0.5 line-clamp-2 text-xs text-orange-800">“{note}”</p>}
        </div>
        <DueDate task={task} />
      </button>
    </li>
  );
}

function ReturnDialog({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const invalid = note.trim().length < 10;
  return (
    <Dialog
      open={!!task}
      onOpenChange={(v) => {
        if (!v) {
          onClose();
          setNote('');
          setTouched(false);
        }
      }}
    >
      {task && (
        <DialogContent title="Request changes" description={`${task.id} · ${task.title}`} size="sm">
          <DialogBody>
            <label htmlFor="rq-note" className="text-xs font-medium text-ink-700">
              Explain what needs to change <span className="text-red-500">*</span>
            </label>
            <Textarea id="rq-note" autoFocus className="mt-1.5 min-h-[110px]" value={note} onChange={(e) => setNote(e.target.value)} aria-invalid={touched && invalid} placeholder="Be specific so the assignee can fix it in one pass." />
            {touched && invalid && <p className="mt-1 text-xs text-red-600">Please write at least 10 characters.</p>}
          </DialogBody>
          <DialogFooter>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                setTouched(true);
                if (invalid) return;
                if (store.transitionTask(task.id, 'changes_requested', note)) {
                  toast.success(`${task.id} returned to assignee`);
                  setNote('');
                  setTouched(false);
                  onClose();
                }
              }}
            >
              <Undo2 /> Return with comments
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
