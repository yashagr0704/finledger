import type { ReactNode } from 'react';

/** Shared tooltip body for Recharts charts. */
export function ChartTooltip({
  active,
  payload,
  label,
  formatter,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number | string; color?: string; dataKey?: string | number }[];
  label?: ReactNode;
  formatter?: (v: number | string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-line bg-white px-3 py-2 text-xs shadow-pop">
      {label !== undefined && <p className="mb-1 font-medium text-ink-900">{label}</p>}
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="flex items-center gap-2 text-ink-600">
          <span className="size-2 rounded-sm" style={{ background: p.color }} />
          {p.name}
          <span className="ml-auto pl-3 font-medium tabular-nums text-ink-900">{formatter ? formatter(p.value ?? 0) : p.value}</span>
        </p>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5 text-xs text-ink-600">
          <span className="size-2 rounded-sm" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export const axisProps = {
  tick: { fontSize: 11, fill: '#64748b' },
  tickLine: false,
  axisLine: false,
} as const;
