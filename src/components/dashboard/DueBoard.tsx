import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, PartyPopper } from 'lucide-react';
import { Card, EmptyState, Tabs } from '@/components/ui/misc';
import { Avatar } from '@/components/badges';
import { QuickStatusMenu } from '@/components/tasks/TaskList';
import { formatDate } from '@/lib/dates';
import { useLookup } from '@/lib/lookup';
import { BUCKETS, DASHBOARD_GROUPS, inBucket, inGroup, periodOf, serviceLabel, type BucketId, type DashboardGroup } from '@/lib/buckets';
import { byUrgency, isOverdue } from '@/lib/metrics';
import { cn } from '@/lib/utils';
import { useCurrentUser, useDb } from '@/store/store';
import { useUI } from '@/store/ui';
import type { Task } from '@/types';

const TABLE_TITLE: Record<BucketId, string> = {
  today: 'Tasks due today',
  tomorrow: 'Tasks due tomorrow',
  week: 'Tasks due in the next 7 days',
  later: 'Tasks due after 7 days',
  od7: 'Overdue up to 7 days',
  od7plus: 'Overdue more than 7 days',
  total: 'All pending tasks',
};
const TASKS_LINK: Partial<Record<BucketId, string>> = { today: 'due=today', week: 'due=week&status=open', od7: 'due=overdue', od7plus: 'due=overdue', later: 'due=later&status=open', total: 'status=open' };
const GROUP_CATS: Partial<Record<DashboardGroup, string>> = { gst: 'gst', itr: 'itr', tds: 'tds', mca: 'roc', other: 'acc,aud,pay,adv' };

/** Group tabs + seven due/overdue tiles + task table (design brief, option 2). */
export function DueBoard({ tasks, title = 'Work station' }: { tasks: Task[]; title?: string }) {
  const db = useDb();
  const me = useCurrentUser();
  const { users, clients } = useLookup();
  const services = useMemo(() => new Map(db.services.map((s) => [s.id, s])), [db.services]);
  const { openTask } = useUI();
  const [group, setGroup] = useState<DashboardGroup>('all');
  const [bucket, setBucket] = useState<BucketId>('today');

  const inG = tasks.filter((t) => inGroup(t, group, me.id));
  const counts = Object.fromEntries(BUCKETS.map((b) => [b.id, inG.filter((t) => inBucket(t, b.id)).length])) as Record<BucketId, number>;
  const rows = inG.filter((t) => inBucket(t, bucket)).sort(byUrgency);
  const groupLabel = DASHBOARD_GROUPS.find((g) => g.id === group)!.label;
  const link = `/tasks?${[TASKS_LINK[bucket], GROUP_CATS[group] && `category=${GROUP_CATS[group]}`, group === 'todo' && `assignee=${me.id}`].filter(Boolean).join('&')}`;

  return (
    <Card className="overflow-hidden">
      <div className="px-4 pt-3">
        <h2 className="mb-1 text-[13px] font-semibold text-ink-900">{title}</h2>
        <Tabs
          value={group}
          onChange={(g) => setGroup(g)}
          tabs={DASHBOARD_GROUPS.map((g) => ({ value: g.id, label: g.label, count: tasks.filter((t) => inGroup(t, g.id, me.id) && inBucket(t, 'total')).length }))}
        />
      </div>
      <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4 xl:grid-cols-7">
        {BUCKETS.map((b) => (
          <button
            key={b.id}
            onClick={() => setBucket(b.id)}
            aria-pressed={bucket === b.id}
            className={cn(
              'flex flex-col items-center rounded-lg border bg-white px-2 py-3 text-center transition-all hover:-translate-y-px hover:shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
              bucket === b.id ? 'border-brand-300 ring-1 ring-brand-200' : 'border-line',
            )}
          >
            <span className="text-xs font-medium text-ink-600">{b.label}</span>
            <span className={cn('my-0.5 text-3xl font-semibold tabular-nums leading-tight', b.tone)}>{counts[b.id]}</span>
            <span className="text-2xs leading-tight text-ink-500">{b.sub}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between border-t border-line px-4 py-2.5">
        <p className="text-[13px] font-semibold text-ink-900">
          {TABLE_TITLE[bucket]} <span className="font-normal text-ink-500">· {groupLabel}</span>
        </p>
        <Link to={link} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
          View all <ArrowRight className="size-3" />
        </Link>
      </div>
      {rows.length === 0 ? (
        <EmptyState compact icon={<PartyPopper />} title="Nothing here" description={`No ${groupLabel === 'All Tasks' ? '' : groupLabel + ' '}tasks in this bucket.`} />
      ) : (
        <div className="max-h-[360px] overflow-auto">
          <table className="w-full min-w-[820px] text-left">
            <thead className="sticky top-0 z-10 bg-slate-50">
              <tr className="border-y border-line text-2xs font-semibold uppercase tracking-wide text-ink-500">
                <th className="px-4 py-2">Client</th>
                <th className="px-3 py-2">Task</th>
                <th className="px-3 py-2">Period</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Due date</th>
                <th className="px-4 py-2">Working user</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.slice(0, 50).map((t) => {
                const u = users.get(t.assigneeId);
                return (
                  <tr key={t.id} className="cursor-pointer hover:bg-slate-50" onClick={() => openTask(t.id)}>
                    <td className="max-w-[220px] truncate px-4 py-2 text-xs text-ink-800">{clients.get(t.clientId)?.name}</td>
                    <td className="px-3 py-2">
                      <span className="block max-w-[260px] truncate text-[13px] font-semibold text-ink-900">{serviceLabel(t, services)}</span>
                      <span className="font-mono text-2xs text-ink-400">{t.id}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-700">{periodOf(t)}</td>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <QuickStatusMenu task={t} trigger="badge" />
                    </td>
                    <td className={cn('whitespace-nowrap px-3 py-2 text-xs font-medium tabular-nums', isOverdue(t) ? 'text-red-600' : 'text-ink-800')}>{formatDate(t.dueDate, 'dd-MM-yyyy')}</td>
                    <td className="px-4 py-2">
                      <span className="flex items-center gap-1.5 text-xs text-ink-700">
                        <Avatar user={u} size="xs" />
                        {u?.name}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
