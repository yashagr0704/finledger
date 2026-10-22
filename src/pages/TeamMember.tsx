import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Inbox, Mail, Phone, UserX } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { Card, CardHeader, EmptyState, Segmented } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { ActivityFeed } from '@/components/activity';
import { Avatar } from '@/components/badges';
import { ChartTooltip, axisProps } from '@/components/charts/ChartParts';
import { TaskListItem } from '@/components/tasks/TaskList';
import { WorkloadMeter } from '@/components/team/WorkloadMeter';
import { ROLE_META } from '@/lib/constants';
import { formatDate } from '@/lib/dates';
import { byUrgency, completedInMonth, completionTrend, formatHours, isOpen, isOverdue, reviewTurnaround } from '@/lib/metrics';
import { visibleTasks } from '@/lib/permissions';
import { useCurrentUser, useDb } from '@/store/store';

export default function TeamMember() {
  const { userId } = useParams();
  const db = useDb();
  const me = useCurrentUser();
  const user = db.users.find((u) => u.id === userId);
  const [tab, setTab] = useState<'open' | 'done'>('open');
  const scoped = useMemo(() => visibleTasks(db, me), [db, me]);

  if (!user)
    return (
      <EmptyState
        icon={<UserX />}
        title="Team member not found"
        action={
          <Button asChild>
            <Link to="/team">Back to team</Link>
          </Button>
        }
      />
    );

  const all = db.tasks.filter((t) => t.assigneeId === user.id);
  const mine = scoped.filter((t) => t.assigneeId === user.id);
  const hidden = all.length - mine.length;
  const open = mine.filter(isOpen).sort(byUrgency);
  const done = mine.filter((t) => !isOpen(t)).sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  const trend = completionTrend(mine, 6);
  const manager = user.managerId ? db.users.find((u) => u.id === user.managerId) : undefined;
  const reports = db.users.filter((u) => u.managerId === user.id);
  const onTime = done.filter((t) => t.completedAt && t.completedAt.slice(0, 10) <= t.dueDate).length;
  const reviewsGiven = reviewTurnaround({ ...db, reviews: db.reviews.filter((r) => r.reviewerId === user.id) });
  const visibleIds = new Set(scoped.map((t) => t.id));
  const activity = db.activities.filter((a) => (a.actorId === user.id || a.userId === user.id) && (!a.taskId || visibleIds.has(a.taskId))).slice(0, 15);

  return (
    <div className="animate-slide-up">
      <Link to="/team" className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-ink-500 hover:text-ink-900">
        <ArrowLeft className="size-3.5" /> Team
      </Link>
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center">
        <Avatar user={user} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight text-ink-900">{user.name}</h1>
          <p className="text-[13px] text-ink-500">
            {user.title} · {ROLE_META[user.role].label}
            {user.status !== 'active' && <span className="ml-2 rounded-full bg-slate-100 px-1.5 py-0.5 text-2xs capitalize">{user.status}</span>}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-500">
            <span className="flex items-center gap-1">
              <Mail className="size-3.5" /> {user.email}
            </span>
            {user.phone && (
              <span className="flex items-center gap-1">
                <Phone className="size-3.5" /> {user.phone}
              </span>
            )}
            <span>Joined {formatDate(user.joinedAt, 'MMM yyyy')}</span>
            {manager && (
              <span>
                Reports to{' '}
                <Link to={`/team/${manager.id}`} className="text-brand-700 hover:underline">
                  {manager.name}
                </Link>
              </span>
            )}
          </p>
        </div>
        {user.status === 'active' && <WorkloadMeter user={user} />}
      </div>

      <Card className="mb-4 grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-5 sm:divide-y-0">
        {[
          { label: 'Open tasks', value: open.length },
          { label: 'Overdue', value: open.filter(isOverdue).length, tone: 'text-red-600' },
          { label: 'In review', value: open.filter((t) => t.status === 'in_review').length },
          { label: 'Completed this month', value: mine.filter((t) => completedInMonth(t)).length, tone: 'text-emerald-600' },
          { label: 'On-time rate', value: done.length ? `${Math.round((onTime / done.length) * 100)}%` : '—' },
        ].map((s) => (
          <div key={s.label} className="px-4 py-3">
            <p className={`text-xl font-semibold tabular-nums ${s.tone ?? 'text-ink-900'}`}>{s.value}</p>
            <p className="text-2xs text-ink-500">{s.label}</p>
          </div>
        ))}
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Assigned tasks"
            description={hidden > 0 ? `${hidden} task(s) outside your access are hidden` : undefined}
            action={
              <Segmented
                size="sm"
                value={tab}
                onChange={setTab}
                options={[
                  { value: 'open', label: `Open (${open.length})` },
                  { value: 'done', label: `Completed (${done.length})` },
                ]}
              />
            }
          />
          {(tab === 'open' ? open : done.slice(0, 20)).length ? (
            <ul className="divide-y divide-line">
              {(tab === 'open' ? open : done.slice(0, 20)).map((t) => (
                <TaskListItem key={t.id} task={t} showAssignee={false} />
              ))}
            </ul>
          ) : (
            <EmptyState compact icon={<CheckCircle2 />} title={tab === 'open' ? 'No open tasks' : 'Nothing completed yet'} />
          )}
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Completed per month" />
            <div className="h-44 px-2 pb-2 pt-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trend}>
                  <CartesianGrid vertical={false} stroke="#eef0f3" />
                  <XAxis dataKey="month" {...axisProps} />
                  <YAxis allowDecimals={false} width={24} {...axisProps} />
                  <RTooltip cursor={{ fill: 'rgba(74,71,201,0.06)' }} content={<ChartTooltip />} />
                  <Bar dataKey="completed" name="Completed" fill="#4a47c9" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          {(user.role === 'manager' || user.role === 'admin') && (
            <Card>
              <CardHeader title="Reviewer stats" />
              <div className="grid grid-cols-2 divide-x divide-line">
                <div className="px-4 py-3">
                  <p className="text-lg font-semibold tabular-nums">{reviewsGiven.count}</p>
                  <p className="text-2xs text-ink-500">Reviews completed</p>
                </div>
                <div className="px-4 py-3">
                  <p className="text-lg font-semibold tabular-nums">{reviewsGiven.count ? formatHours(reviewsGiven.avgHours) : '—'}</p>
                  <p className="text-2xs text-ink-500">Avg. turnaround</p>
                </div>
              </div>
              {reports.length > 0 && (
                <div className="border-t border-line px-4 py-3">
                  <p className="mb-2 text-2xs font-semibold uppercase tracking-wide text-ink-400">Direct reports</p>
                  <div className="flex flex-wrap gap-2">
                    {reports.map((r) => (
                      <Link key={r.id} to={`/team/${r.id}`} className="flex items-center gap-1.5 rounded-full border border-line py-0.5 pl-0.5 pr-2 text-xs text-ink-700 hover:border-slate-300">
                        <Avatar user={r} size="xs" />
                        {r.name}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          )}
          <Card>
            <CardHeader title="Recent activity" />
            <ActivityFeed items={activity} empty={<EmptyState compact icon={<Inbox />} title="No activity yet" />} />
          </Card>
        </div>
      </div>
    </div>
  );
}
