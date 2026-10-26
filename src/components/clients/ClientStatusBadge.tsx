import { cn } from '@/lib/utils';
import type { ClientStatus } from '@/types';

const STATUS_TONE: Record<ClientStatus, string> = {
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  onboarding: 'bg-sky-50 text-sky-700 ring-sky-200',
  inactive: 'bg-slate-100 text-ink-500 ring-slate-200',
};

const LABEL: Record<ClientStatus, string> = { active: 'Active', onboarding: 'Onboarding', inactive: 'Left the firm' };

export function ClientStatusBadge({ status }: { status: ClientStatus }) {
  return <span className={cn('inline-flex h-5 items-center whitespace-nowrap rounded-full px-2 text-2xs font-medium ring-1 ring-inset', STATUS_TONE[status])}>{LABEL[status]}</span>;
}
