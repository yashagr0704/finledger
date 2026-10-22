import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { addDays, format, isSameDay, startOfWeek, subMonths } from 'date-fns';
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileQuestion,
  FolderPlus,
  Inbox,
  ListTodo,
  PartyPopper,
  Plus,
  Undo2,
  UserPlus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, EmptyState, PageHeader, Segmented } from '@/components/ui/misc';
import { KpiCard } from '@/components/KpiCard';
import { ActivityFeed } from '@/components/activity';
import { Avatar, CategoryTag, DueDate, StatusBadge } from '@/components/badges';
import { ChartTooltip, Legend, axisProps } from '@/components/charts/ChartParts';
import { TaskListItem } from '@/components/tasks/TaskList';
import { NotificationItem } from '@/components/layout/NotificationItem';
import { ROLE_META } from '@/lib/constants';
import { formatDate, toDateKey, todayKey } from '@/lib/dates';
import { useLookup } from '@/lib/lookup';
import { byUrgency, completedInMonth, completionTrend, isAtRisk, isDueToday, isOpen, isOverdue, workloadFor } from '@/lib/metrics';
import { canCreateClient, canCreateTask, canManageTeam, canReviewTask, visibleClients, visibleTasks } from '@/lib/permissions';
import { cn, pluralize } from '@/lib/utils';
import { useCurrentUser, useDb } from '@/store/store';
import { useUI } from '@/store/ui';
import type { Task } from '@/types';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function Overview() {
  const me = useCurrentUser();
  return me.role === 'employee' ? <EmployeeDashboard /> : <FirmDashboard />;
}

// ---------------------------------------------------------------- firm view

