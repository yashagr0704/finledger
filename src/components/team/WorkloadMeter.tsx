import { isOpen, workloadFor, type WorkloadLevel } from '@/lib/metrics';
import { cn } from '@/lib/utils';
import { useDb } from '@/store/store';
import type { User } from '@/types';

export const WORKLOAD_META: Record<WorkloadLevel, { label: string; bar: string; text: string }> = {
  light: { label: 'Light', bar: 'bg-slate-400', text: 'text-ink-500' },
  balanced: { label: 'Balanced', bar: 'bg-emerald-500', text: 'text-emerald-700' },
  heavy: { label: 'Heavy', bar: 'bg-amber-500', text: 'text-amber-700' },
  over: { label: 'Over capacity', bar: 'bg-red-500', text: 'text-red-600' },
};

export function WorkloadMeter({ user, compact }: { user: User; compact?: boolean }) {
  const db = useDb();
  const w = workloadFor(db.tasks.filter(isOpen), user);
  const m = WORKLOAD_META[w.level];
  return (
    <div className={cn('min-w-0', compact ? 'w-24' : 'w-36')} title={`${w.hours}h of ${user.capacityHours * 2}h capacity over the next 14 days`}>
      <div className="mb-1 flex justify-between text-2xs">
        <span className={cn('font-medium', m.text)}>{m.label}</span>
        <span className="tabular-nums text-ink-400">{w.pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className={cn('h-full rounded-full', m.bar)} style={{ width: `${Math.min(100, w.pct)}%` }} />
      </div>
    </div>
  );
}

