import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CalendarClock,
  CheckCircle2,
  Clock,
  FileQuestion,
  Inbox,
  Mail,
  MapPin,
  Paperclip,
  Pencil,
  Phone,
  Plus,
  Repeat,
  ShieldAlert,
  Ban,
  FileWarning,
  HardDrive,
  KeyRound,
  MessageCircle,
  User as UserIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, EmptyState, Segmented, Tabs } from '@/components/ui/misc';
import { Input } from '@/components/ui/form';
import { ActivityFeed } from '@/components/activity';
import { Avatar, CategoryTag, DueDate, FilingBadge, StatusBadge } from '@/components/badges';
import { ClientStatusBadge } from '@/components/clients/ClientStatusBadge';
import { PortalLoginButton } from '@/components/portals/PortalLoginButton';
import { TaskListItem } from '@/components/tasks/TaskList';
import { TaskTable } from '@/components/tasks/TaskTable';
import { FREQUENCY_META, ROLE_META } from '@/lib/constants';
import { formatDate, todayKey } from '@/lib/dates';
import { useLookup } from '@/lib/lookup';
import { byUrgency, isOpen, isOverdue } from '@/lib/metrics';
import { upcomingPeriods } from '@/lib/periods';
import { canCreateTask, canEditClient, canManageDocuments, canUseWhatsApp, canViewClient, taskableClients, visibleTasks } from '@/lib/permissions';
import { sortTasks } from '@/lib/taskFilters';
import { cn, formatFileSize } from '@/lib/utils';
import { store, useCurrentUser, useDb } from '@/store/store';
import { useUI } from '@/store/ui';
import type { Client } from '@/types';

type Tab = 'overview' | 'tasks' | 'compliance' | 'documents' | 'activity';

export default function ClientDetail() {
  const { clientId } = useParams();
  const db = useDb();
  const me = useCurrentUser();
  const [params, setParams] = useSearchParams();
  const { openTaskForm, openClientForm } = useUI();
  const client = db.clients.find((c) => c.id === clientId);
  const tab = (params.get('tab') as Tab) || 'overview';
  const setTab = (t: Tab) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.set('tab', t);
        return n;
      },
      { replace: true },
    );

  const tasks = useMemo(() => (client ? visibleTasks(db, me).filter((t) => t.clientId === client.id) : []), [db, me, client]);

  if (!client)
    return (
      <EmptyState
        icon={<Building2 />}
        title="Client not found"
        description="It may have been removed, or the link is incorrect."
        action={
          <Button asChild>
            <Link to="/clients">Back to clients</Link>
          </Button>
        }
      />
    );
  if (!canViewClient(db, me, client))
    return (
      <EmptyState
        icon={<ShieldAlert />}
        title="You don’t have access to this client"
        description="You’re not on this client’s engagement team. Ask a firm admin to add you."
        action={
          <Button asChild>
            <Link to="/clients">Back to clients</Link>
          </Button>
        }
      />
    );

  const open = tasks.filter(isOpen);
  const docsPending = db.documents.filter((d) => d.clientId === client.id && d.status === 'pending').length;
  const canTask = canCreateTask(me) && taskableClients(db, me).some((c) => c.id === client.id);

  return (
    <div className="animate-slide-up">
      <Link to="/clients" className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-ink-500 hover:text-ink-900">
        <ArrowLeft className="size-3.5" /> Clients
      </Link>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-line bg-white text-xs font-bold text-ink-700 shadow-card">{client.code.slice(0, 3)}</span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight text-ink-900">{client.name}</h1>
              <ClientStatusBadge status={client.status} />
            </div>
            <p className="mt-0.5 text-[13px] text-ink-500">
              <span className="font-mono">{client.code}</span> · {client.entityType}
              {client.industry && <> · {client.industry}</>}
              {client.city && <> · {client.city}</>}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {canUseWhatsApp(me) && (
            <Button asChild>
              <Link to={`/whatsapp?tab=chats&client=${client.id}`}>
                <MessageCircle /> WhatsApp
              </Link>
            </Button>
          )}
          <Button asChild>
            <Link to={`/drive?client=${client.id}`}>
              <HardDrive /> Drive
            </Link>
          </Button>
          {canEditClient(me, client) && (
            <Button onClick={() => openClientForm(client.id)}>
              <Pencil /> Edit
            </Button>
          )}
          {canTask && (
            <Button variant="primary" onClick={() => openTaskForm({ mode: 'create', defaults: { clientId: client.id } })}>
              <Plus /> New task
            </Button>
          )}
        </div>
      </div>

      {client.exitDate && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          <Ban className="size-4 shrink-0" />
          <span>
            Client left the firm on <b>{formatDate(client.exitDate)}</b>. Updates, WhatsApp messages and notifications to this client are switched off.
          </span>
          {canEditClient(me, client) && (
            <Button size="sm" className="ml-auto" onClick={() => store.setClientExit(client.id, undefined) && toast.success(`${client.name} re-activated`)}>
              Re-activate client
            </Button>
          )}
        </div>
      )}
      <Tabs
        className="mb-4"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'overview', label: 'Overview' },
          { value: 'tasks', label: 'Tasks', count: open.length },
          { value: 'compliance', label: 'Compliance' },
          { value: 'documents', label: 'Documents', count: docsPending || undefined },
          { value: 'activity', label: 'Activity' },
        ]}
      />

      {tab === 'overview' && <OverviewTab client={client} tasks={tasks} />}
      {tab === 'tasks' && <TasksTab tasks={tasks} />}
      {tab === 'compliance' && <ComplianceTab client={client} tasks={tasks} />}
      {tab === 'documents' && <DocumentsTab client={client} tasks={tasks} />}
      {tab === 'activity' && (
        <Card>
          <ActivityFeed items={db.activities.filter((a) => a.clientId === client.id).slice(0, 60)} empty={<EmptyState icon={<Inbox />} title="No activity yet" />} />
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, tone, icon }: { label: string; value: number; tone?: string; icon: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className={cn('flex size-8 items-center justify-center rounded-md bg-slate-100 text-ink-500 [&_svg]:size-4', tone)}>{icon}</span>
      <div>
        <p className="text-lg font-semibold leading-tight tabular-nums text-ink-900">{value}</p>
        <p className="text-2xs text-ink-500">{label}</p>
      </div>
    </div>
  );
}

