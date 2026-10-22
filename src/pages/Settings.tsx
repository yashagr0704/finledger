import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Building, CalendarClock, Eye, Info, Layers, Pencil, Play, Plus, Repeat, RotateCcw, ShieldCheck, UserCircle } from 'lucide-react';
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

type Section = 'profile' | 'firm' | 'templates' | 'categories' | 'roles' | 'demo';

export default function SettingsPage() {
  const me = useCurrentUser();
  const [params, setParams] = useSearchParams();
  const admin = canManageFirm(me);
  const sections: { id: Section; label: string; icon: React.ReactNode; show: boolean }[] = [
    { id: 'profile', label: 'My profile', icon: <UserCircle />, show: true },
    { id: 'firm', label: 'Firm', icon: <Building />, show: true },
    { id: 'templates', label: 'Recurring templates', icon: <Repeat />, show: me.role !== 'employee' },
    { id: 'categories', label: 'Task categories', icon: <Layers />, show: true },
    { id: 'roles', label: 'Roles & permissions', icon: <ShieldCheck />, show: true },
    { id: 'demo', label: 'Demo data', icon: <RotateCcw />, show: true },
  ];
  const visible = sections.filter((s) => s.show);
  const requested = params.get('section') as Section;
  const section = visible.some((s) => s.id === requested) ? requested : admin ? 'firm' : 'profile';

  return (
    <div className="animate-slide-up">
      <PageHeader title="Settings" description={admin ? 'Firm configuration, templates and demo controls.' : 'Your profile and workspace information.'} />
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
          Recurring generation is <b>simulated</b>: there is no background scheduler in this demo. Use “Generate next period” to create the next set of tasks on demand. Due-date rules are configurable examples, not statutory dates.
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
                              description: `Creates “${t.name} — ${next?.label}” for each applicable client that doesn’t already have it. This is a simulated run of the recurring scheduler.`,
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
    ['View firm-wide dashboard & all tasks', true, false, false],
    ['View assigned clients & team tasks', true, true, false],
    ['View own tasks and assigned clients', true, true, true],
    ['Create & edit tasks', true, true, false],
    ['Assign / bulk reassign work', true, true, false],
    ['Update status, checklist, comments, files', true, true, true],
    ['Approve or return submitted work', true, true, false],
    ['Add clients', true, false, false],
    ['Edit clients (as relationship manager)', true, true, false],
    ['Invite members & change roles', true, false, false],
    ['Recurring templates & firm settings', true, false, false],
    ['Reports & team workload', true, true, false],
    ['Delete tasks', true, false, false],
  ];
  return (
    <Card>
      <CardHeader title="Roles & permissions" description="Enforced inside every application action, not only by hiding navigation." />
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

