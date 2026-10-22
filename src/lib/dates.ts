import {
  differenceInCalendarDays,
  format,
  formatDistanceToNowStrict,
  isToday,
  isTomorrow,
  isYesterday,
  parseISO,
  startOfDay,
} from 'date-fns';

/** Dates are stored as ISO strings. Due dates use the yyyy-MM-dd form. */
export const toDateKey = (d: Date) => format(d, 'yyyy-MM-dd');
export const parse = (s: string) => parseISO(s);
export const today = () => startOfDay(new Date());
export const todayKey = () => toDateKey(new Date());

export function daysUntil(dateKey: string) {
  return differenceInCalendarDays(parseISO(dateKey), today());
}

export function formatDate(s: string | undefined, pattern = 'd MMM yyyy') {
  if (!s) return '—';
  return format(parseISO(s), pattern);
}

export function formatShortDate(s: string) {
  const d = parseISO(s);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return format(d, sameYear ? 'd MMM' : 'd MMM yy');
}

export function relativeDay(dateKey: string) {
  const d = parseISO(dateKey);
  if (isToday(d)) return 'Today';
  if (isTomorrow(d)) return 'Tomorrow';
  if (isYesterday(d)) return 'Yesterday';
  const n = daysUntil(dateKey);
  if (n < 0) return `${-n}d overdue`;
  if (n < 7) return format(d, 'EEEE');
  return formatShortDate(dateKey);
}

export function timeAgo(iso: string) {
  const d = parseISO(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return 'just now';
  return `${formatDistanceToNowStrict(d)} ago`;
}

export function formatDateTime(iso: string) {
  return format(parseISO(iso), "d MMM yyyy, h:mm a");
}
