import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { subDays } from 'date-fns';
import { ChevronLeft, ChevronRight, Columns3, Download, FilterX, List, Plus, Search, SearchX, UserRoundCog, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, PageHeader, Segmented } from '@/components/ui/misc';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from '@/components/ui/menu';
import { Select } from '@/components/ui/form';
import { Avatar, PriorityIcon } from '@/components/badges';
import { FilterMenu } from '@/components/tasks/FilterMenu';
import { TaskTable } from '@/components/tasks/TaskTable';
import { KanbanBoard } from '@/components/tasks/KanbanBoard';
import { TaskListItem } from '@/components/tasks/TaskList';
import { PRIORITY_META, PRIORITY_ORDER, STATUS_META } from '@/lib/constants';
import { useConfirm } from '@/components/ui/confirm';
import { assignableUsers, canBulkReassign, canCreateTask, visibleClients, visibleTasks } from '@/lib/permissions';
import { applyFilters, countActive, DUE_OPTIONS, readFilters, STATUS_FILTER_VALUES, type TaskFilters } from '@/lib/taskFilters';
import { cn, readLocal, writeLocal } from '@/lib/utils';
import { store, useCurrentUser, useDb } from '@/store/store';
import { useUI } from '@/store/ui';
import { brand } from '@/config/brand';

const PAGE_SIZE = 25;
const VIEW_KEY = `${brand.storageKey}.taskView`;