function PortalLoginsCard({ client }: { client: Client }) {
  const db = useDb();
  const me = useCurrentUser();
  const { openClientForm } = useUI();
  const portals = new Map(db.portals.map((p) => [p.id, p]));
  const logins = client.portalLogins ?? [];
  const canEdit = canEditClient(me, client);
  return (
    <Card>
      <CardHeader
        title="Portal logins"
        icon={<KeyRound />}
        action={
          canEdit && (
            <Button size="sm" variant="ghost" onClick={() => openClientForm(client.id, 'logins')}>
              <Pencil /> Manage
            </Button>
          )
        }
      />
      {logins.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line text-2xs uppercase tracking-wide text-ink-400">
                <th className="px-4 py-1.5 font-medium">Portal</th>
                <th className="px-2 py-1.5 font-medium">Login ID</th>
                <th className="px-4 py-1.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {logins.map((l, i) => {
                const portal = portals.get(l.portalId);
                return (
                  <tr key={l.id ?? i} className="align-top">
                    <td className="px-4 py-2 font-medium text-ink-900">{portal?.name ?? 'Removed portal'}</td>
                    <td className="max-w-[140px] px-2 py-2">
                      <span className="block truncate font-mono text-ink-800" title={l.username}>
                        {l.username}
                      </span>
                      <span className="text-2xs text-ink-400">{l.password || l.hasPassword ? '••••••••' : 'No password saved'}</span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span className="inline-flex items-start justify-end gap-1">
                        {canEdit && (
                          <Button size="sm" variant="ghost" onClick={() => openClientForm(client.id, 'logins')}>
                            Edit
                          </Button>
                        )}
                        {portal && <PortalLoginButton target={{ client, login: l, index: i, portal }} />}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-4 py-3 text-xs text-ink-400">No portal logins saved.</p>
      )}
    </Card>
  );
}

