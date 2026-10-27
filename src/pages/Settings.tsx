import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Building, CalendarClock, Eye, Info, Layers, Pencil, Play, Plus, Repeat, RotateCcw, ShieldCheck, SlidersHorizontal, UserCircle, UsersRound } from 'lucide-react';
import { PermissionSwitches, Switch } from '@/components/team/EmployeeDialog';
import { PERMISSION_META, permissionsOf, ROLE_DEFAULTS } from '@/lib/permissions';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, EmptyState, PageHeader } from '@/components/ui/misc';
import { Field, Input } from '@/components/ui/form';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { useConfirm } from '@/components/ui/confirm';
import { Avatar, CategoryTag } from '@/components/badges';
import { TemplateDialog } from '@/components/settings/TemplateDialog';
import { FREQUENCY_META, PRIORITY_META, ROLE_META } from '@/lib/constants';
import { formatDate, formatDateTime } from '@/lib/dates';
import { useLookup } from '@/lib/lookup';
import { upcomingPeriods } from '@/lib/periods';
import { canManageFirm, canManageTemplates } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { store, useCurrentUser, useDb } from '@/store/store';
import type { TaskTemplate } from '@/types';
import { brand } from '@/config/brand';
import { BACKEND } from '@/api/client';

type Section = 'profile' | 'firm' | 'config' | 'users' | 'templates' | 'categories' | 'roles' | 'demo';

export default function SettingsPage() {
  const me = useCurrentUser();
  const [params, setParams] = useSearchParams();
  const admin = canManageFirm(me);
  const sections: { id: Section; label: string; icon: React.ReactNode; show: boolean }[] = [
    { id: 'profile', label: 'My profile', icon: <UserCircle />, show: true },
    { id: 'firm', label: 'Company profile', icon: <Building />, show: true },
    { id: 'config', label: 'Configuration', icon: <SlidersHorizontal />, show: admin },
    { id: 'users', label: 'Users & roles', icon: <UsersRound />, show: admin },
    { id: 'templates', label: 'Recurring templates', icon: <Repeat />, show: me.role !== 'employee' },
    { id: 'categories', label: 'Task categories', icon: <Layers />, show: true },
    { id: 'roles', label: 'Permission reference', icon: <ShieldCheck />, show: true },
    { id: 'demo', label: 'Demo data', icon: <RotateCcw />, show: !BACKEND },
  ];
  const visible = sections.filter((s) => s.show);
  const requested = params.get('section') as Section;
  const section = visible.some((s) => s.id === requested) ? requested : admin ? 'firm' : 'profile';

  return (
    <div className="animate-slide-up">
      <PageHeader title="Settings" description={admin ? BACKEND ? 'Firm configuration, users and templates.' : 'Firm configuration, templates and demo controls.' : 'Your profile and workspace information.'} />
      <div className="grid gap-5 lg:grid-cols-[200px_1fr]">
        <nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="Settings sections">
          {visible.map((s) => (
            <button
              key={s.id}
              onClick={() => setParams({ section: s.id }, { replace: true })}
              className={cn(
                'flex h-8 shrink-0 items-center gap-2 rounded-md px-2.5 text-[13px] font-medium text-ink-600 hover:bg-white hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 [&_svg]:size-4',
                section === s.id && 'bg-white text-ink-900 shadow-card ring-1 ring-line',
              )}
            >
              <span className="text-ink-400">{s.icon}</span>
              {s.label}
            </button>
          ))}
        </nav>
        <div className="min-w-0">
          {section === 'profile' && <ProfileSection />}
          {section === 'firm' && <FirmSection />}
          {section === 'config' && <ConfigSection />}
          {section === 'users' && <UsersSection />}
          {section === 'templates' && <TemplatesSection />}
          {section === 'categories' && <CategoriesSection />}
          {section === 'roles' && <RolesSection />}
          {section === 'demo' && <DemoSection />}
        </div>
      </div>
    </div>
  );
}