export default function Tasks() {
  const db = useDb();
  const me = useCurrentUser();
  const [params, setParams] = useSearchParams();
  const { openTaskForm } = useUI();
  const { confirm, dialog } = useConfirm();
  const filters = useMemo(() => readFilters(params), [params]);
  const view = (params.get('view') as 'table' | 'board') || (readLocal(VIEW_KEY) as 'table' | 'board' | null) || 'table';
  const page = Math.max(1, Number(params.get('page') ?? 1));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [qInput, setQInput] = useState(filters.q);

  const update = (patch: Partial<Record<keyof TaskFilters | 'view' | 'page', string | string[]>>) => {
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        for (const [k, v] of Object.entries(patch)) {
          const val = Array.isArray(v) ? v.join(',') : v;
          if (val) next.set(k, val);
          else next.delete(k);
        }
        if (!('page' in patch)) next.delete('page');
        return next;
      },
      { replace: true },
    );
  };

  // Debounce search input into the URL.
  useEffect(() => {
    const t = setTimeout(() => qInput !== filters.q && update({ q: qInput }), 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput]);
  useEffect(() => setQInput(filters.q), [filters.q]);

  const scoped = useMemo(() => visibleTasks(db, me), [db, me]);
  const filtered = useMemo(() => applyFilters(scoped, filters), [scoped, filters]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const pageItems = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  // Board hides old completed work to stay readable.
  const cutoff = subDays(new Date(), 30).toISOString();
  const boardTasks = filtered.filter((t) => t.status !== 'completed' || (t.completedAt ?? '') >= cutoff);

  // Drop selections that are no longer visible.
  useEffect(() => {
    setSelected((s) => {
      const ids = new Set(filtered.map((t) => t.id));
      const next = new Set([...s].filter((id) => ids.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [filtered]);

  const clients = visibleClients(db, me);
  const people = db.users.filter((u) => scoped.some((t) => t.assigneeId === u.id));
  const active = countActive(filters);
  const bulk = canBulkReassign(me);
  const reassignTargets = assignableUsers(db, me);

  const quick: { key: string; label: string; apply: Partial<Record<string, string>> }[] = [
    { key: 'open', label: 'All open', apply: { status: 'open', due: '', assignee: '', completed: '' } },
    { key: 'mine', label: 'Assigned to me', apply: { status: 'open', assignee: me.id, due: '', completed: '' } },
    { key: 'overdue', label: 'Overdue', apply: { status: '', due: 'overdue', assignee: '', completed: '' } },
    { key: 'week', label: 'Due this week', apply: { status: 'open', due: 'week', assignee: '', completed: '' } },
    { key: 'review', label: 'In review', apply: { status: 'in_review', due: '', assignee: '', completed: '' } },
    { key: 'done', label: 'Completed', apply: { status: 'completed', due: '', assignee: '', completed: '' } },
  ];
  const quickActive = quick.find((qv) =>
    Object.entries(qv.apply).every(([k, v]) => {
      const cur = (filters as unknown as Record<string, string | string[]>)[k];
      return (Array.isArray(cur) ? cur.join(',') : cur) === v;
    }) && !filters.client.length && !filters.category.length && !filters.priority.length && !filters.q,
  )?.key;

  const exportCsv = () => {
    const rows = [['ID', 'Title', 'Client', 'Category', 'Assignee', 'Reviewer', 'Priority', 'Status', 'Start', 'Due', 'Estimate (h)']];
    for (const t of filtered) {
      rows.push([
        t.id,
        t.title,
        db.clients.find((c) => c.id === t.clientId)?.name ?? '',
        db.categories.find((c) => c.id === t.categoryId)?.name ?? '',
        db.users.find((u) => u.id === t.assigneeId)?.name ?? '',
        db.users.find((u) => u.id === t.reviewerId)?.name ?? '',
        PRIORITY_META[t.priority].label,
        STATUS_META[t.status].label,
        t.startDate,
        t.dueDate,
        String(t.estimateHours),
      ]);
    }
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `tasks-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filtered.length} tasks`);
  };

  return (
    <div className="animate-slide-up">
      {dialog}
      <PageHeader
        title="Tasks"
        description={me.role === 'employee' ? 'Tasks assigned to you or awaiting your review.' : me.role === 'manager' ? 'Tasks for your clients and team.' : 'All work across the firm.'}
        actions={
          <>
            <Segmented
              value={view}
              onChange={(v) => {
                writeLocal(VIEW_KEY, v);
                update({ view: v });
              }}
              options={[
                { value: 'table', label: 'Table', icon: <List /> },
                { value: 'board', label: 'Board', icon: <Columns3 /> },
              ]}
            />
            <Button onClick={exportCsv} disabled={!filtered.length}>
              <Download /> Export
            </Button>
            {canCreateTask(me) && (
              <Button variant="primary" onClick={() => openTaskForm({ mode: 'create', defaults: filters.client.length === 1 ? { clientId: filters.client[0] } : undefined })}>
                <Plus /> New task
              </Button>
            )}
          </>
        }
      />

      {/* Saved views */}
      <div className="mb-3 flex gap-1 overflow-x-auto">
        {quick.map((qv) => (
          <button
            key={qv.key}
            onClick={() => update({ ...qv.apply, client: '', category: '', priority: '', q: '' })}
            className={cn(
              'h-7 shrink-0 rounded-full px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
              quickActive === qv.key ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-white hover:text-ink-900',
            )}
          >
            {qv.label}
          </button>
        ))}
      </div>

      <Card className="overflow-hidden">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-400" />
            <input
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              placeholder="Search title or ID…"
              className="h-8 w-full rounded-md border border-line bg-white pl-8 pr-7 text-[13px] shadow-sm placeholder:text-ink-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              aria-label="Search tasks"
            />
            {qInput && (
              <button onClick={() => setQInput('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink-400 hover:text-ink-700" aria-label="Clear search">
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <FilterMenu
            label="Status"
            selected={filters.status}
            onChange={(v) => update({ status: v })}
            options={STATUS_FILTER_VALUES.map((s) => ({
              value: s,
              label: s === 'open' ? 'Any open status' : STATUS_META[s].label,
              icon: s === 'open' ? undefined : <span className={cn('size-2 rounded-full', STATUS_META[s].dot)} />,
              count: s === 'open' ? scoped.filter((t) => t.status !== 'completed').length : scoped.filter((t) => t.status === s).length,
            }))}
          />
          <FilterMenu
            label="Priority"
            selected={filters.priority}
            onChange={(v) => update({ priority: v })}
            options={PRIORITY_ORDER.map((p) => ({ value: p, label: PRIORITY_META[p].label, icon: <PriorityIcon priority={p} /> }))}
          />
          <FilterMenu
            label="Assignee"
            searchable
            selected={filters.assignee}
            onChange={(v) => update({ assignee: v })}
            options={people.map((u) => ({ value: u.id, label: u.id === me.id ? `${u.name} (you)` : u.name, icon: <Avatar user={u} size="xs" />, count: scoped.filter((t) => t.assigneeId === u.id && t.status !== 'completed').length }))}
          />
          <FilterMenu label="Client" searchable selected={filters.client} onChange={(v) => update({ client: v })} options={clients.map((c) => ({ value: c.id, label: c.name }))} />
          <FilterMenu label="Category" selected={filters.category} onChange={(v) => update({ category: v })} options={db.categories.map((c) => ({ value: c.id, label: c.name }))} />
          <FilterMenu label="Due" single selected={filters.due ? [filters.due] : []} onChange={(v) => update({ due: v[0] ?? '' })} options={DUE_OPTIONS} />
          {filters.completed === 'month' && (
            <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-brand-200 bg-brand-50 px-2.5 text-[13px] text-brand-800">
              Completed this month
              <button onClick={() => update({ completed: '' })} className="rounded p-0.5 hover:bg-brand-100" aria-label="Clear completed filter">
                <X className="size-3.5" />
              </button>
            </span>
          )}
          {active > 0 && (
            <Button size="md" variant="ghost" onClick={() => (setQInput(''), setParams(view ? { view } : {}, { replace: true }))}>
              <FilterX /> Clear
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-xs text-ink-500 md:inline">Sort</span>
            <div className="w-36">
              <Select value={filters.sort} onChange={(e) => update({ sort: e.target.value })} aria-label="Sort tasks">
                <option value="due">Due date</option>
                <option value="priority">Priority</option>
                <option value="updated">Recently updated</option>
              </Select>
            </div>
          </div>
        </div>

        {/* Bulk actions */}
        {bulk && selected.size > 0 && view === 'table' && (
          <div className="flex items-center gap-3 border-b border-brand-200 bg-brand-50 px-4 py-2 animate-fade-in">
            <span className="text-[13px] font-medium text-brand-900">{selected.size} selected</span>
            <Menu>
              <MenuTrigger asChild>
                <Button size="sm">
                  <UserRoundCog /> Reassign to…
                </Button>
              </MenuTrigger>
              <MenuContent align="start" className="max-h-80 w-60 overflow-y-auto">
                <MenuLabel>Reassign {selected.size} tasks</MenuLabel>
                {reassignTargets.map((u) => (
                  <MenuItem
                    key={u.id}
                    onSelect={() =>
                      confirm({
                        title: `Reassign ${selected.size} tasks to ${u.name}?`,
                        description: 'The new assignee will be notified. Each change is recorded in the task history.',
                        confirmLabel: 'Reassign',
                        onConfirm: () => {
                          const n = store.bulkReassign([...selected], u.id);
                          if (n !== undefined) {
                            toast.success(n ? `Reassigned ${n} task${n > 1 ? 's' : ''} to ${u.name}` : 'No changes — tasks were already assigned to them');
                            setSelected(new Set());
                          }
                        },
                      })
                    }
                  >
                    <Avatar user={u} size="xs" />
                    {u.name}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear selection
            </Button>
          </div>
        )}

        {filtered.length === 0 ? (
          scoped.length === 0 ? (
            <EmptyState
              icon={<List />}
              title="No tasks yet"
              description="Tasks you create or are assigned will appear here."
              action={
                canCreateTask(me) && (
                  <Button variant="primary" onClick={() => openTaskForm({ mode: 'create' })}>
                    <Plus /> Create the first task
                  </Button>
                )
              }
            />
          ) : (
            <EmptyState
              icon={<SearchX />}
              title="No tasks match these filters"
              description="Try removing a filter or searching for something else."
              action={
                <Button onClick={() => (setQInput(''), setParams({ view }, { replace: true }))}>
                  <FilterX /> Clear all filters
                </Button>
              }
            />
          )
        ) : view === 'table' ? (
          <>
            <div className="hidden md:block">
              <TaskTable tasks={pageItems} selectable={bulk} selected={selected} onSelect={setSelected} sort={filters.sort} onSort={(s) => update({ sort: s })} />
            </div>
            <ul className="divide-y divide-line md:hidden">
              {pageItems.map((t) => (
                <TaskListItem key={t.id} task={t} />
              ))}
            </ul>
            <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-xs text-ink-500">
              <span className="tabular-nums">
                {(current - 1) * PAGE_SIZE + 1}–{Math.min(current * PAGE_SIZE, filtered.length)} of {filtered.length} tasks
              </span>
              <div className="flex items-center gap-1">
                <Button size="icon-sm" variant="ghost" disabled={current <= 1} onClick={() => update({ page: String(current - 1) })} aria-label="Previous page">
                  <ChevronLeft />
                </Button>
                <span className="px-1 tabular-nums">
                  Page {current} of {pageCount}
                </span>
                <Button size="icon-sm" variant="ghost" disabled={current >= pageCount} onClick={() => update({ page: String(current + 1) })} aria-label="Next page">
                  <ChevronRight />
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="p-3">
            <KanbanBoard tasks={boardTasks} completedNote="Completed in the last 30 days" />
            <p className="mt-1 text-2xs text-ink-400">Drag cards between columns, or use the ··· menu on a card. Only valid workflow moves are accepted.</p>
          </div>
        )}
      </Card>
    </div>
  );
}
