import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, FileText, IndianRupee, Plus, Receipt, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, PageHeader, Tabs } from '@/components/ui/misc';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form';
import { Checkbox } from '@/components/ui/checkbox';
import { billingSummary, clientLedger, inr, invoicePaid, invoiceStatus, invoiceSubtotal, invoiceTax, invoiceTotal, type InvoiceStatus } from '@/lib/billing';
import { formatDate } from '@/lib/dates';
import { useLookup } from '@/lib/lookup';
import { cn } from '@/lib/utils';
import { store, useDb } from '@/store/store';
import { useUI } from '@/store/ui';
import type { Invoice, Payment, Task } from '@/types';

type Tab = 'wip' | 'unbilled' | 'billed' | 'ledger';

export default function BillingPage() {
  const db = useDb();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'wip';
  const setTab = (t: Tab, extra?: Record<string, string>) => setParams({ tab: t, ...extra }, { replace: true });
  const b = billingSummary(db);
  const [payFor, setPayFor] = useState<{ clientId?: string; invoice?: Invoice; kind: Payment['kind'] } | null>(null);

  return (
    <div className="animate-slide-up">
      <PageHeader
        title="Billing"
        description="Work in progress, unbilled work, invoices and client ledgers. Visible only to users with billing access."
        actions={
          <Button variant="primary" onClick={() => setPayFor({ kind: 'receipt' })}>
            <Plus /> Record receipt
          </Button>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Work in progress" value={inr(b.wipValue)} hint={`${b.wip.length} open tasks`} icon={<Wallet />} tone="text-brand-700" onClick={() => setTab('wip')} />
        <Stat label="Advances received" value={inr(b.advances)} hint="Against WIP" icon={<IndianRupee />} tone="text-sky-700" onClick={() => setTab('wip')} />
        <Stat label="Unbilled work" value={inr(b.unbilledValue)} hint={`${b.unbilled.length} completed tasks`} icon={<FileText />} tone="text-amber-700" onClick={() => setTab('unbilled')} />
        <Stat label="Outstanding" value={inr(b.outstanding)} hint={`${db.invoices.filter((i) => invoiceStatus(db, i) !== 'paid').length} unpaid invoices`} icon={<Receipt />} tone="text-red-600" onClick={() => setTab('billed')} />
        <Stat label="Collected this month" value={inr(b.collectedThisMonth)} hint={`Billed ${inr(b.billedThisMonth)}`} icon={<CheckCircle2 />} tone="text-emerald-700" onClick={() => setTab('ledger')} />
      </div>
      <Tabs
        className="mb-4"
        value={tab}
        onChange={(t) => setTab(t)}
        tabs={[
          { value: 'wip', label: 'Work in progress' },
          { value: 'unbilled', label: 'Unbilled works', count: b.unbilled.length },
          { value: 'billed', label: 'Billed works', count: db.invoices.length },
          { value: 'ledger', label: 'Ledger' },
        ]}
      />
      {tab === 'wip' && <WipTab onAdvance={(clientId) => setPayFor({ clientId, kind: 'advance' })} onLedger={(id) => setTab('ledger', { client: id })} />}
      {tab === 'unbilled' && <UnbilledTab />}
      {tab === 'billed' && <BilledTab onPay={(invoice) => setPayFor({ invoice, clientId: invoice.clientId, kind: 'receipt' })} />}
      {tab === 'ledger' && <LedgerTab clientId={params.get('client') ?? ''} setClient={(id) => setTab('ledger', id ? { client: id } : undefined)} onPay={(clientId) => setPayFor({ clientId, kind: 'receipt' })} />}
      <PaymentDialog state={payFor} onClose={() => setPayFor(null)} />
      <p className="mt-4 text-2xs text-ink-400">Demo figures. Fees are sample values per service; GST on invoices at {db.firm.defaultGstRate ?? 18}%.</p>
    </div>
  );
}

function Stat({ label, value, hint, icon, tone, onClick }: { label: string; value: string; hint: string; icon: React.ReactNode; tone: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-lg border border-line bg-white p-3.5 text-left shadow-card transition-all hover:-translate-y-px hover:border-slate-300 hover:shadow-pop">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-ink-500">{label}</span>
        <span className="text-ink-300 [&_svg]:size-4">{icon}</span>
      </div>
      <p className={cn('mt-1.5 text-xl font-semibold tabular-nums', tone)}>{value}</p>
      <p className="truncate text-2xs text-ink-500">{hint}</p>
    </button>
  );
}

function WipTab({ onAdvance, onLedger }: { onAdvance: (clientId: string) => void; onLedger: (clientId: string) => void }) {
  const db = useDb();
  const rows = db.clients
    .map((c) => {
      const open = db.tasks.filter((t) => t.clientId === c.id && t.status !== 'completed');
      const value = open.reduce((s, t) => s + (t.fee ?? 0), 0);
      const advance = db.payments.filter((p) => p.clientId === c.id && p.kind === 'advance').reduce((s, p) => s + p.amount, 0);
      return { client: c, open, value, advance };
    })
    .filter((r) => r.open.length || r.advance)
    .sort((a, b) => b.value - a.value);
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-left">
        <thead>
          <tr className="border-b border-line text-2xs font-medium uppercase tracking-wide text-ink-400">
            <th className="px-4 py-2 font-medium">Client</th>
            <th className="px-3 py-2 font-medium">Open work</th>
            <th className="px-3 py-2 text-right font-medium">WIP value</th>
            <th className="px-3 py-2 text-right font-medium">Advance received</th>
            <th className="px-3 py-2 text-right font-medium">Net to bill</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.client.id} className="hover:bg-slate-50">
              <td className="px-4 py-2.5">
                <Link to={`/clients/${r.client.id}`} className="text-[13px] font-medium text-ink-900 hover:text-brand-700">
                  {r.client.billingName ?? r.client.name}
                </Link>
                <p className="font-mono text-2xs text-ink-400">{r.client.code}</p>
              </td>
              <td className="px-3 py-2.5 text-xs text-ink-600">
                {r.open.length} tasks · {[...new Set(r.open.map((t) => db.categories.find((c) => c.id === t.categoryId)?.name))].join(', ')}
              </td>
              <td className="px-3 py-2.5 text-right text-[13px] tabular-nums text-ink-900">{inr(r.value)}</td>
              <td className={cn('px-3 py-2.5 text-right text-[13px] tabular-nums', r.advance ? 'text-sky-700' : 'text-ink-400')}>{r.advance ? inr(r.advance) : '—'}</td>
              <td className="px-3 py-2.5 text-right text-[13px] font-semibold tabular-nums text-ink-900">{inr(Math.max(0, r.value - r.advance))}</td>
              <td className="whitespace-nowrap px-4 py-2.5 text-right">
                <Button size="sm" variant="ghost" onClick={() => onLedger(r.client.id)}>
                  Ledger
                </Button>
                <Button size="sm" onClick={() => onAdvance(r.client.id)}>
                  Record advance
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function UnbilledTab() {
  const db = useDb();
  const { openTask } = useUI();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<{ clientId: string; tasks: Task[] } | null>(null);
  const unbilled = billingSummary(db).unbilled;
  const byClient = useMemo(() => {
    const m = new Map<string, Task[]>();
    unbilled.forEach((t) => m.set(t.clientId, [...(m.get(t.clientId) ?? []), t]));
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [unbilled]);
  if (!byClient.length) return <Card><EmptyState icon={<CheckCircle2 />} title="Everything is billed" description="Completed work that hasn’t been invoiced shows up here." /></Card>;
  return (
    <div className="space-y-3">
      {byClient.map(([clientId, tasks]) => {
        const client = db.clients.find((c) => c.id === clientId)!;
        const chosen = tasks.filter((t) => selected.has(t.id));
        const total = tasks.reduce((s, t) => s + (t.fee ?? 0), 0);
        return (
          <Card key={clientId} className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2.5">
              <Checkbox
                checked={chosen.length === tasks.length ? true : chosen.length ? 'indeterminate' : false}
                onCheckedChange={(v) => setSelected((s) => {
                  const n = new Set(s);
                  tasks.forEach((t) => (v ? n.add(t.id) : n.delete(t.id)));
                  return n;
                })}
                aria-label={`Select all for ${client.name}`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-ink-900">{client.billingName ?? client.name}</p>
                <p className="text-2xs text-ink-500">
                  {tasks.length} completed tasks · {inr(total)} before GST
                </p>
              </div>
              <Button size="sm" variant="primary" disabled={!chosen.length} onClick={() => setPreview({ clientId, tasks: chosen })}>
                <FileText /> Create invoice{chosen.length ? ` (${chosen.length})` : ''}
              </Button>
            </div>
            <ul className="divide-y divide-line">
              {tasks.map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-4 py-2">
                  <Checkbox checked={selected.has(t.id)} onCheckedChange={(v) => setSelected((s) => (v ? new Set(s).add(t.id) : (s.delete(t.id), new Set(s))))} aria-label={`Select ${t.id}`} />
                  <button onClick={() => openTask(t.id)} className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-[13px] text-ink-900 hover:text-brand-700">{t.title}</span>
                    <span className="text-2xs text-ink-500">
                      {t.id} · completed {formatDate(t.completedAt, 'd MMM')}
                    </span>
                  </button>
                  <label className="flex items-center gap-1 text-xs text-ink-500">
                    ₹
                    <input
                      type="number"
                      defaultValue={t.fee}
                      onBlur={(e) => Number(e.target.value) !== t.fee && store.setTaskFee(t.id, Number(e.target.value))}
                      className="h-7 w-24 rounded-md border border-line px-2 text-right text-xs tabular-nums focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                      aria-label={`Fee for ${t.id}`}
                    />
                  </label>
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
      <InvoicePreview
        draft={preview}
        onClose={() => setPreview(null)}
        onCreate={(clientId, ids) => {
          const inv = store.createInvoice(clientId, ids);
          if (inv) {
            toast.success(`Invoice ${inv.number} created`, { description: 'Demo — not sent to the client.' });
            setSelected(new Set());
            setPreview(null);
          }
        }}
      />
    </div>
  );
}

function InvoicePreview({ draft, onClose, onCreate }: { draft: { clientId: string; tasks: Task[] } | null; onClose: () => void; onCreate: (clientId: string, ids: string[]) => void }) {
  const db = useDb();
  if (!draft) return null;
  const inv: Invoice = { id: 'draft', number: 'Draft', clientId: draft.clientId, date: new Date().toISOString().slice(0, 10), dueDate: '', gstRate: db.firm.defaultGstRate ?? 18, items: draft.tasks.map((t) => ({ taskId: t.id, description: t.title, amount: t.fee ?? 0 })) };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title="Create invoice" description="Review the invoice before creating it." size="lg">
        <DialogBody>
          <InvoiceDocument invoice={inv} />
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onCreate(draft.clientId, draft.tasks.map((t) => t.id))}>
            Create invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InvoiceDocument({ invoice }: { invoice: Invoice }) {
  const db = useDb();
  const client = db.clients.find((c) => c.id === invoice.clientId)!;
  const paid = invoice.id === 'draft' ? 0 : invoicePaid(db, invoice);
  const half = invoiceTax(invoice) / 2;
  return (
    <div className="rounded-lg border border-line p-5 text-[13px]">
      <div className="flex flex-wrap justify-between gap-4 border-b border-line pb-4">
        <div>
          <p className="text-[15px] font-semibold text-ink-900">{db.firm.legalName}</p>
          <p className="text-xs text-ink-500">{db.firm.address}</p>
          <p className="text-xs text-ink-500">GSTIN {db.firm.gstin} · {db.firm.registrationNo}</p>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Tax invoice</p>
          <p className="font-mono text-[13px] font-semibold text-ink-900">{invoice.number}</p>
          <p className="text-xs text-ink-500">Date {formatDate(invoice.date)}</p>
        </div>
      </div>
      <div className="py-3">
        <p className="text-2xs font-semibold uppercase tracking-wide text-ink-400">Billed to</p>
        <p className="font-medium text-ink-900">{client.billingName ?? client.name}</p>
        <p className="text-xs text-ink-500">
          {client.city} {client.gstin && <>· GSTIN {client.gstin}</>}
        </p>
      </div>
      <table className="w-full text-left">
        <thead>
          <tr className="border-y border-line text-2xs uppercase tracking-wide text-ink-400">
            <th className="py-1.5 font-medium">Particulars (SAC 998221)</th>
            <th className="py-1.5 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {invoice.items.map((i, k) => (
            <tr key={k}>
              <td className="py-1.5 text-ink-800">{i.description}</td>
              <td className="py-1.5 text-right tabular-nums">{inr(i.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="text-xs">
          <tr className="border-t border-line">
            <td className="pt-2 text-right text-ink-500">Subtotal</td>
            <td className="pt-2 text-right tabular-nums">{inr(invoiceSubtotal(invoice))}</td>
          </tr>
          <tr>
            <td className="text-right text-ink-500">CGST {invoice.gstRate / 2}%</td>
            <td className="text-right tabular-nums">{inr(half)}</td>
          </tr>
          <tr>
            <td className="text-right text-ink-500">SGST {invoice.gstRate / 2}%</td>
            <td className="text-right tabular-nums">{inr(half)}</td>
          </tr>
          <tr className="text-[14px] font-semibold text-ink-900">
            <td className="pt-1 text-right">Total</td>
            <td className="pt-1 text-right tabular-nums">{inr(invoiceTotal(invoice))}</td>
          </tr>
          {paid > 0 && (
            <tr className="text-emerald-700">
              <td className="text-right">Received</td>
              <td className="text-right tabular-nums">−{inr(paid)}</td>
            </tr>
          )}
        </tfoot>
      </table>
    </div>
  );
}

const INV_TONE: Record<InvoiceStatus, string> = {
  paid: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  partial: 'bg-amber-50 text-amber-700 ring-amber-200',
  overdue: 'bg-red-50 text-red-700 ring-red-200',
  unpaid: 'bg-slate-100 text-ink-600 ring-slate-200',
};

function BilledTab({ onPay }: { onPay: (inv: Invoice) => void }) {
  const db = useDb();
  const { clients } = useLookup();
  const [filter, setFilter] = useState<'all' | InvoiceStatus>('all');
  const [view, setView] = useState<Invoice | null>(null);
  const list = [...db.invoices].sort((a, b) => b.date.localeCompare(a.date)).filter((i) => filter === 'all' || invoiceStatus(db, i) === filter);
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap gap-1 border-b border-line p-3">
        {(['all', 'unpaid', 'overdue', 'partial', 'paid'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={cn('h-7 rounded-full px-3 text-xs font-medium capitalize', filter === f ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-slate-100')}>
            {f} {f !== 'all' && <span className="opacity-60">{db.invoices.filter((i) => invoiceStatus(db, i) === f).length}</span>}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left">
          <thead>
            <tr className="border-b border-line text-2xs font-medium uppercase tracking-wide text-ink-400">
              <th className="px-4 py-2 font-medium">Invoice</th>
              <th className="px-3 py-2 font-medium">Client</th>
              <th className="px-3 py-2 font-medium">Works</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
              <th className="px-3 py-2 text-right font-medium">Balance</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {list.map((i) => {
              const st = invoiceStatus(db, i);
              const bal = invoiceTotal(i) - invoicePaid(db, i);
              return (
                <tr key={i.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <button onClick={() => setView(i)} className="font-mono text-xs font-semibold text-brand-700 hover:underline">
                      {i.number}
                    </button>
                    <p className="text-2xs text-ink-400">{formatDate(i.date)} · due {formatDate(i.dueDate, 'd MMM')}</p>
                  </td>
                  <td className="px-3 py-2 text-[13px] text-ink-900">{clients.get(i.clientId)?.name}</td>
                  <td className="px-3 py-2 text-xs text-ink-500">{i.items.length} items</td>
                  <td className="px-3 py-2 text-right text-[13px] tabular-nums">{inr(invoiceTotal(i))}</td>
                  <td className={cn('px-3 py-2 text-right text-[13px] tabular-nums', bal > 0 ? 'font-medium text-ink-900' : 'text-ink-400')}>{inr(Math.max(0, bal))}</td>
                  <td className="px-3 py-2">
                    <span className={cn('inline-flex h-5 items-center rounded-full px-2 text-2xs font-medium capitalize ring-1 ring-inset', INV_TONE[st])}>{st}</span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    {st !== 'paid' && (
                      <Button size="sm" onClick={() => onPay(i)}>
                        Record payment
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {view && (
        <Dialog open onOpenChange={(v) => !v && setView(null)}>
          <DialogContent title={`Invoice ${view.number}`} size="lg">
            <DialogBody>
              <InvoiceDocument invoice={view} />
            </DialogBody>
            <DialogFooter>
              <Button onClick={() => toast.info('PDF download and email are not available in the demo.')}>Download PDF</Button>
              <Button variant="primary" onClick={() => setView(null)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}

function LedgerTab({ clientId, setClient, onPay }: { clientId: string; setClient: (id: string) => void; onPay: (clientId: string) => void }) {
  const db = useDb();
  const billable = db.clients.filter((c) => db.invoices.some((i) => i.clientId === c.id) || db.payments.some((p) => p.clientId === c.id));
  const id = clientId || billable[0]?.id || '';
  const rows = id ? clientLedger(db, id) : [];
  const client = db.clients.find((c) => c.id === id);
  const debit = rows.reduce((s, r) => s + r.debit, 0);
  const credit = rows.reduce((s, r) => s + r.credit, 0);
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
        <div className="w-72">
          <Select value={id} onChange={(e) => setClient(e.target.value)} aria-label="Client">
            {billable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.billingName ?? c.name}
              </option>
            ))}
          </Select>
        </div>
        {client && (
          <span className="text-xs text-ink-500">
            {client.code} {client.gstin && <>· GSTIN {client.gstin}</>}
          </span>
        )}
        <Button size="sm" className="ml-auto" onClick={() => onPay(id)}>
          <Plus /> Record receipt
        </Button>
      </div>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left">
            <thead>
              <tr className="border-b border-line text-2xs font-medium uppercase tracking-wide text-ink-400">
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Particulars</th>
                <th className="px-3 py-2 text-right font-medium">Debit</th>
                <th className="px-3 py-2 text-right font-medium">Credit</th>
                <th className="px-4 py-2 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.ref}>
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-ink-600">{formatDate(r.date)}</td>
                  <td className="px-3 py-2 text-[13px] text-ink-900">{r.particulars}</td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums">{r.debit ? inr(r.debit) : ''}</td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums text-emerald-700">{r.credit ? inr(r.credit) : ''}</td>
                  <td className="px-4 py-2 text-right text-xs font-medium tabular-nums">
                    {inr(Math.abs(r.balance))} {r.balance >= 0 ? 'Dr' : 'Cr'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-line bg-slate-50 text-xs font-semibold">
                <td className="px-4 py-2" colSpan={2}>
                  Closing balance
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{inr(debit)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{inr(credit)}</td>
                <td className={cn('px-4 py-2 text-right tabular-nums', debit - credit > 0 ? 'text-red-600' : 'text-emerald-700')}>
                  {inr(Math.abs(debit - credit))} {debit - credit >= 0 ? 'Dr' : 'Cr'}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <EmptyState compact icon={<Receipt />} title="No transactions" />
      )}
    </Card>
  );
}

function PaymentDialog({ state, onClose }: { state: { clientId?: string; invoice?: Invoice; kind: Payment['kind'] } | null; onClose: () => void }) {
  const db = useDb();
  return (
    <Dialog open={!!state} onOpenChange={(v) => !v && onClose()}>
      {state && (
        <DialogContent title={state.kind === 'advance' ? 'Record advance' : 'Record receipt'} description={state.invoice ? `Against ${state.invoice.number}` : undefined} size="sm">
          <PaymentForm key={JSON.stringify(state)} state={state} onClose={onClose} defaultAmount={state.invoice ? invoiceTotal(state.invoice) - invoicePaid(db, state.invoice) : 0} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function PaymentForm({ state, onClose, defaultAmount }: { state: { clientId?: string; invoice?: Invoice; kind: Payment['kind'] }; onClose: () => void; defaultAmount: number }) {
  const db = useDb();
  const [clientId, setClientId] = useState(state.clientId ?? db.clients[0]?.id ?? '');
  const [amount, setAmount] = useState(defaultAmount ? String(defaultAmount) : '');
  const [mode, setMode] = useState<Payment['mode']>('NEFT');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        if (store.recordPayment({ clientId, invoiceId: state.invoice?.id, amount: Number(amount), mode, date, reference: reference || '—', kind: state.kind })) {
          toast.success(`${state.kind === 'advance' ? 'Advance' : 'Receipt'} of ${inr(Number(amount))} recorded`);
          onClose();
        }
      }}
    >
      <DialogBody className="space-y-3">
        <Field label="Client" htmlFor="pm-client">
          <Select id="pm-client" value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={!!state.invoice}>
            {db.clients.filter((c) => !c.exitDate).map((c) => (
              <option key={c.id} value={c.id}>
                {c.billingName ?? c.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (₹)" htmlFor="pm-amt" required>
            <Input id="pm-amt" type="number" min={1} autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Date" htmlFor="pm-date">
            <Input id="pm-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Mode" htmlFor="pm-mode">
            <Select id="pm-mode" value={mode} onChange={(e) => setMode(e.target.value as Payment['mode'])}>
              {(['NEFT', 'UPI', 'Cheque', 'Cash'] as const).map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
          </Field>
          <Field label="Reference / UTR" htmlFor="pm-ref">
            <Input id="pm-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={!(Number(amount) > 0)}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