function ProfileSection() {
  const me = useCurrentUser();
  return (
    <Card>
      <CardHeader title="My profile" description="Profile editing would be handled by your identity provider in production." />
      <div className="flex items-center gap-4 p-4">
        <Avatar user={me} size="lg" />
        <div>
          <p className="text-[15px] font-semibold text-ink-900">{me.name}</p>
          <p className="text-[13px] text-ink-500">
            {me.title} · {ROLE_META[me.role].label}
          </p>
          <p className="text-[13px] text-ink-500">{me.email}</p>
        </div>
      </div>
      <dl className="grid gap-4 border-t border-line p-4 text-[13px] sm:grid-cols-3">
        <div>
          <dt className="text-xs text-ink-500">Phone</dt>
          <dd className="text-ink-900">{me.phone || '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-500">Joined</dt>
          <dd className="text-ink-900">{formatDate(me.joinedAt)}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-500">Weekly capacity</dt>
          <dd className="text-ink-900">{me.capacityHours} hours</dd>
        </div>
      </dl>
    </Card>
  );
}

function FirmSection() {
  const db = useDb();
  const me = useCurrentUser();
  const admin = canManageFirm(me);
  const [form, setForm] = useState(db.firm);
  const dirty = JSON.stringify(form) !== JSON.stringify(db.firm);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: k === 'atRiskDays' ? Number(e.target.value) : e.target.value });
  return (
    <Card>
      <CardHeader title="Firm profile" description={admin ? 'Shown across the workspace.' : 'Only firm admins can change these settings.'} />
      <form
        className="grid gap-4 p-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!form.name.trim()) return toast.error('Firm name is required');
          if (!(form.atRiskDays >= 1 && form.atRiskDays <= 14)) return toast.error('At-risk window must be between 1 and 14 days');
          if (store.updateFirm(form)) toast.success('Firm settings saved');
        }}
      >
        <Field label="Display name" htmlFor="f-name" required>
          <Input id="f-name" value={form.name} onChange={set('name')} disabled={!admin} />
        </Field>
        <Field label="Legal name" htmlFor="f-legal">
          <Input id="f-legal" value={form.legalName} onChange={set('legalName')} disabled={!admin} />
        </Field>
        <Field label="Firm registration no." htmlFor="f-frn" hint="Demo value">
          <Input id="f-frn" value={form.registrationNo} onChange={set('registrationNo')} disabled={!admin} />
        </Field>
        <Field label="City" htmlFor="f-city">
          <Input id="f-city" value={form.city} onChange={set('city')} disabled={!admin} />
        </Field>
        <Field label="Email" htmlFor="f-email">
          <Input id="f-email" type="email" value={form.email} onChange={set('email')} disabled={!admin} />
        </Field>
        <Field label="Phone" htmlFor="f-phone">
          <Input id="f-phone" value={form.phone} onChange={set('phone')} disabled={!admin} />
        </Field>
        <Field label="“At risk” window (days)" htmlFor="f-risk" hint="Open tasks due within this many days are flagged as at risk on dashboards.">
          <Input id="f-risk" type="number" min={1} max={14} value={form.atRiskDays} onChange={set('atRiskDays')} disabled={!admin} />
        </Field>
        {admin && (
          <div className="flex items-end justify-end gap-2 sm:col-span-2">
            <Button disabled={!dirty} onClick={() => setForm(db.firm)}>
              Discard
            </Button>
            <Button type="submit" variant="primary" disabled={!dirty}>
              Save changes
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}

function TemplatesSection() {
  const db = useDb();
  const me = useCurrentUser();
  const { users, categories } = useLookup();
  const admin = canManageTemplates(me);
  const [editing, setEditing] = useState<TaskTemplate | null | 'new'>(null);
  const [previewing, setPreviewing] = useState<TaskTemplate | null>(null);
  const { confirm, dialog } = useConfirm();

  return (
    <div className="space-y-3">
      {dialog}
      <div className="flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50/60 px-3 py-2 text-xs text-sky-900">
        <Info className="mt-px size-3.5 shrink-0" />
        <span>
          {BACKEND ? (
            <>
              The server creates each period’s tasks automatically about 20 days before the due date. Use “Generate next period” to create them earlier. Due-date rules are configurable examples, not statutory dates.
            </>
          ) : (
            <>
              Recurring generation is <b>simulated</b>: there is no background scheduler in this demo. Use “Generate next period” to create the next set of tasks on demand. Due-date rules are configurable examples, not statutory dates.
            </>
          )}
        </span>
      </div>
      <Card>
        <CardHeader
          title="Recurring task templates"
          description={`${db.templates.filter((t) => t.active).length} active of ${db.templates.length}`}
          action={
            admin && (
              <Button variant="primary" size="sm" onClick={() => setEditing('new')}>
                <Plus /> New template
              </Button>
            )
          }
        />
        {db.templates.length === 0 ? (
          <EmptyState icon={<Repeat />} title="No templates yet" description="Create templates for recurring compliance work like GST returns and payroll." />
        ) : (
          <ul className="divide-y divide-line">
            {db.templates.map((t) => {
              const next = upcomingPeriods(t, new Date(), 1)[0];
              const generated = db.tasks.filter((x) => x.recurrence?.templateId === t.id).length;
              return (
                <li key={t.id} className={cn('flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center', !t.active && 'opacity-60')}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[13px] font-semibold text-ink-900">{t.name}</p>
                      <CategoryTag category={categories.get(t.categoryId)} />
                      {!t.active && <span className="rounded bg-slate-100 px-1.5 text-2xs font-medium text-ink-500">Inactive</span>}
                    </div>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {FREQUENCY_META[t.frequency]}
                      {t.frequency === 'custom' && ` (every ${t.intervalMonths} months)`} · due day {t.dueDay}, {t.dueMonthOffset} month(s) after period end ·{' '}
                      {t.assignmentRule === 'fixed' ? users.get(t.defaultAssigneeId ?? '')?.name : t.assignmentRule === 'relationship_manager' ? 'Relationship manager' : 'Generator'}
                      {t.reviewerId && <> · reviewed by {users.get(t.reviewerId)?.name}</>} · {PRIORITY_META[t.priority].label}
                    </p>
                    <p className="mt-0.5 truncate text-2xs text-ink-400">
                      {t.entityTypes.join(', ')} · {generated} tasks generated
                      {t.lastGeneratedAt && <> · last run {formatDateTime(t.lastGeneratedAt)}</>}
                    </p>
                  </div>
                  {next && (
                    <div className="shrink-0 text-xs md:text-right">
                      <p className="text-ink-500">Next period</p>
                      <p className="font-medium text-ink-900">
                        {next.label} · {formatDate(next.dueDate, 'd MMM')}
                      </p>
                    </div>
                  )}
                  <div className="flex shrink-0 gap-1.5">
                    <Button size="sm" variant="ghost" onClick={() => setPreviewing(t)}>
                      <Eye /> Preview
                    </Button>
                    {admin && (
                      <>
                        <Button size="sm" onClick={() => setEditing(t)}>
                          <Pencil /> Edit
                        </Button>
                        <Button
                          size="sm"
                          disabled={!t.active}
                          onClick={() =>
                            confirm({
                              title: `Generate tasks for ${next?.label}?`,
                              description: `Creates “${t.name} — ${next?.label}” for each applicable client that doesn’t already have it. ${BACKEND ? 'The scheduler would otherwise do this about 20 days before the due date.' : 'This is a simulated run of the recurring scheduler.'}`,
                              confirmLabel: 'Generate tasks',
                              onConfirm: () => {
                                const r = store.generateFromTemplate(t.id);
                                if (r) toast.success(r.created ? `Created ${r.created} task${r.created > 1 ? 's' : ''} for ${r.period.label}` : `All applicable clients already have ${r.period.label}`);
                              },
                            })
                          }
                        >
                          <Play /> Generate next period
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <TemplateDialog open={editing !== null} template={editing && editing !== 'new' ? editing : undefined} onClose={() => setEditing(null)} />
      <PreviewDialog template={previewing} onClose={() => setPreviewing(null)} />
    </div>
  );
}

function PreviewDialog({ template, onClose }: { template: TaskTemplate | null; onClose: () => void }) {
  const db = useDb();
  const { users } = useLookup();
  if (!template) return null;
  const periods = upcomingPeriods(template, new Date(), 6);
  const clients = db.clients.filter((c) => c.status !== 'inactive' && template.entityTypes.includes(c.entityType));
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title={`Preview · ${template.name}`} description="What the scheduler would create (simulated)." size="lg">
        <DialogBody className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-ink-700">
              <CalendarClock className="size-3.5" /> Next 6 periods
            </p>
            <ul className="divide-y divide-line rounded-md border border-line">
              {periods.map((p) => (
                <li key={p.label} className="flex justify-between px-3 py-2 text-xs">
                  <span className="text-ink-800">{p.label}</span>
                  <span className="tabular-nums text-ink-500">due {formatDate(p.dueDate, 'EEE d MMM yyyy')}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold text-ink-700">Applies to {clients.length} clients</p>
            <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded-md border border-line">
              {clients.map((c) => {
                const assignee = template.assignmentRule === 'relationship_manager' ? users.get(c.relationshipManagerId) : template.assignmentRule === 'fixed' ? users.get(template.defaultAssigneeId ?? '') : undefined;
                return (
                  <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                    <span className="truncate text-ink-800">{c.name}</span>
                    <span className="flex shrink-0 items-center gap-1 text-ink-500">
                      {assignee ? (
                        <>
                          <Avatar user={assignee} size="xs" /> {assignee.name.split(' ')[0]}
                        </>
                      ) : (
                        'Generator'
                      )}
                    </span>
                  </li>
                );
              })}
              {!clients.length && <li className="px-3 py-3 text-xs text-ink-400">No current clients match the selected entity types.</li>}
            </ul>
          </div>
          {template.checklist.length > 0 && (
            <div className="md:col-span-2">
              <p className="mb-1.5 text-xs font-semibold text-ink-700">Checklist</p>
              <ol className="list-decimal space-y-0.5 pl-5 text-xs text-ink-700">
                {template.checklist.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ol>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CategoriesSection() {
  const db = useDb();
  const me = useCurrentUser();
  const admin = canManageFirm(me);
  const [name, setName] = useState('');
  const [filing, setFiling] = useState(false);
  return (
    <Card>
      <CardHeader title="Task categories" description="Filing categories track a separate filing milestone (Preparation → Review → Ready to File → Filed)." />
      <ul className="divide-y divide-line">
        {db.categories.map((c) => (
          <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
            <CategoryTag category={c} />
            <span className="ml-auto text-xs text-ink-500">{c.isFiling ? 'Filing milestones' : 'Internal work'}</span>
            <span className="w-20 text-right text-xs tabular-nums text-ink-400">{db.tasks.filter((t) => t.categoryId === c.id).length} tasks</span>
          </li>
        ))}
      </ul>
      {admin && (
        <form
          className="flex flex-wrap items-center gap-3 border-t border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (store.addCategory(name, filing)) {
              toast.success(`Category “${name.trim()}” added`);
              setName('');
              setFiling(false);
            }
          }}
        >
          <div className="w-56">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New category name" aria-label="New category name" />
          </div>
          <label className="flex items-center gap-2 text-[13px] text-ink-700">
            <Checkbox checked={filing} onCheckedChange={(v) => setFiling(v === true)} /> Has filing milestones
          </label>
          <Button type="submit" variant="primary" disabled={!name.trim()}>
            <Plus /> Add category
          </Button>
        </form>
      )}
    </Card>
  );
}

function RolesSection() {
  const rows: [string, boolean, boolean, boolean][] = [
    ['View all pending tasks (firm-wide)', true, false, false],
    ['View assigned clients & team tasks', true, true, false],
    ['View own tasks and assigned clients', true, true, true],
    ['Create tasks for themselves', true, true, true],
    ['Create tasks for others / bulk reassign', true, true, false],
    ['Update status, checklist, comments, files', true, true, true],
    ['Approve or return submitted work', true, true, false],
    ['Add / alter clients', true, false, false],
    ['Manage masters (groups, services, referrers)', true, false, false],
    ['Billing', true, false, false],
    ['WhatsApp & broadcasts', true, true, false],
    ['Reports', true, true, false],
    ['Add employees & change roles', true, false, false],
    ['Delete records', true, false, false],
  ];
  return (
    <Card>
      <CardHeader title="Permission reference" description="Default access per role. Admins can change any of these per user under Users & roles." />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left">
          <thead>
            <tr className="border-b border-line text-2xs font-medium uppercase tracking-wide text-ink-400">
              <th className="px-4 py-2 font-medium">Capability</th>
              <th className="px-3 py-2 text-center font-medium">Admin</th>
              <th className="px-3 py-2 text-center font-medium">Manager</th>
              <th className="px-3 py-2 text-center font-medium">Employee</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map(([label, ...flags]) => (
              <tr key={label}>
                <td className="px-4 py-2 text-xs text-ink-800">{label}</td>
                {flags.map((f, i) => (
                  <td key={i} className="px-3 py-2 text-center text-xs">
                    {f ? <span className="text-emerald-600">✓</span> : <span className="text-ink-300">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="flex items-start gap-1.5 border-t border-line px-4 py-2.5 text-2xs text-ink-500">
        <Info className="mt-px size-3 shrink-0" />
        This prototype runs entirely in the browser and uses a demo role switcher, not authentication. A production deployment must enforce the same rules on the server.
      </p>
    </Card>
  );
}

function DemoSection() {
  const db = useDb();
  const { confirm, dialog } = useConfirm();
  return (
    <Card>
      {dialog}
      <CardHeader title="Demo data" description={`${brand.name} stores this demo in your browser’s local storage.`} />
      <dl className="grid grid-cols-2 gap-4 p-4 text-[13px] sm:grid-cols-4">
        {[
          ['Clients', db.clients.length],
          ['Tasks', db.tasks.length],
          ['Team members', db.users.length],
          ['Activity events', db.activities.length],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-ink-500">{k}</dt>
            <dd className="text-lg font-semibold tabular-nums text-ink-900">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line p-4">
        <p className="text-xs text-ink-500">Seeded {formatDateTime(db.seededAt)}. Dates are generated relative to today so deadlines always look current.</p>
        <Button
          variant="danger-outline"
          onClick={() =>
            confirm({
              title: 'Reset demo data?',
              description: 'All changes made in this browser will be discarded and the demo firm re-seeded.',
              confirmLabel: 'Reset demo',
              tone: 'danger',
              onConfirm: () => {
                store.resetDemo();
                toast.success('Demo data reset');
              },
            })
          }
        >
          <RotateCcw /> Reset demo data
        </Button>
      </div>
    </Card>
  );
}


function ConfigSection() {
  const db = useDb();
  const [form, setForm] = useState({
    whatsappNumber: db.firm.whatsappNumber ?? '',
    invoicePrefix: db.firm.invoicePrefix ?? '',
    defaultGstRate: db.firm.defaultGstRate ?? 18,
    gstin: db.firm.gstin ?? '',
    address: db.firm.address ?? '',
    atRiskDays: db.firm.atRiskDays,
  });
  const [channels, setChannels] = useState({ inApp: true, email: true, whatsapp: false, dailyDigest: true });
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Configuration" description="Defaults used across billing, reminders and messaging." />
        <form
          className="grid gap-4 p-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (store.updateFirm({ ...form, defaultGstRate: Number(form.defaultGstRate), atRiskDays: Number(form.atRiskDays) })) toast.success('Configuration saved');
          }}
        >
          <Field label="Firm GSTIN" htmlFor="cf-gstin" hint="Printed on invoices">
            <Input id="cf-gstin" className="font-mono uppercase" value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="WhatsApp business number" htmlFor="cf-wa">
            <Input id="cf-wa" value={form.whatsappNumber} onChange={(e) => setForm({ ...form, whatsappNumber: e.target.value })} />
          </Field>
          <Field label="Invoice number prefix" htmlFor="cf-prefix" hint={`e.g. ${form.invoicePrefix || 'INV'}/2026-27/0001`}>
            <Input id="cf-prefix" value={form.invoicePrefix} onChange={(e) => setForm({ ...form, invoicePrefix: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="Default GST rate on fees (%)" htmlFor="cf-gst">
            <Input id="cf-gst" type="number" min={0} max={28} value={form.defaultGstRate} onChange={(e) => setForm({ ...form, defaultGstRate: Number(e.target.value) })} />
          </Field>
          <Field label="Deadline turns yellow (days before due)" htmlFor="cf-risk" hint="Used for “at risk” tasks and the calendar dots.">
            <Input id="cf-risk" type="number" min={1} max={14} value={form.atRiskDays} onChange={(e) => setForm({ ...form, atRiskDays: Number(e.target.value) })} />
          </Field>
          <Field label="Registered address" htmlFor="cf-addr" className="sm:col-span-2">
            <Input id="cf-addr" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </Field>
          <div className="flex justify-end sm:col-span-2">
            <Button type="submit" variant="primary">
              Save configuration
            </Button>
          </div>
        </form>
      </Card>
      <Card>
        <CardHeader title="Notification channels" description="How reminders and alerts reach your team (demo — only in-app works today)." />
        <ul className="divide-y divide-line">
          {(
            [
              ['inApp', 'In-app notifications', 'Bell icon and Notifications page'],
              ['email', 'Email', 'Assignments, review decisions and deadline reminders'],
              ['whatsapp', 'WhatsApp to staff', 'Daily due-today summary on WhatsApp'],
              ['dailyDigest', 'Morning digest', 'One summary of the day’s deadlines at 9:00 AM'],
            ] as [keyof typeof channels, string, string][]
          ).map(([k, label, hint]) => (
            <li key={k} className="flex items-center gap-3 px-4 py-2.5">
              <div className="flex-1">
                <p className="text-[13px] font-medium text-ink-900">
                  {label} {k !== 'inApp' && <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] font-medium text-ink-500">Planned</span>}
                </p>
                <p className="text-2xs text-ink-500">{hint}</p>
              </div>
              <Switch checked={channels[k]} onChange={(v) => (setChannels({ ...channels, [k]: v }), toast.success(`${label} ${v ? 'on' : 'off'}`))} label={label} disabled={k === 'inApp'} />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function UsersSection() {
  const db = useDb();
  const [open, setOpen] = useState<string | null>(null);
  const users = db.users.filter((u) => u.status !== 'deactivated');
  const keys = Object.keys(PERMISSION_META) as (keyof typeof PERMISSION_META)[];
  return (
    <Card>
      <CardHeader title="Users & roles" description="Turn individual permissions on or off. Changes apply immediately — switch to that user in the demo menu to see the effect." />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left">
          <thead>
            <tr className="border-b border-line text-2xs font-medium uppercase tracking-wide text-ink-400">
              <th className="px-4 py-2 font-medium">User</th>
              {keys.map((k) => (
                <th key={k} className="px-2 py-2 text-center font-medium normal-case tracking-normal" title={PERMISSION_META[k].description}>
                  {PERMISSION_META[k].label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {users.map((u) => {
              const eff = permissionsOf(u);
              return (
                <tr key={u.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-2">
                    <button onClick={() => setOpen(open === u.id ? null : u.id)} className="flex items-center gap-2 text-left">
                      <Avatar user={u} size="sm" />
                      <span>
                        <span className="block text-[13px] font-medium text-ink-900">{u.name}</span>
                        <span className="block text-2xs text-ink-500">
                          {ROLE_META[u.role].label}
                          {u.permissions && Object.entries(u.permissions).some(([k, v]) => ROLE_DEFAULTS[u.role][k as keyof typeof PERMISSION_META] !== v) && ' · custom'}
                        </span>
                      </span>
                    </button>
                  </td>
                  {keys.map((k) => (
                    <td key={k} className="px-2 py-2 text-center">
                      <Switch
                        checked={eff[k]}
                        disabled={u.role === 'admin'}
                        label={`${PERMISSION_META[k].label} for ${u.name}`}
                        onChange={(v) => store.updateMember(u.id, { permissions: { ...u.permissions, [k]: v } }) && toast.success(`${PERMISSION_META[k].label} ${v ? 'allowed' : 'removed'} for ${u.name.split(' ')[0]}`)}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {open && (
        <div className="border-t border-line p-4">
          <PermissionSwitches
            role={db.users.find((u) => u.id === open)!.role}
            value={db.users.find((u) => u.id === open)!.permissions ?? {}}
            effective={permissionsOf(db.users.find((u) => u.id === open)!)}
            onChange={(p) => store.updateMember(open, { permissions: p })}
          />
        </div>
      )}
      <p className="flex items-start gap-1.5 border-t border-line px-4 py-2.5 text-2xs text-ink-500">
        <Info className="mt-px size-3 shrink-0" /> Admins always have every permission. In production these switches are enforced by the server.
      </p>
    </Card>
  );
}
