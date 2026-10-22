import { addMonths, endOfMonth, format, getDaysInMonth, startOfMonth } from 'date-fns';
import { toDateKey } from './dates';

/** Indian financial year label for a date, e.g. "FY 2026-27". */
export function fyLabel(d: Date) {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `FY ${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

/** Indian FY quarter for a period-end date: Apr–Jun = Q1 … Jan–Mar = Q4. */
export function quarterLabel(periodEnd: Date) {
  const m = periodEnd.getMonth();
  const q = m >= 3 ? Math.floor((m - 3) / 3) + 1 : 4;
  return `Q${q} ${fyLabel(periodEnd)}`;
}

export function monthLabel(d: Date) {
  return format(d, 'MMM yyyy');
}

/** Builds a date on `day` of the month containing `monthDate`, clamped to month length. */
export function dayInMonth(monthDate: Date, day: number) {
  const base = startOfMonth(monthDate);
  return new Date(base.getFullYear(), base.getMonth(), Math.min(day, getDaysInMonth(base)));
}

export interface Period {
  label: string;
  periodEnd: string;
  dueDate: string;
}

/**
 * Period-end months for each frequency. Quarterly/half-yearly/annual align
 * with the Indian financial year (April–March).
 */
function isPeriodEnd(month: number, frequency: string, intervalMonths = 1) {
  switch (frequency) {
    case 'monthly':
      return true;
    case 'quarterly':
      return [5, 8, 11, 2].includes(month);
    case 'half_yearly':
      return [8, 2].includes(month);
    case 'annual':
      return month === 2;
    case 'custom':
      // Custom intervals are counted from the start of the financial year (April).
      return (((month - 3 + 12) % 12) + 1) % Math.max(1, intervalMonths) === 0;
    default:
      return false;
  }
}

/** Upcoming periods whose due date falls on or after `from`. */
export function upcomingPeriods(
  opts: { frequency: string; intervalMonths?: number; dueDay: number; dueMonthOffset: number },
  from: Date,
  count: number,
): Period[] {
  const out: Period[] = [];
  // Start far enough back that periods ending earlier but due later are included.
  let cursor = addMonths(startOfMonth(from), -(opts.dueMonthOffset + 12));
  let guard = 0;
  while (out.length < count && guard < 120) {
    guard += 1;
    const m = cursor.getMonth();
    if (isPeriodEnd(m, opts.frequency, opts.intervalMonths)) {
      const end = endOfMonth(cursor);
      const due = dayInMonth(addMonths(cursor, opts.dueMonthOffset), opts.dueDay);
      if (toDateKey(due) >= toDateKey(from)) {
        let label: string;
        if (opts.frequency === 'monthly') label = monthLabel(end);
        else if (opts.frequency === 'quarterly') label = quarterLabel(end);
        else if (opts.frequency === 'half_yearly') label = `${end.getMonth() === 8 ? 'H1' : 'H2'} ${fyLabel(end)}`;
        else if (opts.frequency === 'annual') label = fyLabel(end);
        else label = `Period ending ${format(end, 'MMM yyyy')}`;
        out.push({ label, periodEnd: toDateKey(end), dueDate: toDateKey(due) });
      }
    }
    cursor = addMonths(cursor, 1);
  }
  return out;
}
