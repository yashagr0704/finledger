import type { FilingStage, Frequency, Priority, Role, TaskStatus } from '@/types';

export const STATUS_ORDER: TaskStatus[] = ['not_started', 'in_progress', 'in_review', 'changes_requested', 'completed'];

export const STATUS_META: Record<TaskStatus, { label: string; tone: string; dot: string }> = {
  not_started: { label: 'Not Started', tone: 'bg-slate-100 text-slate-700 ring-slate-200', dot: 'bg-slate-400' },
  in_progress: { label: 'In Progress', tone: 'bg-blue-50 text-blue-700 ring-blue-200', dot: 'bg-blue-500' },
  in_review: { label: 'In Review', tone: 'bg-violet-50 text-violet-700 ring-violet-200', dot: 'bg-violet-500' },
  changes_requested: { label: 'Changes Requested', tone: 'bg-orange-50 text-orange-700 ring-orange-200', dot: 'bg-orange-500' },
  completed: { label: 'Completed', tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500' },
};

/** Long label for places with room ("Submitted for Review"). */
export const STATUS_LONG_LABEL: Record<TaskStatus, string> = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  in_review: 'Submitted for Review',
  changes_requested: 'Changes Requested',
  completed: 'Completed',
};

export const PRIORITY_ORDER: Priority[] = ['urgent', 'high', 'medium', 'low'];
export const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

export const PRIORITY_META: Record<Priority, { label: string; text: string; bars: number }> = {
  urgent: { label: 'Urgent', text: 'text-red-600', bars: 4 },
  high: { label: 'High', text: 'text-orange-600', bars: 3 },
  medium: { label: 'Medium', text: 'text-ink-700', bars: 2 },
  low: { label: 'Low', text: 'text-ink-500', bars: 1 },
};

export const FILING_STAGES: FilingStage[] = ['preparation', 'review', 'ready_to_file', 'filed'];
export const FILING_META: Record<FilingStage, string> = {
  preparation: 'Preparation',
  review: 'Review',
  ready_to_file: 'Ready to File',
  filed: 'Filed',
};

export const ROLE_META: Record<Role, { label: string; short: string; description: string }> = {
  admin: { label: 'Firm Admin', short: 'Admin', description: 'Full access to clients, tasks, team, reports and settings.' },
  manager: { label: 'Manager / Reviewer', short: 'Manager', description: 'Manages assigned clients and team tasks, reviews submitted work.' },
  employee: { label: 'Employee', short: 'Employee', description: 'Works on assigned tasks and submits them for review.' },
};

export const FREQUENCY_META: Record<Frequency, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  half_yearly: 'Half-yearly',
  annual: 'Annual',
  custom: 'Custom',
};

/** Categorical chart palette (validated order; see dataviz reference palette). */
export const CHART_SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
export const CHART_BRAND = '#4a47c9';
