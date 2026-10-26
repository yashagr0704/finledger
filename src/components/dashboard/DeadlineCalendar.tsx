import { useState } from 'react';
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, startOfMonth, startOfWeek } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/badges';
import { toDateKey, todayKey } from '@/lib/dates';
import { useLookup } from '@/lib/lookup';
import { proximityTone, TONE_CLASS } from '@/lib/buckets';
import { cn } from '@/lib/utils';
import { useDb } from '@/store/store';
import { useUI } from '@/store/ui';
import type { Task } from '@/types';

/**
 * Month grid where each date shows up to 4 status dots coloured by how close
 * the deadline is (green → yellow → red), as requested in the design brief.
 */
export function DeadlineCalendar({ tasks, size = 'md' }: { tasks: Task[]; size?: 'md' | 'lg' }) {
  const db = useDb();
  const { clients } = useLookup();
  const { openTask } = useUI();
  const [month, setMonth] = useState(startOfMonth(new Date()));
  const [selected, setSelected] = useState(todayKey());
  const days = eachDayOfInterval({ start: startOfWeek(month), end: endOfWeek(endOfMonth(month)) });
  const byDay = new Map<string, Task[]>();
  tasks.forEach((t) => byDay.set(t.dueDate, [...(byDay.get(t.dueDate) ?? []), t]));
  const dayTasks = byDay.get(selected) ?? [];
  const lg = size === 'lg';

  return (
    <div>
      <div className="flex items-center gap-1 px-3 pt-3">
        <span className="mr-auto text-[13px] font-semibold text-ink-900">{format(month, 'MMM yyyy')}</span>
        <Button size="icon-sm" variant="ghost" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month">
          <ChevronLeft />
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month">
          <ChevronRight />
        </Button>
        <Button size="sm" onClick={() => (setMonth(startOfMonth(new Date())), setSelected(todayKey()))}>
          Today
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-1 p-3 pb-2">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="pb-1 text-center text-2xs font-semibold uppercase text-ink-400">
            {lg ? d : d[0]}
          </div>
        ))}
        {days.map((d) => {
          const key = toDateKey(d);
          const items = byDay.get(key) ?? [];
          const isToday = key === todayKey();
          return (
            <button
              key={key}
              onClick={() => setSelected(key)}
              aria-pressed={selected === key}
              aria-label={`${format(d, 'd MMMM')}: ${items.length} deadlines`}
              className={cn(
                'flex flex-col items-center rounded-md border border-transparent transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
                lg ? 'min-h-[64px] py-1.5' : 'py-1',
                !isSameMonth(d, month) && 'opacity-40',
                selected === key && 'border-brand-200 bg-brand-50 hover:bg-brand-50',
              )}
            >
              <span className={cn('flex size-6 items-center justify-center rounded-full text-xs tabular-nums', isToday ? 'bg-brand-600 font-semibold text-white' : 'text-ink-800')}>{format(d, 'd')}</span>
              <span className="mt-1 flex min-h-2 flex-wrap justify-center gap-[3px] px-0.5">
                {items.slice(0, 4).map((t) => (
                  <span key={t.id} className={cn('size-2 rounded-[3px]', TONE_CLASS[proximityTone(t, db.firm.atRiskDays)])} />
                ))}
              </span>
              {lg && items.length > 4 && <span className="mt-0.5 text-[10px] text-ink-400">+{items.length - 4}</span>}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3 px-3 pb-2 text-2xs text-ink-500">
        <Legend tone="green" label="Due date comfortable" />
        <Legend tone="yellow" label={`Due within ${db.firm.atRiskDays} days`} />
        <Legend tone="red" label="Due date passed" />
        <Legend tone="done" label="Completed" />
      </div>
      <div className="border-t border-line">
        <p className="px-3 pt-2 text-2xs font-semibold uppercase tracking-wide text-ink-400">{selected === todayKey() ? 'Today' : format(new Date(selected), 'EEE d MMM')}</p>
        {dayTasks.length ? (
          <ul className="max-h-56 divide-y divide-line overflow-y-auto">
            {dayTasks.map((t) => (
              <li key={t.id}>
                <button onClick={() => openTask(t.id)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50">
                  <span className={cn('size-2 shrink-0 rounded-[3px]', TONE_CLASS[proximityTone(t, db.firm.atRiskDays)])} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-ink-900">{t.title}</span>
                    <span className="block truncate text-2xs text-ink-500">{clients.get(t.clientId)?.name}</span>
                  </span>
                  <StatusBadge status={t.status} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-3 py-3 text-xs text-ink-400">No deadlines on this date.</p>
        )}
      </div>
    </div>
  );
}

function Legend({ tone, label }: { tone: keyof typeof TONE_CLASS; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn('size-2 rounded-[3px]', TONE_CLASS[tone])} />
      {label}
    </span>
  );
}
