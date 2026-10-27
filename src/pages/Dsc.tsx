import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftRight, KeyRound, Pencil, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, PageHeader, Segmented } from '@/components/ui/misc';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form';
import { daysUntil, formatDate } from '@/lib/dates';
import { useLookup } from '@/lib/lookup';
import { visibleClients } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { store, useCurrentUser, useDb } from '@/store/store';
import type { Dsc } from '@/types';

type Health = 'valid' | 'expiring' | 'expired';
const health = (d: Dsc): Health => (daysUntil(d.expiresOn) < 0 ? 'expired' : daysUntil(d.expiresOn) <= 30 ? 'expiring' : 'valid');
const HEALTH: Record<Health, { label: string; tone: string }> = {
  valid: { label: 'Valid', tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  expiring: { label: 'Expiring soon', tone: 'bg-amber-50 text-amber-700 ring-amber-200' },
  expired: { label: 'Expired', tone: 'bg-red-50 text-red-700 ring-red-200' },
};

export default function DscPage() {
  const db = useDb();
  const me = useCurrentUser();
  const { clients } = useLookup();
  const [filter, setFilter] = useState<'all' | Health | 'firm'>('all');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Dsc | 'new' | null>(null);
  const allowed = new Set(visibleClients(db, me).map((c) => c.id));
  const all = db.dscs.filter((d) => allowed.has(d.clientId));
  const list = all
    .filter((d) => (filter === 'all' ? true : filter === 'firm' ? d.custody === 'firm' : health(d) === filter))
    .filter((d) => !q || d.holder.toLowerCase().includes(q.toLowerCase()) || clients.get(d.clientId)?.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
  const count = (h: Health) => all.filter((d) => health(d) === h).length;

  return (
    <div className="animate-slide-up">
      <PageHeader
        title="DSC Status"
        description="Digital signature certificates: who holds them, where the token is, and when they expire."
        actions={
          <Button variant="primary" onClick={() => setEditing('new')}>
            <Plus /> Add DSC
          </Button>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ['Total DSCs', all.length, 'text-ink-900'],
          ['Expiring in 30 days', count('expiring'), 'text-amber-700'],
          ['Expired', count('expired'), 'text-red-600'],
          ['Tokens with the firm', all.filter((d) => d.custody === 'firm').length, 'text-brand-700'],
        ].map(([l, v, t]) => (
          <Card key={l as string} className="p-3.5">
            <p className="text-xs font-medium text-ink-500">{l}</p>
            <p className={cn('mt-1 text-2xl font-semibold tabular-nums', t as string)}>{v}</p>
          </Card>
        ))}
      </div>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search holder or client…" className="pl-8" aria-label="Search DSC" />
          </div>
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'expiring', label: 'Expiring' },
              { value: 'expired', label: 'Expired' },
              { value: 'firm', label: 'With firm' },
            ]}
          />
        </div>
        {list.length === 0 ? (
          <EmptyState icon={<KeyRound />} title="No DSCs match" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left">
              <thead>
                <tr className="border-b border-line text-2xs font-medium uppercase tracking-wide text-ink-400">
                  <th className="px-4 py-2 font-medium">Holder</th>
                  <th className="px-3 py-2 font-medium">Client</th>
                  <th className="px-3 py-2 font-medium">Type / provider</th>
                  <th className="px-3 py-2 font-medium">Valid till</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Token custody</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.map((d) => {
                  const h = health(d);
                  const left = daysUntil(d.expiresOn);
                  return (
                    <tr key={d.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5">
                        <p className="text-[13px] font-medium text-ink-900">{d.holder}</p>
                        <p className="font-mono text-2xs text-ink-400">{d.tokenSerial}</p>
                      </td>
                      <td className="px-3 py-2.5">
                        <Link to={`/clients/${d.clientId}`} className="text-xs text-ink-800 hover:text-brand-700">
                          {clients.get(d.clientId)?.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-ink-700">
                        Class 3 · {d.type}
                        <p className="text-2xs text-ink-400">{d.provider}</p>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <p className="text-xs text-ink-800">{formatDate(d.expiresOn)}</p>
                        <p className={cn('text-2xs', h === 'expired' ? 'text-red-600' : h === 'expiring' ? 'text-amber-700' : 'text-ink-400')}>
                          {left < 0 ? `Expired ${-left} days ago` : `${left} days left`}
                        </p>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={cn('inline-flex h-5 items-center rounded-full px-2 text-2xs font-medium ring-1 ring-inset', HEALTH[h].tone)}>{HEALTH[h].label}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <p className={cn('text-xs font-medium', d.custody === 'firm' ? 'text-brand-700' : 'text-ink-700')}>{d.custody === 'firm' ? 'With firm' : 'With client'}</p>
                        <p className="text-2xs text-ink-400">since {formatDate(d.lastMovedAt, 'd MMM')}</p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(d)} aria-label={`Edit ${d.holder}`}>
                          <Pencil />
                        </Button>
                        <Button size="sm" onClick={() => store.moveDsc(d.id) && toast.success(d.custody === 'firm' ? `Token returned to ${d.holder}` : `Token received from ${d.holder}`)}>
                          <ArrowLeftRight /> {d.custody === 'firm' ? 'Return to client' : 'Receive token'}
                        </Button>
                        {h !== 'valid' && (
                          <Button size="sm" variant="ghost" onClick={() => toast.success(`Renewal reminder logged for ${d.holder}`, { description: 'Demo — no message sent.' })}>
                            Remind renewal
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <DscDialog key={editing === null ? 'none' : editing === 'new' ? 'new' : editing.id} value={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function DscDialog({ value, onClose }: { value: Dsc | 'new' | null; onClose: () => void }) {
  const db = useDb();
  const me = useCurrentUser();
  const existing = value && value !== 'new' ? value : undefined;
  const [form, setForm] = useState<Omit<Dsc, 'id' | 'lastMovedAt'>>(() => ({
    clientId: existing?.clientId ?? db.clients[0]?.id ?? '',
    holder: existing?.holder ?? '',
    type: existing?.type ?? 'Signing',
    provider: existing?.provider ?? 'eMudhra',
    tokenSerial: existing?.tokenSerial ?? '',
    issuedOn: existing?.issuedOn ?? new Date().toISOString().slice(0, 10),
    expiresOn: existing?.expiresOn ?? new Date(Date.now() + 2 * 365 * 86400000).toISOString().slice(0, 10),
    custody: existing?.custody ?? 'firm',
  }));
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm({ ...form, [k]: v });
  return (
    <Dialog open={!!value} onOpenChange={(v) => !v && onClose()}>
      {value && (
        <DialogContent title={existing ? 'Edit DSC' : 'Add DSC'} size="md">
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              if (store.saveDsc(form, existing?.id)) {
                toast.success(existing ? 'DSC updated' : 'DSC added');
                onClose();
              }
            }}
          >
            <DialogBody className="grid gap-3 sm:grid-cols-2">
              <Field label="Client" htmlFor="dsc-client" className="sm:col-span-2">
                <Select id="dsc-client" value={form.clientId} onChange={(e) => set('clientId', e.target.value)}>
                  {visibleClients(db, me).filter((c) => !c.exitDate).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Holder name" htmlFor="dsc-holder" required>
                <Input id="dsc-holder" autoFocus value={form.holder} onChange={(e) => set('holder', e.target.value)} />
              </Field>
              <Field label="Token serial" htmlFor="dsc-serial">
                <Input id="dsc-serial" value={form.tokenSerial} onChange={(e) => set('tokenSerial', e.target.value)} />
              </Field>
              <Field label="Type" htmlFor="dsc-type">
                <Select id="dsc-type" value={form.type} onChange={(e) => set('type', e.target.value as Dsc['type'])}>
                  <option>Signing</option>
                  <option>Signing & Encryption</option>
                </Select>
              </Field>
              <Field label="Provider" htmlFor="dsc-prov">
                <Input id="dsc-prov" value={form.provider} onChange={(e) => set('provider', e.target.value)} />
              </Field>
              <Field label="Issued on" htmlFor="dsc-iss">
                <Input id="dsc-iss" type="date" value={form.issuedOn} onChange={(e) => set('issuedOn', e.target.value)} />
              </Field>
              <Field label="Valid till" htmlFor="dsc-exp">
                <Input id="dsc-exp" type="date" value={form.expiresOn} onChange={(e) => set('expiresOn', e.target.value)} />
              </Field>
              <Field label="Token is with" htmlFor="dsc-cust">
                <Select id="dsc-cust" value={form.custody} onChange={(e) => set('custody', e.target.value as Dsc['custody'])}>
                  <option value="firm">Firm</option>
                  <option value="client">Client</option>
                </Select>
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
