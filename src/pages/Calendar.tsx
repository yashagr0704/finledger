import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { CalendarDays, CalendarRange, ChevronLeft, ChevronRight, CircleDot, Info, List, SearchX } from 'lucide-react';
import { DeadlineCalendar } from '@/components/dashboard/DeadlineCalendar';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, EmptyState, PageHeader, Segmented } from '@/components/ui/misc';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/menu';
import { Avatar, DueDate, StatusBadge } from '@/components/badges';
import { FilterMenu } from '@/components/tasks/FilterMenu';
import { STATUS_META, STATUS_ORDER } from '@/lib/constants';
import { toDateKey, todayKey } from '@/lib/dates';
import { useLookup } from '@/lib/lookup';
import { isOpen, isOverdue } from '@/lib/metrics';
import { visibleClients, visibleTasks } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { useCurrentUser, useDb } from '@/store/store';
import { useUI } from '@/store/ui';
import type { Task } from '@/types';

type View = 'month' | 'week' | 'agenda' | 'dots';
const list = (v: string | null) => (v ? v.split(',').filter(Boolean) : []);

export default function CalendarPage() {
  const db = useDb();
  const me = useCurrentUser();
  const [params, setParams] = useSearchParams();
  const view = (params.get('view') as View) || 'month';
  const anchor = params.get('date') ? parseISO(params.get('date')!) : new Date();
  const f = { client: list(params.get('client')), assignee: list(params.get('assignee')), category: list(params.get('category')), status: list(params.get('status')) };

  const set = (patch: Record<string, string | string[]>) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        Object.entries(patch).forEach(([k, v]) => {
          const val = Array.isArray(v) ? v.join(',') : v;
          if (val) n.set(k, val);
          else n.delete(k);
        });
        return n;
      },
      { replace: true },
    );

  const scoped = useMemo(() => visibleTasks(db, me), [db, me]);
  const tasks = useMemo(
    () =>
      scoped.filter(
        (t) =>
          (!f.client.length || f.client.includes(t.clientId)) &&
          (!f.assignee.length || f.assignee.includes(t.assigneeId)) &&
          (!f.category.length || f.category.includes(t.categoryId)) &&
          (!f.status.length || f.status.includes(t.status)),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scoped, params],
  );
  const byDay = useMemo(() => {
    const m = new Map<string, Task[]>();
    tasks.forEach((t) => m.set(t.dueDate, [...(m.get(t.dueDate) ?? []), t]));
    return m;
  }, [tasks]);

  const step = (dir: number) => set({ date: toDateKey(view === 'month' ? addMonths(anchor, dir) : addWeeks(anchor, dir)) });
  const title =
    view === 'month'
      ? format(anchor, 'MMMM yyyy')
      : view === 'week'
        ? `${format(startOfWeek(anchor, { weekStartsOn: 1 }), 'd MMM')} – ${format(endOfWeek(anchor, { weekStartsOn: 1 }), 'd MMM yyyy')}`
        : `From ${format(anchor, 'd MMM yyyy')}`;

  const people = db.users.filter((u) => scoped.some((t) => t.assigneeId === u.id));
  const filterCount = f.client.length + f.assignee.length + f.category.length + f.status.length;

  return (
    <div className="animate-slide-up">
      <PageHeader
        title="Compliance Calendar"
        description="Deadlines for your visible tasks, colour-coded by status."
        actions={
          <Segmented
            value={view}
            onChange={(v) => set({ view: v })}
            options={[
              { value: 'month', label: 'Month', icon: <CalendarDays /> },
              { value: 'dots', label: 'Status dots', icon: <CircleDot /> },
              { value: 'week', label: 'Week', icon: <CalendarRange /> },
              { value: 'agenda', label: 'Agenda', icon: <List /> },
            ]}
          />
        }
      />

      <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-900">
        <Info className="mt-px size-3.5 shrink-0" />
        <span>Dates shown are demo task deadlines generated from configurable schedules. They are not authoritative statutory due dates — always verify against current government notifications.</span>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
        <Card className="min-w-0 overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
            {view !== 'dots' && (
              <>
            <div className="flex items-center gap-1">
              <Button size="icon" variant="ghost" onClick={() => step(-1)} aria-label="Previous">
                <ChevronLeft />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => step(1)} aria-label="Next">
                <ChevronRight />
              </Button>
              <Button size="sm" onClick={() => set({ date: '' })}>
                Today
              </Button>
            </div>
            <h2 className="min-w-[160px] text-[15px] font-semibold text-ink-900">{title}</h2>
              </>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <FilterMenu label="Client" searchable selected={f.client} onChange={(v) => set({ client: v })} options={visibleClients(db, me).map((c) => ({ value: c.id, label: c.name }))} />
              <FilterMenu label="Employee" searchable selected={f.assignee} onChange={(v) => set({ assignee: v })} options={people.map((u) => ({ value: u.id, label: u.name, icon: <Avatar user={u} size="xs" /> }))} />
              <FilterMenu label="Category" selected={f.category} onChange={(v) => set({ category: v })} options={db.categories.map((c) => ({ value: c.id, label: c.name }))} />
              <FilterMenu
                label="Status"
                selected={f.status}
                onChange={(v) => set({ status: v })}
                options={STATUS_ORDER.map((s) => ({ value: s, label: STATUS_META[s].label, icon: <span className={cn('size-2 rounded-full', STATUS_META[s].dot)} /> }))}
              />
              {filterCount > 0 && (
                <Button variant="ghost" size="sm" onClick={() => set({ client: '', assignee: '', category: '', status: '' })}>
                  Clear
                </Button>
              )}
            </div>
          </div>
          {view === 'month' && <MonthView anchor={anchor} byDay={byDay} />}
          {view === 'week' && <WeekView anchor={anchor} byDay={byDay} />}
          {view === 'agenda' && <AgendaView anchor={anchor} tasks={tasks} />}
          {view === 'dots' && <DeadlineCalendar tasks={tasks} size="lg" />}
          <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-2">
            {STATUS_ORDER.map((s) => (
              <span key={s} className="flex items-center gap-1.5 text-2xs text-ink-500">
                <span className={cn('size-2 rounded-full', STATUS_META[s].dot)} />
                {STATUS_META[s].label}
              </span>
            ))}
            <span className="flex items-center gap-1.5 text-2xs text-ink-500">
              <span className="size-2 rounded-full bg-red-500 ring-2 ring-red-200" />
              Overdue
            </span>
          </div>
        </Card>

        <SummaryPanel tasks={tasks} anchor={anchor} view={view} />
      </div>
    </div>
  );
}