function OverviewTab({ client, tasks }: { client: Client; tasks: ReturnType<typeof useDb>['tasks'] }) {
  const db = useDb();
  const { users } = useLookup();
  const open = tasks.filter(isOpen).sort(byUrgency);
  const overdue = open.filter(isOverdue);
  const upcoming = open.filter((t) => !isOverdue(t)).slice(0, 6);
  const pendingDocs = db.documents.filter((d) => d.clientId === client.id && d.status === 'pending');
  const rm = users.get(client.relationshipManagerId);
  const team = client.teamIds.map((id) => users.get(id)).filter(Boolean);
  const referrer = db.referrers.find((r) => r.id === client.referredById);
  const services = db.services.filter((s) => client.serviceIds?.includes(s.id));
  const notices = db.notices.filter((n) => n.clientId === client.id && n.status !== 'closed');
  const dscs = db.dscs.filter((d) => d.clientId === client.id);

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="space-y-4 xl:col-span-2">
        <Card className="grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-4 sm:divide-y-0">
          <Stat label="Open tasks" value={open.length} icon={<Clock />} tone="bg-brand-50 text-brand-600" />
          <Stat label="Overdue" value={overdue.length} icon={<AlertTriangle />} tone={overdue.length ? 'bg-red-50 text-red-600' : undefined} />
          <Stat label="In review" value={open.filter((t) => t.status === 'in_review').length} icon={<CheckCircle2 />} tone="bg-violet-50 text-violet-600" />
          <Stat label="Documents pending" value={pendingDocs.length} icon={<FileQuestion />} tone={pendingDocs.length ? 'bg-amber-50 text-amber-600' : undefined} />
        </Card>

        {overdue.length > 0 && (
          <Card className="border-red-200">
            <CardHeader title="Overdue items" icon={<AlertTriangle />} description="Past their due date and still open" />
            <ul className="divide-y divide-line">
              {overdue.map((t) => (
                <TaskListItem key={t.id} task={t} showClient={false} />
              ))}
            </ul>
          </Card>
        )}

        <Card>
          <CardHeader title="Upcoming deadlines" icon={<CalendarClock />} description="Next open work for this client" />
          {upcoming.length ? (
            <ul className="divide-y divide-line">
              {upcoming.map((t) => (
                <TaskListItem key={t.id} task={t} showClient={false} />
              ))}
            </ul>
          ) : (
            <EmptyState compact icon={<CheckCircle2 />} title="No open work" description="All tasks for this client are complete." />
          )}
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader title="Client details" />
          <dl className="space-y-2.5 px-4 py-3 text-xs">
            <Detail icon={<UserIcon />} label="Primary contact" value={client.contactName} />
            <Detail icon={<Mail />} label="Email" value={client.email ? <a className="text-brand-700 hover:underline" href={`mailto:${client.email}`}>{client.email}</a> : '—'} />
            <Detail icon={<Phone />} label="Phone" value={client.phone || '—'} />
            <Detail icon={<MapPin />} label="City" value={client.city || '—'} />
            <div className="grid grid-cols-2 gap-2 border-t border-line pt-2.5">
              {(
                [
                  ['Billing name', client.billingName ?? client.name],
                  ['Trade name', client.tradeName ?? '—'],
                  ['File no.', client.fileNo ?? '—'],
                  ['Entity', client.entityType],
                  ['PAN', client.pan ?? '—', true],
                  ['GSTIN', client.gstin ?? '—', true],
                  [client.entityType === 'Individual' ? 'Date of birth' : 'Incorporated', client.incorporatedOn ? formatDate(client.incorporatedOn) : '—'],
                  ['Client since', formatDate(client.since, 'MMM yyyy')],
                  ['Taxes applicable', (client.taxesApplicable ?? []).join(', ') || '—'],
                  ['Referred by', referrer ? referrer.name : '—'],
                ] as [string, string, boolean?][]
              ).map(([k, v, mono]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-2xs text-ink-400">{k}</dt>
                  <dd className={cn('truncate text-ink-800', mono && 'font-mono')} title={v}>
                    {v}
                  </dd>
                </div>
              ))}
            </div>
            {(client.customFields ?? []).length > 0 && (
              <div className="grid grid-cols-2 gap-2 border-t border-line pt-2.5">
                {client.customFields!.map((f) => (
                  <div key={f.label} className="min-w-0">
                    <dt className="text-2xs text-ink-400">{f.label}</dt>
                    <dd className="truncate text-ink-800" title={f.value}>
                      {f.value}
                    </dd>
                  </div>
                ))}
              </div>
            )}
            {client.notes && <p className="rounded-md bg-slate-50 p-2.5 leading-relaxed text-ink-600">{client.notes}</p>}
            <p className="text-2xs text-ink-400">Identifiers shown are fictional demo values.</p>
          </dl>
        </Card>

        <PortalLoginsCard client={client} />

        <Card>
          <CardHeader title="Engagement team" />
          <ul className="divide-y divide-line">
            {rm && (
              <li className="flex items-center gap-2.5 px-4 py-2">
                <Avatar user={rm} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-ink-900">{rm.name}</p>
                  <p className="text-2xs text-ink-500">Relationship manager</p>
                </div>
              </li>
            )}
            {team.map((u) => (
              <li key={u!.id} className="flex items-center gap-2.5 px-4 py-2">
                <Avatar user={u} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-ink-900">{u!.name}</p>
                  <p className="truncate text-2xs text-ink-500">{u!.title}</p>
                </div>
                <span className="text-2xs tabular-nums text-ink-400">{open.filter((t) => t.assigneeId === u!.id).length} open</span>
              </li>
            ))}
            {!team.length && <li className="px-4 py-3 text-xs text-ink-400">No team members assigned.</li>}
          </ul>
        </Card>

        {(client.contacts ?? []).length > 0 && (
          <Card>
            <CardHeader title="Contact persons" />
            <ul className="divide-y divide-line">
              {client.contacts!.map((c) => (
                <li key={c.name} className="px-4 py-2">
                  <p className="text-xs font-medium text-ink-900">
                    {c.name} <span className="font-normal text-ink-500">· {c.designation}</span>
                  </p>
                  <p className="text-2xs text-ink-500">
                    {c.phone} · {c.email}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card>
          <CardHeader title="Services" description={`${services.length} subscribed`} />
          <div className="flex flex-wrap gap-1.5 px-4 py-3">
            {services.length ? (
              services.map((s) => (
                <span key={s.id} className="rounded border border-line bg-white px-1.5 py-0.5 text-2xs font-medium text-ink-700">
                  {s.name}
                </span>
              ))
            ) : (
              <span className="text-xs text-ink-400">No services selected.</span>
            )}
          </div>
        </Card>

        {(notices.length > 0 || dscs.length > 0) && (
          <Card>
            <CardHeader title="Notices & DSC" />
            <ul className="divide-y divide-line">
              {notices.map((n) => (
                <li key={n.id}>
                  <Link to="/notices" className="flex items-center gap-2 px-4 py-2 hover:bg-slate-50">
                    <FileWarning className="size-3.5 shrink-0 text-red-500" />
                    <span className="min-w-0 flex-1 truncate text-xs text-ink-800">
                      {n.source} {n.form} — {n.subject}
                    </span>
                    <span className="shrink-0 text-2xs text-ink-500">by {formatDate(n.dueOn, 'd MMM')}</span>
                  </Link>
                </li>
              ))}
              {dscs.map((d) => (
                <li key={d.id}>
                  <Link to="/dsc" className="flex items-center gap-2 px-4 py-2 hover:bg-slate-50">
                    <KeyRound className="size-3.5 shrink-0 text-ink-400" />
                    <span className="min-w-0 flex-1 truncate text-xs text-ink-800">DSC · {d.holder}</span>
                    <span className={cn('shrink-0 text-2xs', d.expiresOn < todayKey() ? 'text-red-600' : 'text-ink-500')}>valid till {formatDate(d.expiresOn, 'd MMM yy')}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card>
          <CardHeader title="Pending document requests" icon={<FileQuestion />} />
          {pendingDocs.length ? (
            <ul className="divide-y divide-line">
              {pendingDocs.map((d) => (
                <li key={d.id} className="flex items-center gap-2 px-4 py-2">
                  <Clock className="size-3.5 shrink-0 text-amber-500" />
                  <span className="min-w-0 flex-1 truncate text-xs text-ink-800">{d.name}</span>
                  {d.dueDate && <span className={cn('text-2xs', d.dueDate < todayKey() ? 'text-red-600' : 'text-ink-400')}>by {formatDate(d.dueDate, 'd MMM')}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-3 text-xs text-ink-400">Nothing outstanding.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

function Detail({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 text-ink-400 [&_svg]:size-3.5">{icon}</span>
      <dt className="sr-only">{label}</dt>
      <dd className="min-w-0 flex-1 truncate text-ink-800">{value}</dd>
    </div>
  );
}

function TasksTab({ tasks }: { tasks: ReturnType<typeof useDb>['tasks'] }) {
  const [filter, setFilter] = useState<'open' | 'completed' | 'all'>('open');
  const [sort, setSort] = useState<'due' | 'priority' | 'updated'>('due');
  const shown = sortTasks(
    tasks.filter((t) => (filter === 'open' ? isOpen(t) : filter === 'completed' ? !isOpen(t) : true)),
    sort,
  );
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-line p-3">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'open', label: `Open (${tasks.filter(isOpen).length})` },
            { value: 'completed', label: `Completed (${tasks.filter((t) => !isOpen(t)).length})` },
            { value: 'all', label: 'All' },
          ]}
        />
      </div>
      {shown.length ? (
        <TaskTable tasks={shown} selectable={false} selected={new Set()} onSelect={() => {}} sort={sort} onSort={setSort} />
      ) : (
        <EmptyState compact icon={<CheckCircle2 />} title={filter === 'open' ? 'No open tasks' : 'No tasks'} />
      )}
    </Card>
  );
}

function ComplianceTab({ client, tasks }: { client: Client; tasks: ReturnType<typeof useDb>['tasks'] }) {
  const db = useDb();
  const { categories, users } = useLookup();
  const { openTask } = useUI();
  const filing = tasks.filter((t) => categories.get(t.categoryId)?.isFiling).sort((a, b) => b.dueDate.localeCompare(a.dueDate));
  const templates = db.templates.filter((t) => t.active && t.entityTypes.includes(client.entityType));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Filing tracker" description="Internal task status and actual filing status are tracked separately" />
        {filing.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead>
                <tr className="border-b border-line text-2xs font-medium uppercase tracking-wide text-ink-400">
                  <th className="px-4 py-2 font-medium">Filing</th>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 font-medium">Owner</th>
                  <th className="px-3 py-2 font-medium">Task status</th>
                  <th className="px-3 py-2 font-medium">Filing status</th>
                  <th className="px-4 py-2 text-right font-medium">Due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filing.map((t) => (
                  <tr key={t.id} className="cursor-pointer hover:bg-slate-50" onClick={() => openTask(t.id)}>
                    <td className="px-4 py-2">
                      <p className="text-[13px] font-medium text-ink-900">{t.title}</p>
                      <p className="font-mono text-2xs text-ink-400">
                        {t.id}
                        {t.filingReference && <> · Ack {t.filingReference}</>}
                      </p>
                    </td>
                    <td className="px-3 py-2">
                      <CategoryTag category={categories.get(t.categoryId)} />
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-700">{users.get(t.assigneeId)?.name}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={t.status} />
                    </td>
                    <td className="px-3 py-2">{t.filingStage ? <FilingBadge stage={t.filingStage} /> : <span className="text-2xs text-ink-400">—</span>}</td>
                    <td className="px-4 py-2 text-right">
                      <DueDate task={t} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState compact icon={<CheckCircle2 />} title="No filing tasks yet" />
        )}
      </Card>

      <Card>
        <CardHeader title="Applicable recurring schedules" description={`Templates that apply to ${client.entityType} clients`} icon={<Repeat />} />
        {templates.length ? (
          <ul className="divide-y divide-line">
            {templates.map((tpl) => {
              const next = upcomingPeriods(tpl, new Date(), 1)[0];
              return (
                <li key={tpl.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-ink-900">{tpl.name}</p>
                    <p className="text-2xs text-ink-500">
                      {FREQUENCY_META[tpl.frequency]} · due day {tpl.dueDay}, {tpl.dueMonthOffset} month(s) after period end
                    </p>
                  </div>
                  <CategoryTag category={categories.get(tpl.categoryId)} />
                  {next && (
                    <span className="text-xs text-ink-600">
                      Next: <b className="font-medium text-ink-900">{next.label}</b> · {formatDate(next.dueDate, 'd MMM yyyy')}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-4 py-3 text-xs text-ink-400">No active templates apply to this entity type.</p>
        )}
        <p className="border-t border-line px-4 py-2 text-2xs text-ink-400">
          Demo schedules only — configure due-date rules in Settings → Templates and verify them against current statutory notifications. {ROLE_META.admin.short}s can generate tasks from templates.
        </p>
      </Card>
    </div>
  );
}

function DocumentsTab({ client, tasks }: { client: Client; tasks: ReturnType<typeof useDb>['tasks'] }) {
  const db = useDb();
  const me = useCurrentUser();
  const { users, tasks: taskMap } = useLookup();
  const { openTask } = useUI();
  const [name, setName] = useState('');
  const [taskId, setTaskId] = useState('');
  const [due, setDue] = useState('');
  const docs = db.documents.filter((d) => d.clientId === client.id).sort((a, b) => Number(a.status === 'received') - Number(b.status === 'received') || b.requestedAt.localeCompare(a.requestedAt));
  const attachments = tasks.flatMap((t) => t.attachments.map((a) => ({ ...a, task: t }))).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  const canDocs = canManageDocuments(db, me, client);

  return (
    <div className="grid gap-4 xl:grid-cols-5">
      <Card className="xl:col-span-3">
        <CardHeader title="Document requests" description={`${docs.filter((d) => d.status === 'pending').length} pending · ${docs.filter((d) => d.status === 'received').length} received`} />
        {canDocs && (
          <form
            className="grid gap-2 border-b border-line bg-slate-50/50 p-3 sm:grid-cols-[1fr_180px_140px_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              if (store.requestDocument({ clientId: client.id, name, taskId: taskId || undefined, dueDate: due || undefined })) {
                toast.success('Document requested', { description: 'Tracked in-app only — no message is sent to the client in demo mode.' });
                setName('');
                setTaskId('');
                setDue('');
              }
            }}
          >
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Document name, e.g. Bank statements Sep" aria-label="Document name" />
            <select value={taskId} onChange={(e) => setTaskId(e.target.value)} className="h-8 rounded-md border border-line bg-white px-2 text-[13px] shadow-sm" aria-label="Link to task">
              <option value="">Not linked to a task</option>
              {tasks.filter(isOpen).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.id} · {t.title}
                </option>
              ))}
            </select>
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Needed by" />
            <Button type="submit" variant="primary" disabled={!name.trim()}>
              <Plus /> Request
            </Button>
          </form>
        )}
        {docs.length ? (
          <ul className="divide-y divide-line">
            {docs.map((d) => {
              const t = d.taskId ? taskMap.get(d.taskId) : undefined;
              return (
                <li key={d.id} className="flex items-center gap-3 px-4 py-2.5">
                  {d.status === 'received' ? <CheckCircle2 className="size-4 shrink-0 text-emerald-500" /> : <Clock className={cn('size-4 shrink-0', d.dueDate && d.dueDate < todayKey() ? 'text-red-500' : 'text-amber-500')} />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-ink-900">{d.name}</p>
                    <p className="truncate text-2xs text-ink-500">
                      Requested {formatDate(d.requestedAt, 'd MMM')}
                      {d.dueDate && d.status === 'pending' && <span className={cn(d.dueDate < todayKey() && 'text-red-600')}> · needed by {formatDate(d.dueDate, 'd MMM')}</span>}
                      {d.receivedAt && <> · received {formatDate(d.receivedAt, 'd MMM')}</>}
                      {t && (
                        <>
                          {' · '}
                          <button onClick={() => openTask(t.id)} className="text-brand-700 hover:underline">
                            {t.id}
                          </button>
                        </>
                      )}
                    </p>
                  </div>
                  {canDocs && (
                    <Button size="sm" variant={d.status === 'pending' ? 'secondary' : 'ghost'} onClick={() => store.setDocumentStatus(d.id, d.status === 'pending' ? 'received' : 'pending') && toast.success(d.status === 'pending' ? 'Marked as received' : 'Marked as pending')}>
                      {d.status === 'pending' ? 'Mark received' : 'Undo'}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState compact icon={<FileQuestion />} title="No document requests" description="Request documents from the client and track what has been received." />
        )}
      </Card>
      <Card className="xl:col-span-2">
        <CardHeader title="Files on tasks" description="Attachments uploaded to this client’s tasks" />
        {attachments.length ? (
          <ul className="divide-y divide-line">
            {attachments.map((a) => (
              <li key={a.id}>
                <button onClick={() => openTask(a.task.id)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-slate-50">
                  <Paperclip className="size-4 shrink-0 text-ink-400" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-ink-800">{a.name}</p>
                    <p className="truncate text-2xs text-ink-500">
                      {a.task.id} · {users.get(a.uploadedBy)?.name} · {formatDate(a.uploadedAt, 'd MMM')}
                    </p>
                  </div>
                  <span className="text-2xs text-ink-400">{formatFileSize(a.sizeKb)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState compact icon={<Paperclip />} title="No files yet" description="Files uploaded on tasks will be listed here." />
        )}
      </Card>
    </div>
  );
}
