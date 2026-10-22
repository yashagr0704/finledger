import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowDown, Building2, FilterX, Plus, Search, SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, PageHeader } from '@/components/ui/misc';
import { Avatar, AvatarStack } from '@/components/badges';
import { FilterMenu } from '@/components/tasks/FilterMenu';
import { formatShortDate, relativeDay } from '@/lib/dates';
import { useLookup } from '@/lib/lookup';
import { isOpen, isOverdue } from '@/lib/metrics';
import { canCreateClient, visibleClients, visibleTasks } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { useCurrentUser, useDb } from '@/store/store';
import { useUI } from '@/store/ui';
import { ENTITY_TYPES, type Client, type User } from '@/types';
import { ClientStatusBadge } from '@/components/clients/ClientStatusBadge';

type SortKey = 'name' | 'open' | 'overdue' | 'next';

export default function Clients() {
  const db = useDb();
  const me = useCurrentUser();
  const { users } = useLookup();
  const { openClientForm } = useUI();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [types, setTypes] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [rms, setRms] = useState<string[]>([]);
  const [sort, setSort] = useState<SortKey>('name');

  const tasks = useMemo(() => visibleTasks(db, me), [db, me]);
  const rows = useMemo(() => {
    return visibleClients(db, me).map((c) => {
      const ct = tasks.filter((t) => t.clientId === c.id && isOpen(t));
      const next = ct.filter((t) => !isOverdue(t)).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
      return {
        client: c,
        open: ct.length,
        overdue: ct.filter(isOverdue).length,
        next,
        docs: db.documents.filter((d) => d.clientId === c.id && d.status === 'pending').length,
      };
    });
  }, [db, me, tasks]);

  const filtered = rows
    .filter(({ client: c }) => {
      const s = q.toLowerCase();
      if (s && ![c.name, c.code, c.contactName, c.city, c.email].some((v) => v.toLowerCase().includes(s))) return false;
      if (types.length && !types.includes(c.entityType)) return false;
      if (statuses.length && !statuses.includes(c.status)) return false;
      if (rms.length && !rms.includes(c.relationshipManagerId)) return false;
      return true;
    })
    .sort((a, b) => {
      if (sort === 'open') return b.open - a.open;
      if (sort === 'overdue') return b.overdue - a.overdue || b.open - a.open;
      if (sort === 'next') return (a.next?.dueDate ?? '9999').localeCompare(b.next?.dueDate ?? '9999');
      return a.client.name.localeCompare(b.client.name);
    });

  const managers = db.users.filter((u) => rows.some((r) => r.client.relationshipManagerId === u.id));
  const clearAll = () => (setQ(''), setTypes([]), setStatuses([]), setRms([]));
  const totals = { overdue: rows.reduce((s, r) => s + r.overdue, 0), docs: rows.reduce((s, r) => s + r.docs, 0) };

  const Th = ({ k, children, className }: { k?: SortKey; children: string; className?: string }) => (
    <th className={cn('px-3 py-2 font-medium', className)}>
      {k ? (
        <button onClick={() => setSort(k)} className={cn('inline-flex items-center gap-1 uppercase tracking-wide hover:text-ink-700', sort === k && 'text-ink-700')}>
          {children}
          {sort === k && <ArrowDown className="size-3" />}
        </button>
      ) : (
        children
      )}
    </th>
  );

  return (
    <div className="animate-slide-up">
      <PageHeader
        title="Clients"
        description={`${rows.length} clients · ${totals.overdue} overdue tasks · ${totals.docs} documents awaited`}
        actions={
          canCreateClient(me) && (
            <Button variant="primary" onClick={() => openClientForm()}>
              <Plus /> Add client
            </Button>
          )
        }
      />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, code, contact, city…"
              className="h-8 w-full rounded-md border border-line bg-white pl-8 pr-2 text-[13px] shadow-sm placeholder:text-ink-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              aria-label="Search clients"
            />
          </div>
          <FilterMenu label="Entity type" selected={types} onChange={setTypes} options={ENTITY_TYPES.map((e) => ({ value: e, label: e, count: rows.filter((r) => r.client.entityType === e).length }))} />
          <FilterMenu
            label="Status"
            selected={statuses}
            onChange={setStatuses}
            options={(['active', 'onboarding', 'inactive'] as const).map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1), count: rows.filter((r) => r.client.status === s).length }))}
          />
          <FilterMenu label="Relationship manager" selected={rms} onChange={setRms} options={managers.map((u) => ({ value: u.id, label: u.name, icon: <Avatar user={u} size="xs" /> }))} />
          {Boolean(q || types.length || statuses.length || rms.length) && (
            <Button variant="ghost" onClick={clearAll}>
              <FilterX /> Clear
            </Button>
          )}
        </div>

        {rows.length === 0 ? (
          <EmptyState icon={<Building2 />} title="No clients yet" description="Add your first client to start assigning work." action={canCreateClient(me) && <Button variant="primary" onClick={() => openClientForm()}><Plus /> Add client</Button>} />
        ) : filtered.length === 0 ? (
          <EmptyState icon={<SearchX />} title="No clients match" description="Try a different search or clear the filters." action={<Button onClick={clearAll}>Clear filters</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-left">
              <thead>
                <tr className="border-b border-line text-2xs font-medium uppercase tracking-wide text-ink-400">
                  <Th k="name" className="pl-4">Client</Th>
                  <Th>Entity</Th>
                  <Th>Primary contact</Th>
                  <Th>Relationship manager</Th>
                  <Th>Team</Th>
                  <Th>Status</Th>
                  <Th k="open" className="text-right">Open</Th>
                  <Th k="overdue" className="text-right">Overdue</Th>
                  <Th k="next" className="pr-4">Next deadline</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map(({ client: c, open, overdue, next, docs }) => (
                  <ClientRow key={c.id} c={c} open={open} overdue={overdue} next={next} docs={docs} onOpen={() => navigate(`/clients/${c.id}`)} rm={users.get(c.relationshipManagerId)} team={c.teamIds.map((id) => users.get(id)!).filter(Boolean)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {filtered.length > 0 && <div className="border-t border-line px-4 py-2.5 text-xs text-ink-500">{filtered.length} of {rows.length} clients</div>}
      </Card>
    </div>
  );
}

function ClientRow({
  c,
  open,
  overdue,
  next,
  docs,
  onOpen,
  rm,
  team,
}: {
  c: Client;
  open: number;
  overdue: number;
  next?: { dueDate: string; title: string };
  docs: number;
  onOpen: () => void;
  rm?: User;
  team: User[];
}) {
  return (
    <tr onClick={onOpen} className="cursor-pointer hover:bg-slate-50">
      <td className="py-2.5 pl-4 pr-3">
        <div className="flex items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-line bg-slate-50 text-2xs font-semibold text-ink-600">{c.code.slice(0, 3)}</span>
          <div className="min-w-0">
            <Link to={`/clients/${c.id}`} onClick={(e) => e.stopPropagation()} className="block truncate text-[13px] font-medium text-ink-900 hover:text-brand-700">
              {c.name}
            </Link>
            <span className="font-mono text-2xs text-ink-400">{c.code}</span>
            {docs > 0 && <span className="ml-2 text-2xs text-amber-700">· {docs} doc{docs > 1 ? 's' : ''} pending</span>}
          </div>
        </div>
      </td>
      <td className="px-3 py-2.5 text-xs text-ink-700">{c.entityType}</td>
      <td className="px-3 py-2.5">
        <p className="truncate text-xs text-ink-800">{c.contactName}</p>
        <p className="truncate text-2xs text-ink-500">{c.email || c.phone}</p>
      </td>
      <td className="px-3 py-2.5">
        <span className="flex items-center gap-1.5 text-xs text-ink-700">
          <Avatar user={rm} size="xs" />
          {rm?.name}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <AvatarStack users={team} max={3} />
      </td>
      <td className="px-3 py-2.5">
        <ClientStatusBadge status={c.status} />
      </td>
      <td className="px-3 py-2.5 text-right text-[13px] tabular-nums text-ink-800">{open}</td>
      <td className={cn('px-3 py-2.5 text-right text-[13px] tabular-nums', overdue ? 'font-semibold text-red-600' : 'text-ink-400')}>{overdue}</td>
      <td className="py-2.5 pl-3 pr-4">
        {next ? (
          <>
            <p className="text-xs font-medium text-ink-800">
              {relativeDay(next.dueDate)} <span className="font-normal text-ink-400">· {formatShortDate(next.dueDate)}</span>
            </p>
            <p className="max-w-[200px] truncate text-2xs text-ink-500">{next.title}</p>
          </>
        ) : (
          <span className="text-xs text-ink-400">—</span>
        )}
      </td>
    </tr>
  );
}