function CalendarChip({ task }: { task: Task }) {
  const { openTask } = useUI();
  const { clients } = useLookup();
  const overdue = isOverdue(task);
  return (
    <button
      onClick={() => openTask(task.id)}
      title={`${task.title} · ${clients.get(task.clientId)?.name}`}
      className={cn(
        'flex w-full items-center gap-1.5 truncate rounded px-1.5 py-0.5 text-left text-2xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
        overdue ? 'bg-red-50 text-red-800 hover:bg-red-100' : task.status === 'completed' ? 'bg-emerald-50/70 text-emerald-800 line-through decoration-emerald-400 hover:bg-emerald-50' : 'bg-slate-100 text-ink-800 hover:bg-slate-200',
      )}
    >
      <span className={cn('size-1.5 shrink-0 rounded-full', overdue ? 'bg-red-500' : STATUS_META[task.status].dot)} />
      <span className="truncate">{task.title}</span>
    </button>
  );
}

function MonthView({ anchor, byDay }: { anchor: Date; byDay: Map<string, Task[]> }) {
  const start = startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 });
  const end = endOfWeek(endOfMonth(anchor), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start, end });
  const today = todayKey();
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[720px]">
        <div className="grid grid-cols-7 border-b border-line bg-slate-50/60">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <div key={d} className="px-2 py-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-400">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d, i) => {
            const key = toDateKey(d);
            const items = (byDay.get(key) ?? []).sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)));
            const inMonth = isSameMonth(d, anchor);
            return (
              <div key={key} className={cn('min-h-[112px] border-b border-line p-1.5', i % 7 !== 6 && 'border-r', !inMonth && 'bg-slate-50/50')}>
                <div className="mb-1 flex items-center justify-between">
                  <span
                    className={cn(
                      'flex size-6 items-center justify-center rounded-full text-xs tabular-nums',
                      key === today ? 'bg-brand-600 font-semibold text-white' : inMonth ? 'text-ink-700' : 'text-ink-300',
                    )}
                  >
                    {format(d, 'd')}
                  </span>
                  {items.length > 0 && <span className="text-2xs tabular-nums text-ink-400">{items.length}</span>}
                </div>
                <div className="space-y-0.5">
                  {items.slice(0, 3).map((t) => (
                    <CalendarChip key={t.id} task={t} />
                  ))}
                  {items.length > 3 && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <button className="w-full rounded px-1.5 py-0.5 text-left text-2xs font-medium text-brand-700 hover:bg-brand-50">+{items.length - 3} more</button>
                      </PopoverTrigger>
                      <PopoverContent className="w-64 p-2">
                        <p className="mb-1.5 px-1 text-xs font-semibold text-ink-900">{format(d, 'EEEE, d MMMM')}</p>
                        <div className="space-y-0.5">
                          {items.map((t) => (
                            <CalendarChip key={t.id} task={t} />
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function WeekView({ anchor, byDay }: { anchor: Date; byDay: Map<string, Task[]> }) {
  const start = startOfWeek(anchor, { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const today = todayKey();
  const { clients, users } = useLookup();
  const { openTask } = useUI();
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[840px] grid-cols-7 divide-x divide-line">
        {days.map((d) => {
          const key = toDateKey(d);
          const items = byDay.get(key) ?? [];
          return (
            <div key={key} className="min-h-[420px]">
              <div className={cn('border-b border-line px-2 py-2 text-center', key === today && 'bg-brand-50')}>
                <p className="text-2xs font-semibold uppercase text-ink-400">{format(d, 'EEE')}</p>
                <p className={cn('text-lg font-semibold tabular-nums', key === today ? 'text-brand-700' : 'text-ink-900')}>{format(d, 'd')}</p>
              </div>
              <div className="space-y-1.5 p-1.5">
                {items.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => openTask(t.id)}
                    className={cn(
                      'block w-full rounded-md border-l-2 bg-white p-1.5 text-left shadow-card ring-1 ring-line transition-shadow hover:shadow-pop',
                      isOverdue(t) ? 'border-l-red-500' : t.status === 'completed' ? 'border-l-emerald-500' : t.status === 'in_review' ? 'border-l-violet-500' : t.status === 'changes_requested' ? 'border-l-orange-500' : t.status === 'in_progress' ? 'border-l-blue-500' : 'border-l-slate-400',
                    )}
                  >
                    <p className="line-clamp-2 text-2xs font-medium leading-snug text-ink-900">{t.title}</p>
                    <p className="mt-0.5 truncate text-[10px] text-ink-500">{clients.get(t.clientId)?.name}</p>
                    <span className="mt-1 flex items-center gap-1">
                      <Avatar user={users.get(t.assigneeId)} size="xs" />
                    </span>
                  </button>
                ))}
                {!items.length && <p className="py-4 text-center text-2xs text-ink-300">—</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AgendaView({ anchor, tasks }: { anchor: Date; tasks: Task[] }) {
  const { clients, users } = useLookup();
  const { openTask } = useUI();
  const from = toDateKey(anchor);
  const to = toDateKey(addDays(anchor, 60));
  const overdue = tasks.filter(isOverdue).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const upcoming = tasks.filter((t) => t.dueDate >= from && t.dueDate <= to && !isOverdue(t)).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const groups = new Map<string, Task[]>();
  upcoming.forEach((t) => groups.set(t.dueDate, [...(groups.get(t.dueDate) ?? []), t]));
  if (!overdue.length && !upcoming.length) return <EmptyState icon={<SearchX />} title="No deadlines in this range" description="Try a different date or clear filters." />;
  const Row = ({ t }: { t: Task }) => (
    <button onClick={() => openTask(t.id)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-slate-50">
      <span className={cn('size-2 shrink-0 rounded-full', isOverdue(t) ? 'bg-red-500' : STATUS_META[t.status].dot)} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-ink-900">{t.title}</p>
        <p className="truncate text-xs text-ink-500">
          {clients.get(t.clientId)?.name} · {users.get(t.assigneeId)?.name}
        </p>
      </div>
      <StatusBadge status={t.status} />
      <DueDate task={t} className="w-24 justify-end" />
    </button>
  );
  return (
    <div className="max-h-[640px] overflow-y-auto">
      {overdue.length > 0 && (
        <section>
          <h3 className="sticky top-0 z-10 border-b border-red-100 bg-red-50 px-4 py-1.5 text-2xs font-semibold uppercase tracking-wide text-red-700">Overdue · {overdue.length}</h3>
          <div className="divide-y divide-line">
            {overdue.map((t) => (
              <Row key={t.id} t={t} />
            ))}
          </div>
        </section>
      )}
      {[...groups.entries()].map(([day, items]) => (
        <section key={day}>
          <h3 className={cn('sticky top-0 z-10 border-y border-line bg-slate-50 px-4 py-1.5 text-2xs font-semibold uppercase tracking-wide', day === todayKey() ? 'text-brand-700' : 'text-ink-500')}>
            {format(parseISO(day), 'EEEE, d MMMM')} {day === todayKey() && '· Today'}
          </h3>
          <div className="divide-y divide-line">
            {items.map((t) => (
              <Row key={t.id} t={t} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function SummaryPanel({ tasks, anchor, view }: { tasks: Task[]; anchor: Date; view: View }) {
  const { openTask } = useUI();
  const { clients } = useLookup();
  const start = view === 'week' ? startOfWeek(anchor, { weekStartsOn: 1 }) : view === 'agenda' ? anchor : startOfMonth(anchor);
  const end = view === 'week' ? endOfWeek(anchor, { weekStartsOn: 1 }) : view === 'agenda' ? addDays(anchor, 60) : endOfMonth(anchor);
  const [s, e] = [toDateKey(start), toDateKey(end)];
  const inRange = tasks.filter((t) => t.dueDate >= s && t.dueDate <= e);
  const stats = [
    { label: 'Deadlines in period', value: inRange.length, tone: 'text-ink-900' },
    { label: 'Completed', value: inRange.filter((t) => t.status === 'completed').length, tone: 'text-emerald-600' },
    { label: 'Open', value: inRange.filter(isOpen).length, tone: 'text-brand-700' },
    { label: 'Overdue', value: inRange.filter(isOverdue).length, tone: 'text-red-600' },
  ];
  const next = tasks.filter((t) => isOpen(t) && t.dueDate >= todayKey()).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 6);
  const pct = inRange.length ? Math.round((stats[1].value / inRange.length) * 100) : 0;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Deadline summary" description={`${format(start, 'd MMM')} – ${format(end, 'd MMM')}`} />
        <div className="grid grid-cols-2 divide-x divide-y divide-line border-b border-line">
          {stats.map((st) => (
            <div key={st.label} className="px-4 py-3">
              <p className={cn('text-xl font-semibold tabular-nums', st.tone)}>{st.value}</p>
              <p className="text-2xs text-ink-500">{st.label}</p>
            </div>
          ))}
        </div>
        <div className="px-4 py-3">
          <div className="mb-1 flex justify-between text-2xs text-ink-500">
            <span>Completion</span>
            <span className="tabular-nums">{pct}%</span>
          </div>
          <div className="flex h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className="bg-emerald-500" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Next up" />
        {next.length ? (
          <ul className="divide-y divide-line">
            {next.map((t) => (
              <li key={t.id}>
                <button onClick={() => openTask(t.id)} className="block w-full px-4 py-2 text-left hover:bg-slate-50">
                  <p className="truncate text-xs font-medium text-ink-900">{t.title}</p>
                  <p className="flex items-center justify-between gap-2 text-2xs text-ink-500">
                    <span className="truncate">{clients.get(t.clientId)?.name}</span>
                    <DueDate task={t} showIcon={false} className="text-2xs" />
                  </p>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3 text-xs text-ink-400">No upcoming deadlines.</p>
        )}
      </Card>
    </div>
  );
}
