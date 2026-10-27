import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CloudDownload, FileWarning, Info, ListPlus, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, PageHeader } from '@/components/ui/misc';
import { Field, Input, Select } from '@/components/ui/form';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Avatar } from '@/components/badges';
import { FilterMenu } from '@/components/tasks/FilterMenu';
import { daysUntil, formatDate, formatDateTime, todayKey } from '@/lib/dates';
import { inr } from '@/lib/billing';
import { useLookup } from '@/lib/lookup';
import { visibleClients } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { store, useCaps, useCurrentUser, useDb } from '@/store/store';
import { useUI } from '@/store/ui';
import type { NoticeSource, NoticeStatus } from '@/types';

const STATUS: Record<NoticeStatus, { label: string; tone: string }> = {
  new: { label: 'New', tone: 'bg-red-50 text-red-700 ring-red-200' },
  in_progress: { label: 'Reply in progress', tone: 'bg-blue-50 text-blue-700 ring-blue-200' },
  replied: { label: 'Replied', tone: 'bg-violet-50 text-violet-700 ring-violet-200' },
  closed: { label: 'Closed', tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
};
const SOURCE_TONE: Record<NoticeSource, string> = { GST: 'bg-sky-50 text-sky-700', 'Income Tax': 'bg-orange-50 text-orange-700', TDS: 'bg-emerald-50 text-emerald-700', Other: 'bg-slate-100 text-ink-600' };
const SOURCES: NoticeSource[] = ['GST', 'Income Tax', 'TDS', 'Other'];

export default function NoticesPage() {
  const db = useDb();
  const me = useCurrentUser();
  const { users, clients } = useLookup();
  const { openTask } = useUI();
  const [source, setSource] = useState<'all' | NoticeSource>('all');
  const [status, setStatus] = useState<string[]>(['new', 'in_progress']);
  const [fetching, setFetching] = useState(false);
  const [adding, setAdding] = useState(false);
  const caps = useCaps();
  const canFetch = caps.noticeFetch === 'demo';
  const allowed = new Set(visibleClients(db, me).map((c) => c.id));
  const all = db.notices.filter((n) => allowed.has(n.clientId));
  const list = all.filter((n) => (source === 'all' || n.source === source) && (!status.length || status.includes(n.status))).sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  const lastFetch = all.map((n) => n.fetchedAt).sort().pop();

  const fetchNow = () => {
    setFetching(true);
    setTimeout(() => {
      const n = store.fetchNotices();
      setFetching(false);
      if (n !== undefined) toast.success(n ? `${n} new notice${n > 1 ? 's' : ''} found` : 'No new notices', { description: 'Simulated sync — no portal was contacted.' });
    }, 1400);
  };

  return (
    <div className="animate-slide-up">
      <PageHeader
        title="Notices"
        description={`GST, Income Tax and TDS notices for your clients${lastFetch ? ` · last synced ${formatDateTime(lastFetch)}` : ''}`}
        actions={
          <>
            <Button variant={canFetch ? 'secondary' : 'primary'} onClick={() => setAdding(true)}>
              <Plus /> Add notice
            </Button>
            {canFetch && (
              <Button variant="primary" onClick={fetchNow} disabled={fetching}>
                {fetching ? <Loader2 className="animate-spin" /> : <CloudDownload />} {fetching ? 'Checking portals…' : 'Fetch now'}
              </Button>
            )}
          </>
        }
      />
      <AddNoticeDialog open={adding} onClose={() => setAdding(false)} />
      <div className="mb-3 flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50/60 px-3 py-2 text-xs text-sky-900">
        <Info className="mt-px size-3.5 shrink-0" />
        <span>
          {canFetch
            ? 'Demo: notices and “Fetch now” are simulated. Pulling notices automatically needs a licensed GST provider (GSP) and client consent; the Income Tax portal has no public API.'
            : 'Record notices as they arrive using “Add notice”. Automatic fetching needs a licensed GST provider (GSP) and client consent; the Income Tax portal has no public API.'}
        </span>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {SOURCES.map((s) => {
          const open = all.filter((n) => n.source === s && n.status !== 'closed');
          return (
            <button
              key={s}
              onClick={() => setSource(source === s ? 'all' : s)}
              className={cn('rounded-lg border bg-white p-3.5 text-left shadow-card transition-colors hover:border-slate-300', source === s ? 'border-brand-300 ring-1 ring-brand-200' : 'border-line')}
            >
              <span className={cn('rounded px-1.5 py-0.5 text-2xs font-semibold', SOURCE_TONE[s])}>{s}</span>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-ink-900">{open.length}</p>
              <p className="text-2xs text-ink-500">
                open · {open.filter((n) => n.status === 'new').length} new · {open.filter((n) => daysUntil(n.dueOn) < 0).length} past reply date
              </p>
            </button>
          );
        })}
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <FilterMenu
            label="Status"
            selected={status}
            onChange={setStatus}
            options={(Object.keys(STATUS) as NoticeStatus[]).map((s) => ({ value: s, label: STATUS[s].label, count: all.filter((n) => n.status === s).length }))}
          />
          {source !== 'all' && (
            <Button size="sm" variant="ghost" onClick={() => setSource('all')}>
              Show all sources
            </Button>
          )}
          <span className="ml-auto text-xs text-ink-500">{list.length} notices</span>
        </div>
        {list.length === 0 ? (
          <EmptyState icon={<FileWarning />} title="No notices match" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] text-left">
              <thead>
                <tr className="border-b border-line text-2xs font-medium uppercase tracking-wide text-ink-400">
                  <th className="px-4 py-2 font-medium">Client</th>
                  <th className="px-3 py-2 font-medium">Notice</th>
                  <th className="px-3 py-2 font-medium">Issued</th>
                  <th className="px-3 py-2 font-medium">Reply by</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Assigned</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.map((n) => {
                  const d = daysUntil(n.dueOn);
                  const c = clients.get(n.clientId);
                  return (
                    <tr key={n.id} className="align-top hover:bg-slate-50">
                      <td className="px-4 py-2.5">
                        <Link to={`/clients/${n.clientId}`} className="text-[13px] font-medium text-ink-900 hover:text-brand-700">
                          {c?.name}
                        </Link>
                        <p className="font-mono text-2xs text-ink-400">{c?.gstin ?? c?.pan}</p>
                      </td>
                      <td className="max-w-[340px] px-3 py-2.5">
                        <p className="flex items-center gap-1.5">
                          <span className={cn('rounded px-1.5 py-0.5 text-2xs font-semibold', SOURCE_TONE[n.source])}>{n.source}</span>
                          <span className="text-[13px] font-semibold text-ink-900">{n.form}</span>
                        </p>
                        <p className="mt-0.5 text-xs text-ink-600">{n.subject}</p>
                        <p className="font-mono text-2xs text-ink-400">Ref {n.reference}</p>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-xs text-ink-700">{formatDate(n.issuedOn, 'd MMM yyyy')}</td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <p className={cn('text-xs font-medium', n.status === 'closed' ? 'text-ink-500' : d < 0 ? 'text-red-600' : d <= 7 ? 'text-amber-700' : 'text-ink-800')}>{formatDate(n.dueOn, 'd MMM yyyy')}</p>
                        {n.status !== 'closed' && <p className="text-2xs text-ink-400">{d < 0 ? `${-d}d overdue` : `${d}d left`}</p>}
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs tabular-nums text-ink-800">{n.amount ? inr(n.amount) : '—'}</td>
                      <td className="px-3 py-2.5">
                        <select
                          value={n.status}
                          onChange={(e) => store.updateNotice(n.id, { status: e.target.value as NoticeStatus }) && toast.success('Status updated')}
                          className={cn('h-6 cursor-pointer rounded-full px-2 text-2xs font-medium ring-1 ring-inset focus:outline-none', STATUS[n.status].tone)}
                          aria-label="Notice status"
                        >
                          {(Object.keys(STATUS) as NoticeStatus[]).map((s) => (
                            <option key={s} value={s}>
                              {STATUS[s].label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <Avatar user={users.get(n.assigneeId ?? '')} size="xs" />
                          <div className="w-32">
                            <Select value={n.assigneeId ?? ''} onChange={(e) => store.updateNotice(n.id, { assigneeId: e.target.value || undefined })} aria-label="Assign notice" className="h-7 text-xs">
                              <option value="">Unassigned</option>
                              {db.users
                                .filter((u) => u.status === 'active')
                                .map((u) => (
                                  <option key={u.id} value={u.id}>
                                    {u.name}
                                  </option>
                                ))}
                            </Select>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {n.taskId ? (
                          <Button size="sm" variant="ghost" onClick={() => openTask(n.taskId!)}>
                            Open task
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => {
                              const t = store.noticeToTask(n.id);
                              if (t) {
                                toast.success(`${t.id} created for the reply`);
                                openTask(t.id);
                              }
                            }}
                          >
                            <ListPlus /> Create task
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
    </div>
  );
}

function AddNoticeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const db = useDb();
  const me = useCurrentUser();
  const clients = visibleClients(db, me).filter((c) => !c.exitDate);
  const blank = { clientId: '', source: 'GST' as NoticeSource, form: '', subject: '', reference: '', issuedOn: todayKey(), dueOn: '', amount: '', assigneeId: me.id };
  const [v, setV] = useState(blank);
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  const close = () => (setV(blank), onClose());
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = store.addNotice({
      clientId: v.clientId,
      source: v.source,
      form: v.form,
      subject: v.subject,
      reference: v.reference,
      issuedOn: v.issuedOn,
      dueOn: v.dueOn,
      amount: v.amount ? Number(v.amount) : undefined,
      assigneeId: v.assigneeId || undefined,
    });
    if (n) {
      toast.success('Notice added');
      close();
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent title="Add notice" description="Record a notice received from a tax portal." size="md">
        <form onSubmit={submit} noValidate>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Client" htmlFor="nt-client" required className="sm:col-span-2">
              <Select id="nt-client" value={v.clientId} onChange={set('clientId')}>
                <option value="">Select client…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Source" htmlFor="nt-source">
              <Select id="nt-source" value={v.source} onChange={set('source')}>
                {SOURCES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </Field>
            <Field label="Form / section" htmlFor="nt-form" required>
              <Input id="nt-form" value={v.form} onChange={set('form')} placeholder="e.g. ASMT-10, 143(1)" />
            </Field>
            <Field label="Subject" htmlFor="nt-subject" required className="sm:col-span-2">
              <Input id="nt-subject" value={v.subject} onChange={set('subject')} placeholder="e.g. Mismatch between GSTR-1 and GSTR-3B" />
            </Field>
            <Field label="Reference / DIN" htmlFor="nt-ref">
              <Input id="nt-ref" value={v.reference} onChange={set('reference')} />
            </Field>
            <Field label="Amount (₹)" htmlFor="nt-amt">
              <Input id="nt-amt" type="number" min={0} value={v.amount} onChange={set('amount')} />
            </Field>
            <Field label="Issued on" htmlFor="nt-issued">
              <Input id="nt-issued" type="date" value={v.issuedOn} onChange={set('issuedOn')} />
            </Field>
            <Field label="Reply due" htmlFor="nt-due" required>
              <Input id="nt-due" type="date" value={v.dueOn} onChange={set('dueOn')} />
            </Field>
            <Field label="Assign to" htmlFor="nt-assignee" className="sm:col-span-2">
              <Select id="nt-assignee" value={v.assigneeId} onChange={set('assigneeId')}>
                <option value="">Unassigned</option>
                {db.users
                  .filter((u) => u.status === 'active')
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
              </Select>
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!v.clientId || !v.form.trim() || !v.subject.trim() || !v.dueOn}>
              Add notice
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
