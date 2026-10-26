import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Handshake, Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, EmptyState, PageHeader, Tabs } from '@/components/ui/misc';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Checkbox } from '@/components/ui/checkbox';
import { useConfirm } from '@/components/ui/confirm';
import { CategoryTag } from '@/components/badges';
import { inr } from '@/lib/billing';
import { canManageFirm, canManageMasters } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { store, useCurrentUser, useDb } from '@/store/store';
import type { Referrer, Service } from '@/types';

export default function MastersPage() {
  const { tab = 'services' } = useParams();
  const navigate = useNavigate();
  const me = useCurrentUser();
  return (
    <div className="animate-slide-up">
      <PageHeader title="Masters" description={canManageMasters(me) ? 'Reference data used across clients, tasks and billing.' : 'Reference data. Ask an admin for “Manage masters” access to make changes.'} />
      <Tabs
        className="mb-4"
        value={tab}
        onChange={(t) => navigate(`/masters/${t}`)}
        tabs={[
          { value: 'services', label: 'Groups & Services' },
          { value: 'referrers', label: 'Referred By' },
        ]}
      />
      {tab === 'referrers' ? <Referrers /> : <Services />}
    </div>
  );
}

function Services() {
  const db = useDb();
  const me = useCurrentUser();
  const { confirm, dialog } = useConfirm();
  const [group, setGroup] = useState(db.categories[0]?.id ?? '');
  const [editing, setEditing] = useState<Service | 'new' | null>(null);
  const [newGroup, setNewGroup] = useState('');
  const [isFiling, setIsFiling] = useState(true);
  const canEdit = canManageMasters(me);
  const services = db.services.filter((s) => s.groupId === group);
  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      {dialog}
      <Card className="h-fit overflow-hidden">
        <CardHeader title="Groups" description="Major work types" icon={<Layers />} />
        <ul className="py-1">
          {db.categories.map((c) => (
            <li key={c.id}>
              <button onClick={() => setGroup(c.id)} className={cn('flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-slate-50', group === c.id && 'bg-brand-50')}>
                <CategoryTag category={c} />
                <span className="ml-auto text-2xs text-ink-400">{db.services.filter((s) => s.groupId === c.id).length} services</span>
              </button>
            </li>
          ))}
        </ul>
        {canManageFirm(me) && (
          <form
            className="space-y-2 border-t border-line p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (store.addCategory(newGroup, isFiling)) {
                toast.success(`Group “${newGroup}” added`);
                setNewGroup('');
              }
            }}
          >
            <Input value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder="New group, e.g. FEMA" aria-label="New group" />
            <label className="flex items-center gap-2 text-xs text-ink-600">
              <Checkbox checked={isFiling} onCheckedChange={(v) => setIsFiling(v === true)} /> Has filing milestones
            </label>
            <Button type="submit" size="sm" className="w-full" disabled={!newGroup.trim()}>
              <Plus /> Add group
            </Button>
          </form>
        )}
      </Card>
      <Card className="overflow-hidden">
        <CardHeader
          title={`${db.categories.find((c) => c.id === group)?.name ?? ''} services`}
          description="Sub-groups of work with their usual frequency and fee"
          action={
            canEdit && (
              <Button size="sm" variant="primary" onClick={() => setEditing('new')}>
                <Plus /> Add service
              </Button>
            )
          }
        />
        {services.length === 0 ? (
          <EmptyState compact icon={<Layers />} title="No services in this group yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left">
              <thead>
                <tr className="border-b border-line text-2xs font-medium uppercase tracking-wide text-ink-400">
                  <th className="px-4 py-2 font-medium">Service</th>
                  <th className="px-3 py-2 font-medium">Frequency</th>
                  <th className="px-3 py-2 text-right font-medium">Default fee</th>
                  <th className="px-3 py-2 text-right font-medium">Clients</th>
                  <th className="px-3 py-2 text-right font-medium">Open tasks</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {services.map((s) => (
                  <tr key={s.id} className="group hover:bg-slate-50">
                    <td className="px-4 py-2 text-[13px] font-medium text-ink-900">{s.name}</td>
                    <td className="px-3 py-2 text-xs text-ink-600">{s.frequency}</td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums text-ink-800">{inr(s.defaultFee)}</td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums text-ink-600">{db.clients.filter((c) => c.serviceIds?.includes(s.id)).length}</td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums text-ink-600">
                      <Link to={`/tasks?status=open&q=${encodeURIComponent(s.name.split(' ')[0])}`} className="hover:text-brand-700">
                        {db.tasks.filter((t) => t.serviceId === s.id && t.status !== 'completed').length}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right">
                      {canEdit && (
                        <>
                          <Button size="icon-sm" variant="ghost" onClick={() => setEditing(s)} aria-label={`Edit ${s.name}`}>
                            <Pencil />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Delete ${s.name}`}
                            onClick={() =>
                              confirm({ title: `Delete ${s.name}?`, description: 'Existing tasks keep their data. The service won’t be offered for new work.', confirmLabel: 'Delete', tone: 'danger', onConfirm: () => store.deleteService(s.id) && toast.success('Service deleted') })
                            }
                          >
                            <Trash2 />
                          </Button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <ServiceDialog key={editing === null ? 'none' : editing === 'new' ? 'new' : editing.id} value={editing} groupId={group} onClose={() => setEditing(null)} />
    </div>
  );
}

function ServiceDialog({ value, groupId, onClose }: { value: Service | 'new' | null; groupId: string; onClose: () => void }) {
  const db = useDb();
  const existing = value && value !== 'new' ? value : undefined;
  const [form, setForm] = useState<Omit<Service, 'id'>>({ groupId: existing?.groupId ?? groupId, name: existing?.name ?? '', frequency: existing?.frequency ?? 'Monthly', defaultFee: existing?.defaultFee ?? 1000 });
  return (
    <Dialog open={!!value} onOpenChange={(v) => !v && onClose()}>
      {value && (
        <DialogContent title={existing ? 'Edit service' : 'Add service'} size="sm">
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              if (store.saveService(form, existing?.id)) {
                toast.success(existing ? 'Service updated' : 'Service added');
                onClose();
              }
            }}
          >
            <DialogBody className="space-y-3">
              <Field label="Group" htmlFor="sv-group">
                <Select id="sv-group" value={form.groupId} onChange={(e) => setForm({ ...form, groupId: e.target.value })}>
                  {db.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Service name" htmlFor="sv-name" required>
                <Input id="sv-name" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. GSTR-1" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Frequency" htmlFor="sv-freq">
                  <Select id="sv-freq" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
                    {['Monthly', 'Quarterly', 'Half-yearly', 'Annual', 'One-time', 'As required'].map((f) => (
                      <option key={f}>{f}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Default fee (₹)" htmlFor="sv-fee">
                  <Input id="sv-fee" type="number" min={0} value={form.defaultFee} onChange={(e) => setForm({ ...form, defaultFee: Number(e.target.value) })} />
                </Field>
              </div>
            </DialogBody>
            <DialogFooter>
              <Button onClick={onClose}>Cancel</Button>
              <Button type="submit" variant="primary">
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}

function Referrers() {
  const db = useDb();
  const me = useCurrentUser();
  const { confirm, dialog } = useConfirm();
  const [editing, setEditing] = useState<Referrer | 'new' | null>(null);
  const canEdit = canManageMasters(me);
  return (
    <Card className="overflow-hidden">
      {dialog}
      <CardHeader
        title="Referred by"
        description="People and firms who refer clients to you"
        icon={<Handshake />}
        action={
          canEdit && (
            <Button size="sm" variant="primary" onClick={() => setEditing('new')}>
              <Plus /> Add referrer
            </Button>
          )
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-left">
          <thead>
            <tr className="border-b border-line text-2xs font-medium uppercase tracking-wide text-ink-400">
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Firm</th>
              <th className="px-3 py-2 font-medium">Mobile</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Address</th>
              <th className="px-3 py-2 font-medium">Clients referred</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {db.referrers.map((r) => {
              const referred = db.clients.filter((c) => c.referredById === r.id);
              return (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 text-[13px] font-medium text-ink-900">{r.name}</td>
                  <td className="px-3 py-2 text-xs text-ink-700">{r.firmName}</td>
                  <td className="px-3 py-2 text-xs text-ink-700">{r.mobile}</td>
                  <td className="px-3 py-2 text-xs text-ink-700">{r.email}</td>
                  <td className="px-3 py-2 text-xs text-ink-500">{r.address}</td>
                  <td className="px-3 py-2 text-xs text-ink-700">
                    <span className="font-semibold tabular-nums">{referred.length}</span>
                    {referred.length > 0 && <span className="ml-1 text-ink-400">· {referred.slice(0, 2).map((c) => c.name.split(' ')[0]).join(', ')}{referred.length > 2 ? '…' : ''}</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right">
                    {canEdit && (
                      <>
                        <Button size="icon-sm" variant="ghost" onClick={() => setEditing(r)} aria-label={`Edit ${r.name}`}>
                          <Pencil />
                        </Button>
                        <Button size="icon-sm" variant="ghost" aria-label={`Delete ${r.name}`} onClick={() => confirm({ title: `Delete ${r.name}?`, description: 'Clients referred by them will show no referrer.', confirmLabel: 'Delete', tone: 'danger', onConfirm: () => store.deleteReferrer(r.id) && toast.success('Referrer deleted') })}>
                          <Trash2 />
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ReferrerDialog key={editing === null ? 'none' : editing === 'new' ? 'new' : editing.id} value={editing} onClose={() => setEditing(null)} />
    </Card>
  );
}

function ReferrerDialog({ value, onClose }: { value: Referrer | 'new' | null; onClose: () => void }) {
  const existing = value && value !== 'new' ? value : undefined;
  const [form, setForm] = useState<Omit<Referrer, 'id'>>({ name: existing?.name ?? '', firmName: existing?.firmName ?? '', mobile: existing?.mobile ?? '', email: existing?.email ?? '', address: existing?.address ?? '' });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });
  return (
    <Dialog open={!!value} onOpenChange={(v) => !v && onClose()}>
      {value && (
        <DialogContent title={existing ? 'Edit referrer' : 'Add referrer'} size="sm">
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              if (store.saveReferrer(form, existing?.id)) {
                toast.success(existing ? 'Referrer updated' : 'Referrer added');
                onClose();
              }
            }}
          >
            <DialogBody className="space-y-3">
              <Field label="Name" htmlFor="rf-name" required>
                <Input id="rf-name" autoFocus value={form.name} onChange={set('name')} />
              </Field>
              <Field label="Firm name" htmlFor="rf-firm">
                <Input id="rf-firm" value={form.firmName} onChange={set('firmName')} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Mobile" htmlFor="rf-mob">
                  <Input id="rf-mob" type="tel" value={form.mobile} onChange={set('mobile')} />
                </Field>
                <Field label="Email" htmlFor="rf-mail">
                  <Input id="rf-mail" type="email" value={form.email} onChange={set('email')} />
                </Field>
              </div>
              <Field label="Address" htmlFor="rf-addr">
                <Textarea id="rf-addr" value={form.address} onChange={set('address')} className="min-h-[56px]" />
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button onClick={onClose}>Cancel</Button>
              <Button type="submit" variant="primary">
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
