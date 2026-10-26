import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, FolderInput, Plus, Search, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, PageHeader, Segmented } from '@/components/ui/misc';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Avatar } from '@/components/badges';
import { daysUntil, formatDate } from '@/lib/dates';
import { useLookup } from '@/lib/lookup';
import { visibleClients } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { store, useCurrentUser, useDb } from '@/store/store';
import type { DocMovement } from '@/types';

export default function DocRegisterPage() {
  const db = useDb();
  const me = useCurrentUser();
  const { clients, users } = useLookup();
  const [filter, setFilter] = useState<'all' | 'held' | 'in' | 'out'>('held');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState<DocMovement['direction'] | null>(null);
  const allowed = new Set(visibleClients(db, me).map((c) => c.id));
  const all = db.docMovements.filter((m) => allowed.has(m.clientId));
  const held = all.filter((m) => m.direction === 'in' && !m.returned);
  const list = (filter === 'held' ? held : filter === 'all' ? all : all.filter((m) => m.direction === filter))
    .filter((m) => !q || m.document.toLowerCase().includes(q.toLowerCase()) || clients.get(m.clientId)?.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="animate-slide-up">
      <PageHeader
        title="Documents In / Out"
        description="Register of physical documents received from and returned to clients."
        actions={
          <>
            <Button onClick={() => setAdding('out')}>
              <ArrowUpRight /> Documents out
            </Button>
            <Button variant="primary" onClick={() => setAdding('in')}>
              <ArrowDownLeft /> Documents in
            </Button>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ['Currently held by firm', held.length, 'text-brand-700'],
          ['Return date passed', held.filter((m) => m.expectedReturn && daysUntil(m.expectedReturn) < 0).length, 'text-red-600'],
          ['Received this month', all.filter((m) => m.direction === 'in' && m.date.slice(0, 7) === new Date().toISOString().slice(0, 7)).length, 'text-ink-900'],
          ['Returned this month', all.filter((m) => m.direction === 'out' && m.date.slice(0, 7) === new Date().toISOString().slice(0, 7)).length, 'text-emerald-700'],
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
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search document or client…" className="pl-8" aria-label="Search register" />
          </div>
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'held', label: `Held now (${held.length})` },
              { value: 'in', label: 'In' },
              { value: 'out', label: 'Out' },
              { value: 'all', label: 'All entries' },
            ]}
          />
        </div>
        {list.length === 0 ? (
          <EmptyState icon={<FolderInput />} title="No entries" description="Record documents when clients hand them over or when you return them." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left">
              <thead>
                <tr className="border-b border-line text-2xs font-medium uppercase tracking-wide text-ink-400">
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium" />
                  <th className="px-3 py-2 font-medium">Document</th>
                  <th className="px-3 py-2 font-medium">Client</th>
                  <th className="px-3 py-2 font-medium">Given by / to</th>
                  <th className="px-3 py-2 font-medium">Handled by</th>
                  <th className="px-3 py-2 font-medium">Return by</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.map((m) => {
                  const late = m.direction === 'in' && !m.returned && m.expectedReturn && daysUntil(m.expectedReturn) < 0;
                  return (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-ink-700">{formatDate(m.date)}</td>
                      <td className="px-3 py-2.5">
                        <span className={cn('inline-flex h-5 items-center gap-1 rounded-full px-2 text-2xs font-semibold', m.direction === 'in' ? 'bg-sky-50 text-sky-700' : 'bg-emerald-50 text-emerald-700')}>
                          {m.direction === 'in' ? <ArrowDownLeft className="size-3" /> : <ArrowUpRight className="size-3" />}
                          {m.direction === 'in' ? 'IN' : 'OUT'}
                        </span>
                      </td>
                      <td className="max-w-[300px] px-3 py-2.5">
                        <p className="text-[13px] text-ink-900">{m.document}</p>
                        <p className="text-2xs text-ink-400">{m.mode}</p>
                      </td>
                      <td className="px-3 py-2.5">
                        <Link to={`/clients/${m.clientId}`} className="text-xs text-ink-800 hover:text-brand-700">
                          {clients.get(m.clientId)?.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-ink-700">{m.person}</td>
                      <td className="px-3 py-2.5">
                        <span className="flex items-center gap-1.5 text-xs text-ink-700">
                          <Avatar user={users.get(m.handledBy)} size="xs" />
                          {users.get(m.handledBy)?.name.split(' ')[0]}
                        </span>
                      </td>
                      <td className={cn('whitespace-nowrap px-3 py-2.5 text-xs', late ? 'font-medium text-red-600' : 'text-ink-600')}>
                        {m.direction === 'in' ? (m.returned ? 'Returned' : m.expectedReturn ? formatDate(m.expectedReturn, 'd MMM') : '—') : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {m.direction === 'in' && !m.returned && (
                          <Button size="sm" onClick={() => store.markDocReturned(m.id) && toast.success('Marked as returned to client')}>
                            <Undo2 /> Return
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
      <MovementDialog direction={adding} onClose={() => setAdding(null)} />
    </div>
  );
}

function MovementDialog({ direction, onClose }: { direction: DocMovement['direction'] | null; onClose: () => void }) {
  const db = useDb();
  const me = useCurrentUser();
  const clients = visibleClients(db, me);
  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const [document, setDocument] = useState('');
  const [person, setPerson] = useState('');
  const [mode, setMode] = useState<DocMovement['mode']>('By hand');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [expectedReturn, setExpectedReturn] = useState('');
  const [remarks, setRemarks] = useState('');
  return (
    <Dialog open={!!direction} onOpenChange={(v) => !v && onClose()}>
      {direction && (
        <DialogContent title={direction === 'in' ? 'Documents received from client' : 'Documents handed to client'} size="md">
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              if (store.addDocMovement({ clientId, document, person, mode, date, direction, expectedReturn: expectedReturn || undefined, remarks: remarks || undefined })) {
                toast.success(direction === 'in' ? 'Receipt recorded' : 'Hand-over recorded');
                setDocument('');
                setPerson('');
                onClose();
              }
            }}
          >
            <DialogBody className="grid gap-3 sm:grid-cols-2">
              <Field label="Client" htmlFor="dm-client" className="sm:col-span-2">
                <Select id="dm-client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Documents" htmlFor="dm-doc" required className="sm:col-span-2">
                <Input id="dm-doc" autoFocus value={document} onChange={(e) => setDocument(e.target.value)} placeholder="e.g. Original sale deed, 2 box files of purchase bills" />
              </Field>
              <Field label={direction === 'in' ? 'Given by' : 'Handed to'} htmlFor="dm-person" required>
                <Input id="dm-person" value={person} onChange={(e) => setPerson(e.target.value)} />
              </Field>
              <Field label="Mode" htmlFor="dm-mode">
                <Select id="dm-mode" value={mode} onChange={(e) => setMode(e.target.value as DocMovement['mode'])}>
                  {(['By hand', 'Courier', 'Post', 'Email'] as const).map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Date" htmlFor="dm-date">
                <Input id="dm-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              {direction === 'in' && (
                <Field label="Return by (optional)" htmlFor="dm-ret">
                  <Input id="dm-ret" type="date" value={expectedReturn} onChange={(e) => setExpectedReturn(e.target.value)} />
                </Field>
              )}
              <Field label="Remarks" htmlFor="dm-rem" className="sm:col-span-2">
                <Textarea id="dm-rem" value={remarks} onChange={(e) => setRemarks(e.target.value)} className="min-h-[56px]" />
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button onClick={onClose}>Cancel</Button>
              <Button type="submit" variant="primary">
                <Plus /> Save entry
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