function FirmDashboard() {
  const db = useDb();
  const me = useCurrentUser();
  const { clients } = useLookup();
  const { openTaskForm, openClientForm, setInviteOpen, openTask } = useUI();
  const navigate = useNavigate();
  const [listTab, setListTab] = useState<'overdue' | 'risk'>('overdue');

  const tasks = useMemo(() => visibleTasks(db, me), [db, me]);
  const open = tasks.filter(isOpen);
  const overdue = open.filter(isOverdue).sort(byUrgency);
  const dueToday = open.filter(isDueToday);
  const atRisk = open.filter((t) => isAtRisk(t, db.firm.atRiskDays)).sort(byUrgency);
  const review = open.filter((t) => t.status === 'in_review');
  const doneThisMonth = tasks.filter((t) => completedInMonth(t));
  const doneLastMonth = tasks.filter((t) => completedInMonth(t, subMonths(new Date(), 1))).length;
  const trend = completionTrend(tasks, 6);
  const scopeLabel = me.role === 'admin' ? 'Firm-wide' : 'Your clients & team';

  const upcoming = open.filter((t) => t.dueDate >= todayKey() && t.dueDate <= toDateKey(addDays(new Date(), 14))).sort(byUrgency);

  const team = db.users
    .filter((u) => u.status === 'active' && u.role !== 'admin')
    .filter((u) => me.role === 'admin' || u.managerId === me.id || u.id === me.id)
    .map((u) => {
      const mine = open.filter((t) => t.assigneeId === u.id);
      return {
        user: u,
        total: mine.length,
        overdue: mine.filter(isOverdue).length,
        review: mine.filter((t) => t.status === 'in_review').length,
        load: workloadFor(open, u),
      };
    })
    .sort((a, b) => b.total - a.total);
  const maxLoad = Math.max(1, ...team.map((t) => t.total));

  const docClients = visibleClients(db, me)
    .map((c) => ({ client: c, pending: db.documents.filter((d) => d.clientId === c.id && d.status === 'pending') }))
    .filter((x) => x.pending.length)
    .sort((a, b) => b.pending.length - a.pending.length);

  const visibleIds = new Set(tasks.map((t) => t.id));
  const activity = db.activities.filter((a) => me.role === 'admin' || (a.taskId && visibleIds.has(a.taskId))).slice(0, 9);

  const deltaDone = doneThisMonth.length - doneLastMonth;

  return (
    <div className="animate-slide-up">
      <PageHeader
        title={`${greeting()}, ${me.name.split(' ')[0]}`}
        description={
          <>
            {format(new Date(), 'EEEE, d MMMM yyyy')} · {scopeLabel} · {ROLE_META[me.role].label}
          </>
        }
        actions={
          <>
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

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <KpiCard label="Open tasks" value={open.length} icon={<ListTodo />} tone="brand" to="/tasks?status=open" hint={`${open.filter((t) => t.status === 'in_progress').length} in progress`} />
        <KpiCard label="Due today" value={dueToday.length} icon={<Clock />} tone="amber" to="/tasks?due=today" hint={`${atRisk.length} at risk in next ${db.firm.atRiskDays} days`} />
        <KpiCard label="Overdue" value={overdue.length} icon={<AlertTriangle />} tone="red" to="/tasks?due=overdue" emphasize={overdue.length > 0} hint={overdue.length ? `Oldest: ${formatDate(overdue[0].dueDate, 'd MMM')}` : 'Nothing overdue'} />
        <KpiCard label="Awaiting review" value={review.length} icon={<ClipboardCheck />} tone="violet" to="/review" hint={`${review.filter((t) => canReviewTask(me, t)).length} assigned to you`} />
        <KpiCard
          label="Completed this month"
          value={doneThisMonth.length}
          icon={<CheckCircle2 />}
          tone="emerald"
          to="/tasks?status=completed&completed=month"
          hint={
            <span className={cn(deltaDone >= 0 ? 'text-emerald-700' : 'text-ink-500')}>
              {deltaDone >= 0 ? '+' : ''}
              {deltaDone} vs {format(subMonths(new Date(), 1), 'MMM')} ({doneLastMonth})
            </span>
          }
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="flex flex-col xl:col-span-2">
          <CardHeader
            title="Task completion"
            description="Tasks completed per month, split by whether they met their due date"
            action={
              <Legend
                items={[
                  { label: 'On time', color: '#4a47c9' },
                  { label: 'Late', color: '#eda100' },
                ]}
              />
            }
          />
          <div className="min-h-[232px] flex-1 px-2 pb-2 pt-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trend} barCategoryGap="32%">
                <CartesianGrid vertical={false} stroke="#eef0f3" />
                <XAxis dataKey="month" {...axisProps} />
                <YAxis allowDecimals={false} width={28} {...axisProps} />
                <RTooltip cursor={{ fill: 'rgba(74,71,201,0.06)' }} content={<ChartTooltip />} />
                <Bar dataKey="onTime" name="On time" stackId="a" fill="#4a47c9" radius={[0, 0, 0, 0]} stroke="#fff" strokeWidth={1} />
                <Bar dataKey="late" name="Late" stackId="a" fill="#eda100" radius={[4, 4, 0, 0]} stroke="#fff" strokeWidth={1} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Workload by employee"
            description="Open tasks · capacity used (next 14 days)"
            action={
              <Button size="sm" variant="ghost" onClick={() => navigate('/team')}>
                Team <ArrowRight />
              </Button>
            }
          />
          <ul className="divide-y divide-line">
            {team.slice(0, 7).map(({ user, total, overdue: od, load }) => (
              <li key={user.id}>
                <Link to={`/tasks?assignee=${user.id}&status=open`} className="flex items-center gap-3 px-4 py-2 hover:bg-slate-50">
                  <Avatar user={user} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-xs font-medium text-ink-800">{user.name}</span>
                      <span className="shrink-0 text-2xs tabular-nums text-ink-500">
                        {total} open{od > 0 && <span className="text-red-600"> · {od} overdue</span>}
                      </span>
                    </div>
                    <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div className="bg-red-500" style={{ width: `${(od / maxLoad) * 100}%` }} />
                      <div className="bg-brand-500" style={{ width: `${((total - od) / maxLoad) * 100}%`, marginLeft: od ? 1 : 0 }} />
                    </div>
                  </div>
                  <span
                    className={cn(
                      'w-10 shrink-0 text-right text-2xs font-medium tabular-nums',
                      load.level === 'over' ? 'text-red-600' : load.level === 'heavy' ? 'text-amber-700' : 'text-ink-500',
                    )}
                    title="Share of capacity for work due in the next 14 days"
                  >
                    {load.pct}%
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Needs attention"
            description="Overdue work and tasks at risk of missing their deadline"
            action={
              <Segmented
                size="sm"
                value={listTab}
                onChange={setListTab}
                options={[
                  { value: 'overdue', label: `Overdue (${overdue.length})` },
                  { value: 'risk', label: `At risk (${atRisk.length})` },
                ]}
              />
            }
          />
          <AttentionTable tasks={(listTab === 'overdue' ? overdue : atRisk).slice(0, 8)} empty={listTab === 'overdue' ? 'Nothing is overdue. Great work!' : 'No tasks at risk right now.'} />
          {(listTab === 'overdue' ? overdue : atRisk).length > 8 && (
            <div className="border-t border-line px-4 py-2">
              <Link to={listTab === 'overdue' ? '/tasks?due=overdue' : '/tasks?due=week&status=open'} className="text-xs font-medium text-brand-700 hover:underline">
                View all {(listTab === 'overdue' ? overdue : atRisk).length} →
              </Link>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Upcoming deadlines"
            description="Next 14 days"
            icon={<CalendarDays />}
            action={
              <Button size="sm" variant="ghost" onClick={() => navigate('/calendar')}>
                Calendar <ArrowRight />
              </Button>
            }
          />
          {upcoming.length === 0 ? (
            <EmptyState compact icon={<CalendarDays />} title="No deadlines in the next two weeks" />
          ) : (
            <ul className="max-h-[340px] divide-y divide-line overflow-y-auto">
              {upcoming.slice(0, 10).map((t) => (
                <li key={t.id}>
                  <button onClick={() => openTask(t.id)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-slate-50">
                    <div className="flex w-10 shrink-0 flex-col items-center rounded-md border border-line bg-white py-0.5">
                      <span className="text-[9px] font-semibold uppercase text-red-500">{formatDate(t.dueDate, 'MMM')}</span>
                      <span className="text-sm font-semibold leading-tight tabular-nums text-ink-900">{formatDate(t.dueDate, 'd')}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-ink-900">{t.title}</p>
                      <p className="truncate text-2xs text-ink-500">{clients.get(t.clientId)?.name}</p>
                    </div>
                    <DueDate task={t} showIcon={false} className="text-2xs" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Recent activity" description={scopeLabel} />
          <ActivityFeed items={activity} empty={<EmptyState compact icon={<Inbox />} title="No activity yet" />} />
        </Card>
        <Card>
          <CardHeader title="Pending document requests" description={`${pluralize(docClients.length, 'client')} waiting on documents`} icon={<FileQuestion />} />
          {docClients.length === 0 ? (
            <EmptyState compact icon={<FileQuestion />} title="No outstanding document requests" />
          ) : (
            <ul className="divide-y divide-line">
              {docClients.slice(0, 7).map(({ client, pending }) => {
                const late = pending.filter((d) => d.dueDate && d.dueDate < todayKey()).length;
                return (
                  <li key={client.id}>
                    <Link to={`/clients/${client.id}?tab=documents`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-2xs font-semibold text-ink-600">{client.code.slice(0, 3)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-ink-900">{client.name}</p>
                        <p className="truncate text-xs text-ink-500">{pending.map((d) => d.name).join(' · ')}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-xs font-medium tabular-nums text-ink-800">{pending.length} pending</p>
                        {late > 0 && <p className="text-2xs text-red-600">{late} past due</p>}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function AttentionTable({ tasks, empty }: { tasks: Task[]; empty: string }) {
  const { users, clients, categories } = useLookup();
  const { openTask } = useUI();
  if (!tasks.length) return <EmptyState compact icon={<PartyPopper />} title={empty} />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] table-fixed text-left">
        <thead>
          <tr className="border-b border-line text-2xs font-medium uppercase tracking-wide text-ink-400">
            <th className="w-[36%] px-4 py-2 font-medium">Task</th>
            <th className="w-[21%] px-2 py-2 font-medium">Client</th>
            <th className="w-[17%] px-2 py-2 font-medium">Assignee</th>
            <th className="w-[15%] px-2 py-2 font-medium">Status</th>
            <th className="w-[11%] px-4 py-2 text-right font-medium">Due</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {tasks.map((t) => (
            <tr key={t.id} onClick={() => openTask(t.id)} className="cursor-pointer hover:bg-slate-50">
              <td className="px-4 py-2">
                <button className="block max-w-full truncate text-left text-[13px] font-medium text-ink-900 hover:text-brand-700" onClick={(e) => (e.stopPropagation(), openTask(t.id))}>
                  {t.title}
                </button>
                <span className="flex items-center gap-1.5 pt-0.5">
                  <span className="font-mono text-2xs text-ink-400">{t.id}</span>
                  <CategoryTag category={categories.get(t.categoryId)} className="h-4" />
                </span>
              </td>
              <td className="truncate px-2 py-2 text-xs text-ink-700">{clients.get(t.clientId)?.name}</td>
              <td className="px-2 py-2">
                <span className="flex items-center gap-1.5 text-xs text-ink-700">
                  <Avatar user={users.get(t.assigneeId)} size="xs" />
                  <span className="truncate">{users.get(t.assigneeId)?.name}</span>
                </span>
              </td>
              <td className="px-2 py-2">
                <StatusBadge status={t.status} />
              </td>
              <td className="px-4 py-2 text-right">
                <DueDate task={t} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------ employee view

function EmployeeDashboard() {
  const db = useDb();
  const me = useCurrentUser();
  const { openTask } = useUI();
  const mine = db.tasks.filter((t) => t.assigneeId === me.id);
  const open = mine.filter(isOpen).sort(byUrgency);
  const overdue = open.filter(isOverdue);
  const today = open.filter(isDueToday);
  const upcoming = open.filter((t) => t.dueDate > todayKey() && t.dueDate <= toDateKey(addDays(new Date(), 7)));
  const returned = open.filter((t) => t.status === 'changes_requested');
  const inReview = open.filter((t) => t.status === 'in_review');
  const doneThisMonth = mine.filter((t) => completedInMonth(t)).length;
  const notifications = db.notifications.filter((n) => n.userId === me.id).slice(0, 5);
  const [filter, setFilter] = useState<'all' | 'today' | 'week'>('all');

  const prioritized = open
    .filter((t) => t.status !== 'in_review')
    .filter((t) => (filter === 'today' ? t.dueDate <= todayKey() : filter === 'week' ? t.dueDate <= toDateKey(addDays(new Date(), 7)) : true))
    .sort((a, b) => {
      // Overdue and returned work first, then by due date and priority.
      const rank = (t: Task) => (isOverdue(t) ? 0 : t.status === 'changes_requested' ? 1 : 2);
      return rank(a) - rank(b) || byUrgency(a, b);
    });

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
      <PageHeader title={`${greeting()}, ${me.name.split(' ')[0]}`} description={`${format(new Date(), 'EEEE, d MMMM yyyy')} · ${focusLine}`}>
        <div />
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Due today" value={today.length} icon={<Clock />} tone="amber" to={`/tasks?assignee=${me.id}&due=today`} />
        <KpiCard label="Overdue" value={overdue.length} icon={<AlertTriangle />} tone="red" emphasize={overdue.length > 0} to={`/tasks?assignee=${me.id}&due=overdue`} />
        <KpiCard label="Upcoming (7 days)" value={upcoming.length} icon={<CalendarDays />} tone="brand" to={`/tasks?assignee=${me.id}&due=week&status=open`} />
        <KpiCard label="Completed this month" value={doneThisMonth} icon={<CheckCircle2 />} tone="emerald" to={`/tasks?assignee=${me.id}&status=completed`} />
      </div>

      {(returned.length > 0 || inReview.length > 0) && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Card className={cn(returned.length > 0 && 'border-orange-200')}>
            <CardHeader title="Returned for changes" description="Reviewer feedback waiting on you" icon={<Undo2 />} />
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
            <CardHeader title="Awaiting review" description="Submitted by you, pending reviewer decision" icon={<ClipboardCheck />} />
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

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="My tasks"
            description="Prioritised: overdue and returned first, then by deadline"
            action={
              <Segmented
                size="sm"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'today', label: 'Today' },
                  { value: 'week', label: 'This week' },
                ]}
              />
            }
          />
          {prioritized.length === 0 ? (
            <EmptyState compact icon={<PartyPopper />} title="Nothing here" description={filter === 'all' ? 'You have no open tasks assigned. New assignments will appear here.' : 'No tasks in this window.'} />
          ) : (
            <ul className="divide-y divide-line">
              {prioritized.slice(0, 12).map((t) => (
                <TaskListItem key={t.id} task={t} showAssignee={false} />
              ))}
            </ul>
          )}
          <div className="border-t border-line px-4 py-2">
            <Link to={`/tasks?assignee=${me.id}&status=open`} className="text-xs font-medium text-brand-700 hover:underline">
              Open full task list →
            </Link>
          </div>
        </Card>

        <div className="space-y-4">
          <WeekStrip tasks={open} />
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

function WeekStrip({ tasks }: { tasks: Task[] }) {
  const { openTask } = useUI();
  const navigate = useNavigate();
  const start = startOfWeek(new Date(), { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const [selected, setSelected] = useState(toDateKey(new Date()));
  const dayTasks = tasks.filter((t) => t.dueDate === selected);
  return (
    <Card>
      <CardHeader
        title="This week"
        description={`${format(days[0], 'd MMM')} – ${format(days[6], 'd MMM')}`}
        action={
          <Button size="sm" variant="ghost" onClick={() => navigate('/calendar?view=week')}>
            Calendar <ArrowRight />
          </Button>
        }
      />
      <div className="grid grid-cols-7 gap-1 p-2">
        {days.map((d) => {
          const key = toDateKey(d);
          const count = tasks.filter((t) => t.dueDate === key).length;
          const isToday = isSameDay(d, new Date());
          return (
            <button
              key={key}
              onClick={() => setSelected(key)}
              className={cn(
                'flex flex-col items-center rounded-md py-1.5 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
                selected === key && 'bg-brand-50 hover:bg-brand-50',
              )}
              aria-pressed={selected === key}
              aria-label={`${format(d, 'EEEE d MMMM')}: ${count} due`}
            >
              <span className="text-2xs font-medium uppercase text-ink-400">{format(d, 'EEEEE')}</span>
              <span className={cn('mt-0.5 flex size-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums', isToday ? 'bg-brand-600 text-white' : 'text-ink-800')}>
                {format(d, 'd')}
              </span>
              <span className="mt-1 flex h-1.5 gap-0.5">
                {Array.from({ length: Math.min(count, 3) }).map((_, i) => (
                  <span key={i} className={cn('size-1.5 rounded-full', key < todayKey() ? 'bg-red-400' : 'bg-brand-400')} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <div className="border-t border-line">
        {dayTasks.length ? (
          <ul className="divide-y divide-line">
            {dayTasks.map((t) => (
              <li key={t.id}>
                <button onClick={() => openTask(t.id)} className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-slate-50">
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink-800">{t.title}</span>
                  <StatusBadge status={t.status} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3 text-xs text-ink-400">Nothing due {selected === todayKey() ? 'today' : formatDate(selected, 'EEE d MMM')}.</p>
        )}
      </div>
    </Card>
  );
}
