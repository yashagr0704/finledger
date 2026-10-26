import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

const TONES = {
  neutral: 'text-ink-500 bg-slate-100',
  brand: 'text-brand-600 bg-brand-50',
  amber: 'text-amber-600 bg-amber-50',
  red: 'text-red-600 bg-red-50',
  violet: 'text-violet-600 bg-violet-50',
  emerald: 'text-emerald-600 bg-emerald-50',
};

export function KpiCard({
  label,
  value,
  icon,
  tone = 'neutral',
  to,
  hint,
  emphasize,
  trend,
}: {
  label: string;
  value: number | string;
  icon: ReactNode;
  tone?: keyof typeof TONES;
  to: string;
  hint?: ReactNode;
  emphasize?: boolean;
  /** Percentage change vs last month; `goodWhenUp` decides the colour. */
  trend?: { pct: number; goodWhenUp: boolean };
}) {
  return (
    <Link
      to={to}
      className={cn(
        'group flex flex-col rounded-lg border border-line bg-white p-3.5 shadow-card transition-all hover:-translate-y-px hover:border-slate-300 hover:shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
        emphasize && 'border-red-200',
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-ink-500">{label}</span>
        <span className={cn('flex size-6 items-center justify-center rounded-md [&_svg]:size-3.5', TONES[tone])}>{icon}</span>
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <span className="flex items-baseline gap-2">
          <span className={cn('text-2xl font-semibold tabular-nums tracking-tight', emphasize ? 'text-red-600' : 'text-ink-900')}>{value}</span>
          {trend && Number.isFinite(trend.pct) && (
            <span
              className={cn(
                'text-xs font-semibold tabular-nums',
                trend.pct === 0 ? 'text-ink-400' : trend.pct > 0 === trend.goodWhenUp ? 'text-emerald-600' : 'text-red-600',
              )}
              title="vs last month"
            >
              {trend.pct > 0 ? '+' : ''}
              {trend.pct}%
            </span>
          )}
        </span>
        <ArrowRight className="mb-1 size-3.5 -translate-x-1 text-ink-300 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
      </div>
      {hint && <div className="mt-0.5 truncate text-2xs text-ink-500">{hint}</div>}
    </Link>
  );
}
