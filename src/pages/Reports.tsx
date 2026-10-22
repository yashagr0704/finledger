import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { differenceInHours, format, parseISO, startOfMonth, subMonths } from 'date-fns';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { Info } from 'lucide-react';
import { Card, CardHeader, PageHeader, Segmented } from '@/components/ui/misc';
import { Select } from '@/components/ui/form';
import { Avatar } from '@/components/badges';
import { ChartTooltip, Legend, axisProps } from '@/components/charts/ChartParts';
import { CHART_BRAND, CHART_SERIES, STATUS_META } from '@/lib/constants';
import { useLookup } from '@/lib/lookup';
import { completionTrend, formatHours, isOpen, isOverdue, lastMonths, overdueTrend, workloadHours } from '@/lib/metrics';
import { visibleTasks } from '@/lib/permissions';
import { cn, percent } from '@/lib/utils';
import { useCurrentUser, useDb } from '@/store/store';
import type { TaskStatus } from '@/types';

const STATUS_HEX: Record<Exclude<TaskStatus, 'completed'>, string> = {
  not_started: '#94a3b8',
  in_progress: '#3b82f6',
  in_review: '#8b5cf6',
  changes_requested: '#f97316',
};

export default function Reports() {
  const db = useDb();
  const me = useCurrentUser();
  const { users } = useLookup();
  const [months, setMonths] = useState<'3' | '6' | '12'>('6');
  const [employee, setEmployee] = useState('');

  const scoped = useMemo(() => visibleTasks(db, me), [db, me]);
  const tasks = useMemo(() => (employee ? scoped.filter((t) => t.assigneeId === employee) : scoped), [scoped, employee]);
  const n = Number(months);
  const rangeStart = format(startOfMonth(subMonths(new Date(), n - 1)), 'yyyy-MM-dd');
  const inRangeDue = tasks.filter((t) => t.dueDate >= rangeStart && t.dueDate <= format(new Date(), 'yyyy-MM-dd'));
  const completedInRange = tasks.filter((t) => t.completedAt && t.completedAt.slice(0, 10) >= rangeStart);
  const onTime = completedInRange.filter((t) => t.completedAt!.slice(0, 10) <= t.dueDate).length;
  const dueDone = inRangeDue.filter((t) => t.status === 'completed').length;

  const trend = completionTrend(tasks, n);
  const odTrend = overdueTrend(tasks, n);

  const taskIds = new Set(tasks.map((t) => t.id));
  const reviewsInRange = db.reviews.filter((r) => taskIds.has(r.taskId) && r.decidedAt.slice(0, 10) >= rangeStart);
  const avgTat = reviewsInRange.length ? reviewsInRange.reduce((s, r) => s + differenceInHours(parseISO(r.decidedAt), parseISO(r.submittedAt)), 0) / reviewsInRange.length : 0;
  const tatTrend = lastMonths(n).map((m) => {
    const key = format(m, 'yyyy-MM');
    const rs = reviewsInRange.filter((r) => r.decidedAt.slice(0, 7) === key);
    return { month: format(m, 'MMM'), hours: rs.length ? Math.round(rs.reduce((s, r) => s + differenceInHours(parseISO(r.decidedAt), parseISO(r.submittedAt)), 0) / rs.length) : 0 };
  });
  const byReviewer = [...new Set(reviewsInRange.map((r) => r.reviewerId))]
    .map((id) => {
      const rs = reviewsInRange.filter((r) => r.reviewerId === id);
      return {
        user: users.get(id)!,
        count: rs.length,
        avg: rs.reduce((s, r) => s + differenceInHours(parseISO(r.decidedAt), parseISO(r.submittedAt)), 0) / rs.length,
        returned: percent(rs.filter((r) => r.decision === 'returned').length, rs.length),
      };
    })
    .sort((a, b) => b.count - a.count);

  const open = tasks.filter(isOpen);
  const workload = db.users
    .filter((u) => u.status === 'active' && open.some((t) => t.assigneeId === u.id))
    .map((u) => {
      const mine = open.filter((t) => t.assigneeId === u.id);
      return {
        name: u.name.split(' ')[0],
        full: u.name,
        not_started: mine.filter((t) => t.status === 'not_started').length,
        in_progress: mine.filter((t) => t.status === 'in_progress').length,
        in_review: mine.filter((t) => t.status === 'in_review').length,
        changes_requested: mine.filter((t) => t.status === 'changes_requested').length,
        total: mine.length,
      };
    })
    .sort((a, b) => b.total - a.total);

  const catDist = db.categories
    .map((c) => ({ id: c.id, name: c.name, color: CHART_SERIES[c.colorSlot % CHART_SERIES.length], count: tasks.filter((t) => t.categoryId === c.id && (isOpen(t) || (t.completedAt ?? '') >= rangeStart)).length }))
    .filter((c) => c.count)
    .sort((a, b) => b.count - a.count);
  const catMax = Math.max(1, ...catDist.map((c) => c.count));

  const clientRows = db.clients
    .map((c) => {
      const ct = open.filter((t) => t.clientId === c.id);
      return { client: c, open: ct.length, overdue: ct.filter(isOverdue).length, hours: Math.round(ct.reduce((s, t) => s + workloadHours([t], t.assigneeId), 0)), docs: db.documents.filter((d) => d.clientId === c.id && d.status === 'pending').length };
    })
    .filter((r) => r.open)
    .sort((a, b) => b.overdue - a.overdue || b.open - a.open);
  const maxOpen = Math.max(1, ...clientRows.map((r) => r.open));

  const people = db.users.filter((u) => scoped.some((t) => t.assigneeId === u.id));

  return (
    <div className="animate-slide-up">
      <PageHeader
        title="Reports"
        description={me.role === 'admin' ? 'Firm performance, calculated from live task data.' : 'Performance for your clients and team.'}
        actions={
          <>
            <div className="w-48">
              <Select value={employee} onChange={(e) => setEmployee(e.target.value)} aria-label="Filter by employee">
                <option value="">All employees</option>
                {people.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </div>
            <Segmented
              value={months}
              onChange={setMonths}
              options={[
                { value: '3', label: '3 months' },
                { value: '6', label: '6 months' },
                { value: '12', label: '12 months' },
              ]}
            />
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Completion rate" value={`${percent(dueDone, inRangeDue.length)}%`} hint={`${dueDone} of ${inRangeDue.length} tasks due in period are complete`} />
        <Kpi label="On-time delivery" value={`${percent(onTime, completedInRange.length)}%`} hint={`${onTime} of ${completedInRange.length} completed on or before due date`} />
        <Kpi label="Currently overdue" value={open.filter(isOverdue).length} hint={`${open.length} open tasks in scope`} tone={open.some(isOverdue) ? 'text-red-600' : undefined} />
        <Kpi label="Avg. review turnaround" value={reviewsInRange.length ? formatHours(avgTat) : '—'} hint={`${reviewsInRange.length} review decisions in period`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Task completion"
            description="Tasks due vs. tasks completed per month"
            action={
              <Legend
                items={[
                  { label: 'Due to date', color: '#cbd5e1' },
                  { label: 'Completed', color: CHART_BRAND },
                ]}
              />
            }
          />
          <ChartBox>
            <BarChart data={trend} barGap={2} barCategoryGap="28%">
              <CartesianGrid vertical={false} stroke="#eef0f3" />
              <XAxis dataKey="month" {...axisProps} />
              <YAxis allowDecimals={false} width={28} {...axisProps} />
              <RTooltip cursor={{ fill: 'rgba(74,71,201,0.06)' }} content={<ChartTooltip />} />
              <Bar dataKey="due" name="Due to date" fill="#cbd5e1" radius={[4, 4, 0, 0]} />
              <Bar dataKey="completed" name="Completed" fill={CHART_BRAND} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartBox>
        </Card>

        <Card>
          <CardHeader
            title="Overdue trend"
            description="Tasks completed after their due date, and open tasks past due at month end"
            action={
              <Legend
                items={[
                  { label: 'Completed late', color: '#eda100' },
                  { label: 'Past due at month end', color: '#dc2626' },
                ]}
              />
            }
          />
          <ChartBox>
            <LineChart data={odTrend}>
              <CartesianGrid vertical={false} stroke="#eef0f3" />
              <XAxis dataKey="month" {...axisProps} />
              <YAxis allowDecimals={false} width={28} {...axisProps} />
              <RTooltip content={<ChartTooltip />} />
              <Line type="monotone" dataKey="lateCompletions" name="Completed late" stroke="#eda100" strokeWidth={2} dot={{ r: 4, fill: '#eda100', stroke: '#fff', strokeWidth: 2 }} activeDot={{ r: 5 }} />
              <Line type="monotone" dataKey="overdue" name="Past due at month end" stroke="#dc2626" strokeWidth={2} dot={{ r: 4, fill: '#dc2626', stroke: '#fff', strokeWidth: 2 }} activeDot={{ r: 5 }} />
            </LineChart>
          </ChartBox>
        </Card>

        <Card>
          <CardHeader
            title="Workload by employee"
            description="Open tasks by status"
          />
          <div className="px-4 pt-3">
            <Legend items={(Object.keys(STATUS_HEX) as (keyof typeof STATUS_HEX)[]).map((s) => ({ label: STATUS_META[s].label, color: STATUS_HEX[s] }))} />
          </div>
          <ChartBox height={Math.max(220, workload.length * 34 + 40)}>
            <BarChart data={workload} layout="vertical" barCategoryGap="24%">
              <CartesianGrid horizontal={false} stroke="#eef0f3" />
              <XAxis type="number" allowDecimals={false} {...axisProps} />
              <YAxis type="category" dataKey="name" width={72} {...axisProps} />
              <RTooltip cursor={{ fill: 'rgba(74,71,201,0.06)' }} content={<ChartTooltip />} />
              {(Object.keys(STATUS_HEX) as (keyof typeof STATUS_HEX)[]).map((s, i, arr) => (
                <Bar key={s} dataKey={s} name={STATUS_META[s].label} stackId="w" fill={STATUS_HEX[s]} stroke="#fff" strokeWidth={1} radius={i === arr.length - 1 ? [0, 4, 4, 0] : 0} />
              ))}
            </BarChart>
          </ChartBox>
        </Card>

        <Card>
          <CardHeader title="Distribution by category" description="Open work plus tasks completed in the period" />
          <ul className="space-y-2.5 px-4 py-4">
            {catDist.map((c) => (
              <li key={c.id} className="grid grid-cols-[110px_1fr_40px] items-center gap-3">
                <span className="truncate text-xs text-ink-700">{c.name}</span>
                <div className="h-2.5 rounded-full bg-slate-100">
                  <div className="h-full rounded-full" style={{ width: `${(c.count / catMax) * 100}%`, background: c.color }} title={`${c.name}: ${c.count}`} />
                </div>
                <span className="text-right text-xs font-medium tabular-nums text-ink-800">{c.count}</span>
              </li>
            ))}
          </ul>
          <p className="border-t border-line px-4 py-2 text-2xs text-ink-400">{catDist.reduce((s, c) => s + c.count, 0)} tasks across {catDist.length} categories</p>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader title="Client-wise outstanding work" description="Open tasks, overdue items, remaining effort and pending documents" />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead>
                <tr className="border-b border-line text-2xs font-medium uppercase tracking-wide text-ink-400">
                  <th className="px-4 py-2 font-medium">Client</th>
                  <th className="w-[34%] px-3 py-2 font-medium">Open tasks</th>
                  <th className="px-3 py-2 text-right font-medium">Overdue</th>
                  <th className="px-3 py-2 text-right font-medium">Est. hours left</th>
                  <th className="px-4 py-2 text-right font-medium">Docs pending</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {clientRows.map((r) => (
                  <tr key={r.client.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2">
                      <Link to={`/clients/${r.client.id}`} className="text-[13px] font-medium text-ink-900 hover:text-brand-700">
                        {r.client.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                          <div className="bg-red-500" style={{ width: `${(r.overdue / maxOpen) * 100}%` }} />
                          <div className="bg-brand-500" style={{ width: `${((r.open - r.overdue) / maxOpen) * 100}%`, marginLeft: r.overdue ? 1 : 0 }} />
                        </div>
                        <span className="w-6 text-right text-xs tabular-nums text-ink-700">{r.open}</span>
                      </div>
                    </td>
                    <td className={cn('px-3 py-2 text-right text-xs tabular-nums', r.overdue ? 'font-semibold text-red-600' : 'text-ink-400')}>{r.overdue}</td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums text-ink-700">{r.hours}h</td>
                    <td className={cn('px-4 py-2 text-right text-xs tabular-nums', r.docs ? 'text-amber-700' : 'text-ink-400')}>{r.docs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader title="Review turnaround" description="Average hours from submission to decision, by month" />
          <ChartBox>
            <LineChart data={tatTrend}>
              <CartesianGrid vertical={false} stroke="#eef0f3" />
              <XAxis dataKey="month" {...axisProps} />
              <YAxis width={32} {...axisProps} unit="h" />
              <RTooltip content={<ChartTooltip formatter={(v) => `${v}h`} />} />
              <Line type="monotone" dataKey="hours" name="Avg. turnaround" stroke={CHART_BRAND} strokeWidth={2} dot={{ r: 4, fill: CHART_BRAND, stroke: '#fff', strokeWidth: 2 }} />
            </LineChart>
          </ChartBox>
        </Card>

        <Card>
          <CardHeader title="Reviewers" description="Decisions in the selected period" />
          {byReviewer.length ? (
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-line text-2xs font-medium uppercase tracking-wide text-ink-400">
                  <th className="px-4 py-2 font-medium">Reviewer</th>
                  <th className="px-3 py-2 text-right font-medium">Reviews</th>
                  <th className="px-3 py-2 text-right font-medium">Avg. time</th>
                  <th className="px-4 py-2 text-right font-medium">Returned</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {byReviewer.map((r) => (
                  <tr key={r.user.id}>
                    <td className="px-4 py-2">
                      <span className="flex items-center gap-2 text-xs font-medium text-ink-800">
                        <Avatar user={r.user} size="xs" />
                        {r.user.name}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums">{r.count}</td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums">{formatHours(r.avg)}</td>
                    <td className="px-4 py-2 text-right text-xs tabular-nums">{r.returned}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="px-4 py-6 text-center text-xs text-ink-400">No review decisions in this period.</p>
          )}
        </Card>
      </div>
      <p className="mt-4 flex items-center gap-1.5 text-2xs text-ink-400">
        <Info className="size-3" /> All figures are computed from the tasks visible to you. Historical months come from seeded demo history.
      </p>
    </div>
  );
}

function Kpi({ label, value, hint, tone }: { label: string; value: string | number; hint: string; tone?: string }) {
  return (
    <Card className="p-3.5">
      <p className="text-xs font-medium text-ink-500">{label}</p>
      <p className={cn('mt-1.5 text-2xl font-semibold tabular-nums tracking-tight text-ink-900', tone)}>{value}</p>
      <p className="mt-0.5 truncate text-2xs text-ink-500" title={hint}>
        {hint}
      </p>
    </Card>
  );
}

function ChartBox({ children, height = 240 }: { children: React.ReactElement; height?: number }) {
  return (
    <div className="px-2 pb-2 pt-4" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}
