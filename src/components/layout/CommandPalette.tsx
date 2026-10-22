import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Building2, CornerDownLeft, FileText, ListTodo, Plus, Search, User } from 'lucide-react';
import { StatusBadge } from '@/components/badges';
import { Kbd } from '@/components/ui/misc';
import { ROLE_META } from '@/lib/constants';
import { canCreateClient, canCreateTask, canViewTeam, visibleClients, visibleTasks } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { useCurrentUser, useDb } from '@/store/store';
import { useUI } from '@/store/ui';

interface Result {
  id: string;
  group: string;
  icon: ReactNode;
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
  run: () => void;
}

export function CommandPalette() {
  const { searchOpen, setSearchOpen, openTask, openTaskForm, openClientForm } = useUI();
  const db = useDb();
  const me = useCurrentUser();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (searchOpen) {
      setQ('');
      setActive(0);
    }
  }, [searchOpen]);

  const results = useMemo<Result[]>(() => {
    const query = q.trim().toLowerCase();
    const close = () => setSearchOpen(false);
    const out: Result[] = [];
    const tasks = visibleTasks(db, me);
    const clients = visibleClients(db, me);
    const clientName = (id: string) => db.clients.find((c) => c.id === id)?.name ?? '';
    if (!query) {
      if (canCreateTask(me)) out.push({ id: 'new-task', group: 'Actions', icon: <Plus />, title: 'Create new task', run: () => (close(), openTaskForm({ mode: 'create' })) });
      if (canCreateClient(me)) out.push({ id: 'new-client', group: 'Actions', icon: <Plus />, title: 'Add client', run: () => (close(), openClientForm()) });
      out.push({ id: 'my-tasks', group: 'Actions', icon: <ListTodo />, title: 'View my open tasks', run: () => (close(), navigate(`/tasks?assignee=${me.id}&status=open`)) });
      out.push({ id: 'overdue', group: 'Actions', icon: <ListTodo />, title: 'View overdue tasks', run: () => (close(), navigate('/tasks?due=overdue')) });
      tasks
        .filter((t) => t.status !== 'completed')
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 5)
        .forEach((t) =>
          out.push({ id: t.id, group: 'Recently updated', icon: <FileText />, title: t.title, subtitle: `${t.id} · ${clientName(t.clientId)}`, trailing: <StatusBadge status={t.status} />, run: () => (close(), openTask(t.id)) }),
        );
      return out;
    }
    tasks
      .filter((t) => t.id.toLowerCase().includes(query) || t.title.toLowerCase().includes(query) || clientName(t.clientId).toLowerCase().includes(query))
      .sort((a, b) => Number(a.status === 'completed') - Number(b.status === 'completed') || b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 8)
      .forEach((t) =>
        out.push({ id: t.id, group: 'Tasks', icon: <FileText />, title: t.title, subtitle: `${t.id} · ${clientName(t.clientId)}`, trailing: <StatusBadge status={t.status} />, run: () => (close(), openTask(t.id)) }),
      );
    clients
      .filter((c) => c.name.toLowerCase().includes(query) || c.code.toLowerCase().includes(query) || c.contactName.toLowerCase().includes(query))
      .slice(0, 5)
      .forEach((c) => out.push({ id: c.id, group: 'Clients', icon: <Building2 />, title: c.name, subtitle: `${c.code} · ${c.entityType}`, run: () => (close(), navigate(`/clients/${c.id}`)) }));
    if (canViewTeam(me))
      db.users
        .filter((u) => u.name.toLowerCase().includes(query) || u.email.toLowerCase().includes(query))
        .slice(0, 4)
        .forEach((u) => out.push({ id: u.id, group: 'People', icon: <User />, title: u.name, subtitle: `${ROLE_META[u.role].label} · ${u.title}`, run: () => (close(), navigate(`/team/${u.id}`)) }));
    return out;
  }, [q, db, me, navigate, openTask, openTaskForm, openClientForm, setSearchOpen]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  let lastGroup = '';
  return (
    <DialogPrimitive.Root open={searchOpen} onOpenChange={setSearchOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink-900/30 data-[state=open]:animate-fade-in" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-[12vh] z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-line bg-white shadow-pop focus:outline-none data-[state=open]:animate-scale-in"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((i) => Math.min(results.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              results[active]?.run();
            }
          }}
        >
          <DialogPrimitive.Title className="sr-only">Search</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Search tasks, clients and people</DialogPrimitive.Description>
          <div className="flex items-center gap-2.5 border-b border-line px-4">
            <Search className="size-4 text-ink-400" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by task title or ID, client, or person…"
              className="h-12 flex-1 bg-transparent text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none"
              aria-label="Search"
              role="combobox"
              aria-expanded
              aria-controls="search-results"
            />
            <Kbd>Esc</Kbd>
          </div>
          <div ref={listRef} id="search-results" role="listbox" className="max-h-[380px] overflow-y-auto p-1.5">
            {results.length === 0 && <p className="px-3 py-8 text-center text-[13px] text-ink-500">No results for “{q}”.</p>}
            {results.map((r, i) => {
              const header = r.group !== lastGroup ? r.group : null;
              lastGroup = r.group;
              return (
                <div key={r.group + r.id}>
                  {header && <p className="px-2.5 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wider text-ink-400">{header}</p>}
                  <button
                    data-index={i}
                    role="option"
                    aria-selected={i === active}
                    onMouseMove={() => setActive(i)}
                    onClick={r.run}
                    className={cn('flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left', i === active && 'bg-slate-100')}
                  >
                    <span className="text-ink-400 [&_svg]:size-4">{r.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-ink-900">{r.title}</span>
                      {r.subtitle && <span className="block truncate text-xs text-ink-500">{r.subtitle}</span>}
                    </span>
                    {r.trailing}
                    {i === active && <CornerDownLeft className="size-3.5 text-ink-400" />}
                  </button>
                </div>
              );
            })}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
