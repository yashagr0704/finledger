import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Cell, Pie, PieChart, Tooltip as RTooltip } from 'recharts';
import { addDays, format, subMonths } from 'date-fns';
import {
  AlarmClock,
  AlertTriangle,
  ArrowRight,
  Bell,
  Building2,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileQuestion,
  FolderPlus,
  Inbox,
  IndianRupee,
  ListTodo,
  Pin,
  Plus,
  RefreshCw,
  StickyNote,
  Undo2,
  UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { Card, CardHeader, EmptyState, PageHeader, Segmented } from '@/components/ui/misc';
import { KpiCard } from '@/components/KpiCard';
import { ActivityFeed } from '@/components/activity';
import { Avatar, DueDate } from '@/components/badges';
import { ChartTooltip } from '@/components/charts/ChartParts';
import { TaskListItem } from '@/components/tasks/TaskList';
import { NotificationItem } from '@/components/layout/NotificationItem';
import { DueBoard } from '@/components/dashboard/DueBoard';
import { DeadlineCalendar } from '@/components/dashboard/DeadlineCalendar';
import { ROLE_META } from '@/lib/constants';
import { formatDate, toDateKey, todayKey } from '@/lib/dates';
import { billingSummary, inrShort } from '@/lib/billing';
import { periodOf } from '@/lib/buckets';
import { byUrgency, completedInMonth, isOpen, isOverdue } from '@/lib/metrics';
import { canAccessBilling, canCreateClient, canCreateTask, canManageTeam, canReviewTask, permissionsOf, visibleClients, visibleTasks } from '@/lib/permissions';
import { cn, percent, pluralize } from '@/lib/utils';
import { useCurrentUser, useDb } from '@/store/store';
import { useUI } from '@/store/ui';
import type { Task } from '@/types';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

const pctChange = (now: number, before: number) => (before ? Math.round(((now - before) / before) * 100) : now ? 100 : 0);


export default function Overview() {
  const me = useCurrentUser();
  return me.role === 'employee' ? <EmployeeDashboard /> : <FirmDashboard />;
}

function RefreshStamp() {
  const [at, setAt] = useState(new Date());
  return (
    <button
      onClick={() => {
        setAt(new Date());
        toast.success('Dashboard refreshed');
      }}
      className="inline-flex items-center gap-1.5 text-xs text-ink-500 hover:text-ink-900"
      title="Refresh"
    >
      Last refreshed at {format(at, 'd MMM yyyy, h:mm:ss a')}
      <RefreshCw className="size-3" />
    </button>
  );
}

// ---------------------------------------------------------------- firm view

function FirmDashboard() {
  const db = useDb();
  const me = useCurrentUser();
  const { openTaskForm, openClientForm, setInviteOpen } = useUI();
  const navigate = useNavigate();
  const [viewAs, setViewAs] = useState('all');

  const scoped = useMemo(() => visibleTasks(db, me), [db, me]);
  const tasks = useMemo(() => (viewAs === 'all' ? scoped : scoped.filter((t) => t.assigneeId === viewAs)), [scoped, viewAs]);
  const people = db.users.filter((u) => u.status === 'active' && scoped.some((t) => t.assigneeId === u.id));
  const open = tasks.filter(isOpen);
  const overdue = open.filter(isOverdue).sort(byUrgency);
  const weekEnd = toDateKey(addDays(new Date(), 7));
  const dueWeek = open.filter((t) => t.dueDate >= todayKey() && t.dueDate <= weekEnd);
  const review = open.filter((t) => t.status === 'in_review');
  const doneThisMonth = tasks.filter((t) => completedInMonth(t)).length;
  const doneLastMonth = tasks.filter((t) => completedInMonth(t, subMonths(new Date(), 1))).length;
  const clients = visibleClients(db, me);
  const activeClients = clients.filter((c) => !c.exitDate);
  const joinedYear = activeClients.filter((c) => c.since >= toDateKey(subMonths(new Date(), 12))).length;
  const scopeLabel = viewAs === 'all' ? (me.role === 'admin' || permissionsOf(me).viewAllTasks ? 'Firm-wide' : 'Your clients & team') : `Viewing as ${db.users.find((u) => u.id === viewAs)?.name}`;

  return (
    <div className="animate-slide-up">
      <PageHeader
        title="Dashboard"
        description={
          <span className="flex flex-wrap items-center gap-x-2">
            <span>
              {greeting()}, {me.name.split(' ')[0]} · {scopeLabel}
            </span>
            <span className="text-ink-300">|</span>
            <RefreshStamp />
          </span>
        }
        actions={
          <>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-ink-500">View as</span>
              <div className="w-44">
                <Select value={viewAs} onChange={(e) => setViewAs(e.target.value)} aria-label="View dashboard as">
                  <option value="all">{ROLE_META[me.role].short} (everyone)</option>
                  {people.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            {canManageTeam(me) && (
              <Button onClick={() => setInviteOpen(true)}>
                <UserPlus /> Invite
              </Button>
            )}
            {canCreateClient(me) && (
              <Button onClick={() => openClientForm()}>
                <FolderPlus /> Add client
              </Button>
            )}
            {canCreateTask(me) && (
              <Button variant="primary" onClick={() => openTaskForm({ mode: 'create' })}>
                <Plus /> New task
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Total clients" value={activeClients.length} icon={<Building2 />} tone="neutral" to="/clients" hint={`+${joinedYear} in 12 months · ${clients.length - activeClients.length} exited`} />
        <KpiCard label="Active tasks" value={open.length} icon={<ListTodo />} tone="brand" to="/tasks?status=open" hint={`${open.filter((t) => t.status === 'in_progress').length} in progress · ${open.filter((t) => t.status === 'not_started').length} not started`} />
        <KpiCard label="Due this week" value={dueWeek.length} icon={<Clock />} tone="amber" to="/tasks?due=week&status=open" hint={`${open.filter((t) => t.dueDate === todayKey()).length} due today`} />
        <KpiCard
          label="Overdue"
          value={overdue.length}
          icon={<AlertTriangle />}
          tone="red"
          to="/tasks?due=overdue"
          emphasize={overdue.length > 0}
          hint={overdue.length ? `Oldest: ${formatDate(overdue[0].dueDate, 'd MMM')}` : 'Nothing overdue'}
        />
        <KpiCard label="Awaiting review" value={review.length} icon={<ClipboardCheck />} tone="violet" to="/review" hint={`${review.filter((t) => canReviewTask(me, t)).length} assigned to you`} />
        <KpiCard
          label="Completed this month"
          value={doneThisMonth}
          icon={<CheckCircle2 />}
          tone="emerald"
          to="/tasks?status=completed&completed=month"
          trend={{ pct: pctChange(doneThisMonth, doneLastMonth), goodWhenUp: true }}
          hint={`${doneLastMonth} in ${format(subMonths(new Date(), 1), 'MMMM')}`}
        />
      </div>

      <div className="mt-4">
        <DueBoard tasks={tasks} title="All pending tasks" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <TaskOverview tasks={tasks} />
        <ComplianceDue tasks={open} />
        <TeamPerformance tasks={tasks} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader
            title="Deadline calendar"
            description="Dots show how close each deadline is"
            icon={<CalendarDays />}
            action={
              <Button size="sm" variant="ghost" onClick={() => navigate('/calendar?view=dots')}>
                Full view <ArrowRight />
              </Button>
            }
          />
          <DeadlineCalendar tasks={tasks} />
        </Card>
        <div className="space-y-4">
          {canAccessBilling(me) && <BillingSnapshot />}
          <PendingDocs clientIds={new Set(clients.map((c) => c.id))} />
        </div>
        <Card>
          <CardHeader title="Recent activity" description={scopeLabel} />
          <ActivityFeed
            items={db.activities.filter((a) => me.role === 'admin' || (a.taskId && scoped.some((t) => t.id === a.taskId))).slice(0, 10)}
            empty={<EmptyState compact icon={<Inbox />} title="No activity yet" />}
          />
        </Card>
      </div>
    </div>
  );
}

const DONUT = [
  { key: 'completed', label: 'Completed', color: '#10b981' },
  { key: 'progress', label: 'In progress', color: '#3b82f6' },
  { key: 'review', label: 'In review', color: '#8b5cf6' },
  { key: 'pending', label: 'Pending', color: '#f59e0b' },
] as const;

function TaskOverview({ tasks }: { tasks: Task[] }) {
  const navigate = useNavigate();
  const month = format(new Date(), 'yyyy-MM');
  // This month's workload: everything open plus what was completed this month.
  const relevant = tasks.filter((t) => isOpen(t) || t.completedAt?.slice(0, 7) === month);
  const counts = {
    completed: relevant.filter((t) => t.status === 'completed').length,
    progress: relevant.filter((t) => t.status === 'in_progress').length,
    review: relevant.filter((t) => t.status === 'in_review').length,
    pending: relevant.filter((t) => t.status === 'not_started' || t.status === 'changes_requested').length,
  };
  const data = DONUT.map((d) => ({ name: d.label, value: counts[d.key], color: d.color }));
  const links = { completed: '/tasks?status=completed&completed=month', progress: '/tasks?status=in_progress', review: '/review', pending: '/tasks?status=not_started,changes_requested' };
  return (
    <Card>
      <CardHeader title="Task overview" description={`${format(new Date(), 'MMMM')} workload · ${relevant.length} tasks`} />
      <div className="flex items-center gap-4 px-4 py-4">
        <div className="relative size-36 shrink-0">
          <PieChart width={144} height={144}>
              <Pie isAnimationActive={false} data={data} dataKey="value" nameKey="name" innerRadius={44} outerRadius={66} paddingAngle={2} stroke="#fff" strokeWidth={2} startAngle={90} endAngle={-270}>
                {data.map((d) => (
                  <Cell key={d.name} fill={d.color} />
                ))}
              </Pie>
              <RTooltip content={<ChartTooltip />} />
          </PieChart>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-semibold tabular-nums text-ink-900">{percent(counts.completed, relevant.length)}%</span>
            <span className="text-2xs text-ink-500">done</span>
          </div>
        </div>
        <ul className="flex-1 space-y-2">
          {DONUT.map((d) => (
            <li key={d.key}>
              <button onClick={() => navigate(links[d.key])} className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-slate-50">
                <span className="size-2.5 rounded-full" style={{ background: d.color }} />
                <span className="flex-1 text-ink-700">{d.label}</span>
                <span className="font-semibold tabular-nums text-ink-900">{counts[d.key]}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function ComplianceDue({ tasks }: { tasks: Task[] }) {
  const db = useDb();
  const services = new Map(db.services.map((s) => [s.id, s]));
  const navigate = useNavigate();
  // Group upcoming open work by service + period + due date: "GSTR-3B · Sep 2026 — 4 clients".
  const groups = new Map<string, { label: string; period: string; due: string; tasks: Task[] }>();
  tasks
    .filter((t) => t.dueDate >= todayKey())
    .forEach((t) => {
      const svc = t.serviceId ? services.get(t.serviceId)?.name : undefined;
      const label = svc ?? t.title;
      const key = `${label}|${periodOf(t)}|${t.dueDate}`;
      const g = groups.get(key) ?? { label, period: periodOf(t), due: t.dueDate, tasks: [] };
      g.tasks.push(t);
      groups.set(key, g);
    });
  const list = [...groups.values()].sort((a, b) => a.due.localeCompare(b.due)).slice(0, 7);
  return (
    <Card>
      <CardHeader
        title="Compliance due"
        description="Upcoming filings by service"
        action={
          <Button size="sm" variant="ghost" onClick={() => navigate('/calendar?view=agenda')}>
            View all <ArrowRight />
          </Button>
        }
      />
      {list.length ? (
        <ul className="divide-y divide-line">
          {list.map((g) => (
            <li key={g.label + g.period + g.due} className="flex items-center gap-3 px-4 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-ink-900">
                  {g.label} {g.period !== '—' && <span className="font-normal text-ink-500">· {g.period}</span>}
                </p>
                <p className="text-2xs text-ink-500">{pluralize(new Set(g.tasks.map((t) => t.clientId)).size, 'client')}</p>
              </div>
              <span className={cn('shrink-0 text-xs font-medium tabular-nums', g.due < todayKey() ? 'text-red-600' : g.due === todayKey() ? 'text-amber-700' : 'text-ink-700')}>{formatDate(g.due, 'd MMM yyyy')}</span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState compact icon={<CheckCircle2 />} title="Nothing due" />
      )}
    </Card>
  );
}

function TeamPerformance({ tasks }: { tasks: Task[] }) {
  const db = useDb();
  const navigate = useNavigate();
  const month = format(new Date(), 'yyyy-MM');
  const rows = db.users
    .filter((u) => u.status === 'active')
    .map((u) => {
      const mine = tasks.filter((t) => t.assigneeId === u.id && (isOpen(t) || t.completedAt?.slice(0, 7) === month));
      return { user: u, done: mine.filter((t) => !isOpen(t)).length, total: mine.length, overdue: mine.filter(isOverdue).length };
    })
    .filter((r) => r.total)
    .sort((a, b) => b.done / b.total - a.done / a.total);
  return (
    <Card>
      <CardHeader
        title="Team performance"
        description="Tasks completed this month / assigned"
        action={
          <Button size="sm" variant="ghost" onClick={() => navigate('/team')}>
            View all <ArrowRight />
          </Button>
        }
      />
      <ul className="divide-y divide-line">
        {rows.slice(0, 7).map((r) => (
          <li key={r.user.id}>
            <Link to={`/team/${r.user.id}`} className="flex items-center gap-3 px-4 py-2 hover:bg-slate-50">
              <Avatar user={r.user} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-xs font-medium text-ink-800">{r.user.name}</span>
                  <span className="shrink-0 text-2xs tabular-nums text-ink-500">
                    {r.done}/{r.total}
                    {r.overdue > 0 && <span className="text-red-600"> · {r.overdue} late</span>}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-brand-500" style={{ width: `${percent(r.done, r.total)}%` }} />
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function BillingSnapshot() {
  const db = useDb();
  const b = billingSummary(db);
  return (
    <Card>
      <CardHeader
        title="Billing snapshot"
        icon={<IndianRupee />}
        action={
          <Link to="/billing" className="text-xs font-medium text-brand-700 hover:underline">
            Open billing
          </Link>
        }
      />
      <div className="grid grid-cols-2 divide-x divide-y divide-line">
        {[
          ['Unbilled work', b.unbilledValue, 'text-amber-700', '/billing?tab=unbilled'],
          ['Outstanding', b.outstanding, 'text-red-600', '/billing?tab=billed'],
          ['Billed this month', b.billedThisMonth, 'text-ink-900', '/billing?tab=billed'],
          ['Collected this month', b.collectedThisMonth, 'text-emerald-700', '/billing?tab=ledger'],
        ].map(([label, v, tone, to]) => (
          <Link key={label as string} to={to as string} className="px-4 py-2.5 hover:bg-slate-50">
            <p className={cn('text-lg font-semibold tabular-nums', tone as string)}>{inrShort(v as number)}</p>
            <p className="text-2xs text-ink-500">{label}</p>
          </Link>
        ))}
      </div>
    </Card>
  );
}

function PendingDocs({ clientIds }: { clientIds: Set<string> }) {
  const db = useDb();
  const docClients = db.clients
    .filter((c) => clientIds.has(c.id))
    .map((c) => ({ client: c, pending: db.documents.filter((d) => d.clientId === c.id && d.status === 'pending') }))
    .filter((x) => x.pending.length)
    .sort((a, b) => b.pending.length - a.pending.length);
  return (
    <Card>
      <CardHeader title="Pending document requests" description={`${pluralize(docClients.length, 'client')} waiting`} icon={<FileQuestion />} />
      {docClients.length === 0 ? (
        <EmptyState compact icon={<FileQuestion />} title="No outstanding requests" />
      ) : (
        <ul className="divide-y divide-line">
          {docClients.slice(0, 5).map(({ client, pending }) => (
            <li key={client.id}>
              <Link to={`/clients/${client.id}?tab=documents`} className="flex items-center gap-3 px-4 py-2 hover:bg-slate-50">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-ink-900">{client.name}</p>
                  <p className="truncate text-2xs text-ink-500">{pending.map((d) => d.name).join(' · ')}</p>
                </div>
                <span className="shrink-0 text-xs font-medium tabular-nums text-amber-700">{pending.length}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ------------------------------------------------------------ employee view

function EmployeeDashboard() {
  const db = useDb();
  const me = useCurrentUser();
  const { openTask, openTaskForm } = useUI();
  const perms = permissionsOf(me);
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const mine = db.tasks.filter((t) => t.assigneeId === me.id);
  const boardTasks = scope === 'all' && perms.viewAllTasks ? visibleTasks(db, me) : mine;
  const open = mine.filter(isOpen).sort(byUrgency);
  const overdue = open.filter(isOverdue);
  const today = open.filter((t) => t.dueDate === todayKey());
  const upcoming = open.filter((t) => t.dueDate > todayKey() && t.dueDate <= toDateKey(addDays(new Date(), 7)));
  const returned = open.filter((t) => t.status === 'changes_requested');
  const inReview = open.filter((t) => t.status === 'in_review');
  const doneThisMonth = mine.filter((t) => completedInMonth(t)).length;
  const notifications = db.notifications.filter((n) => n.userId === me.id).slice(0, 4);
  const reminders = db.reminders.filter((r) => r.userId === me.id && !r.done).sort((a, b) => a.dueAt.localeCompare(b.dueAt)).slice(0, 4);
  const pinned = db.notes.filter((n) => n.userId === me.id && n.pinned).slice(0, 2);

  const focusLine =
    overdue.length > 0
      ? `You have ${pluralize(overdue.length, 'overdue task')} — start there.`
      : today.length > 0
        ? `${pluralize(today.length, 'task')} due today.`
        : open.length
          ? 'Nothing due today. A good moment to get ahead on upcoming work.'
          : 'Your queue is clear.';

  return (
    <div className="animate-slide-up">
      <PageHeader
        title={`${greeting()}, ${me.name.split(' ')[0]}`}
        description={
          <span className="flex flex-wrap items-center gap-x-2">
            <span>
              {format(new Date(), 'EEEE, d MMMM yyyy')} · {focusLine}
            </span>
            <span className="text-ink-300">|</span>
            <RefreshStamp />
          </span>
        }
        actions={
          <Button variant="primary" onClick={() => openTaskForm({ mode: 'create', defaults: { assigneeId: me.id } })}>
            <Plus /> {perms.createTaskForOthers ? 'New task' : 'New task for me'}
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Due today" value={today.length} icon={<Clock />} tone="amber" to={`/tasks?assignee=${me.id}&due=today`} />
        <KpiCard label="Overdue" value={overdue.length} icon={<AlertTriangle />} tone="red" emphasize={overdue.length > 0} to={`/tasks?assignee=${me.id}&due=overdue`} />
        <KpiCard label="Upcoming (7 days)" value={upcoming.length} icon={<CalendarDays />} tone="brand" to={`/tasks?assignee=${me.id}&due=week&status=open`} />
        <KpiCard label="Completed this month" value={doneThisMonth} icon={<CheckCircle2 />} tone="emerald" to={`/tasks?assignee=${me.id}&status=completed`} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {perms.viewAllTasks && (
            <div className="flex justify-end">
              <Segmented
                size="sm"
                value={scope}
                onChange={setScope}
                options={[
                  { value: 'mine', label: 'My pending tasks' },
                  { value: 'all', label: 'All pending tasks' },
                ]}
              />
            </div>
          )}
          <DueBoard tasks={boardTasks} title={scope === 'all' && perms.viewAllTasks ? 'All pending tasks' : 'My pending tasks'} />

          {(returned.length > 0 || inReview.length > 0) && (
            <div className="grid gap-4 md:grid-cols-2">
              <Card className={cn(returned.length > 0 && 'border-orange-200')}>
                <CardHeader title="Returned for changes" icon={<Undo2 />} />
                {returned.length ? (
                  <ul className="divide-y divide-line">
                    {returned.map((t) => {
                      const note = db.reviews.filter((r) => r.taskId === t.id && r.decision === 'returned').sort((a, b) => b.decidedAt.localeCompare(a.decidedAt))[0];
                      return (
                        <li key={t.id}>
                          <button onClick={() => openTask(t.id)} className="block w-full px-4 py-2.5 text-left hover:bg-slate-50">
                            <span className="flex items-center justify-between gap-2">
                              <span className="truncate text-[13px] font-medium text-ink-900">{t.title}</span>
                              <DueDate task={t} />
                            </span>
                            {note?.note && <span className="mt-0.5 line-clamp-2 block text-xs text-orange-800">“{note.note}”</span>}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <EmptyState compact icon={<CheckCircle2 />} title="No returned work" />
                )}
              </Card>
              <Card>
                <CardHeader title="Awaiting review" icon={<ClipboardCheck />} />
                {inReview.length ? (
                  <ul className="divide-y divide-line">
                    {inReview.map((t) => (
                      <TaskListItem key={t.id} task={t} showAssignee={false} />
                    ))}
                  </ul>
                ) : (
                  <EmptyState compact icon={<ClipboardCheck />} title="Nothing in review" />
                )}
              </Card>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Reminders & notes"
              icon={<AlarmClock />}
              action={
                <Link to="/notes" className="text-xs font-medium text-brand-700 hover:underline">
                  Open
                </Link>
              }
            />
            {reminders.length === 0 && pinned.length === 0 ? (
              <EmptyState compact icon={<StickyNote />} title="No reminders" />
            ) : (
              <ul className="divide-y divide-line">
                {reminders.map((r) => (
                  <li key={r.id} className="flex items-center gap-2.5 px-4 py-2">
                    <Bell className={cn('size-3.5 shrink-0', r.dueAt < new Date().toISOString() ? 'text-red-500' : 'text-ink-400')} />
                    <span className="min-w-0 flex-1 truncate text-xs text-ink-800">{r.title}</span>
                    <span className={cn('shrink-0 text-2xs', r.dueAt < new Date().toISOString() ? 'font-medium text-red-600' : 'text-ink-500')}>{formatDate(r.dueAt, 'd MMM, h:mm a')}</span>
                  </li>
                ))}
                {pinned.map((n) => (
                  <li key={n.id} className="px-4 py-2">
                    <p className="flex items-center gap-1.5 text-xs font-medium text-ink-900">
                      <Pin className="size-3 text-ink-400" /> {n.title}
                    </p>
                    <p className="line-clamp-2 whitespace-pre-line text-2xs text-ink-500">{n.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="My deadline calendar" icon={<CalendarDays />} />
            <DeadlineCalendar tasks={mine} />
          </Card>
          <Card>
            <CardHeader
              title="Recent notifications"
              action={
                <Link to="/notifications" className="text-xs font-medium text-brand-700 hover:underline">
                  All
                </Link>
              }
            />
            {notifications.length ? (
              <div className="divide-y divide-line">
                {notifications.map((n) => (
                  <NotificationItem key={n.id} n={n} dense />
                ))}
              </div>
            ) : (
              <EmptyState compact icon={<Inbox />} title="No notifications" />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
