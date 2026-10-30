import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { isToday, parseISO } from 'date-fns';
import { AlertCircle, ArrowLeft, Ban, Check, CheckCheck, Info, Megaphone, MessageCircle, PartyPopper, RefreshCw, Search, Send, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, EmptyState, PageHeader, Tabs } from '@/components/ui/misc';
import { Input, Select, Textarea } from '@/components/ui/form';
import { Checkbox } from '@/components/ui/checkbox';
import { useConfirm } from '@/components/ui/confirm';
import { FESTIVALS, festivalSuggestions } from '@/data/seedExtras';
import { formatDate, formatDateTime, todayKey } from '@/lib/dates';
import { useLookup } from '@/lib/lookup';
import { visibleClients } from '@/lib/permissions';
import { cn, initials } from '@/lib/utils';
import { store, useCaps, useCurrentUser, useDb } from '@/store/store';
import type { Broadcast, Client } from '@/types';

const simNote = () => (store.getState().caps?.whatsapp === 'meta' ? undefined : 'Simulated — not actually sent.');

type Tab = 'chats' | 'broadcast' | 'wishes' | 'history';

const QUICK_REPLIES = [
  'Please share your sales and purchase data for last month so we can file your GST returns on time.',
  'Your return has been filed successfully. Acknowledgement attached for your records.',
  'Gentle reminder: our invoice is due. Please ignore if already paid. Thank you!',
  'Could you please send the pending documents at the earliest?',
];

export default function WhatsAppPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'chats';
  const db = useDb();
  const caps = useCaps();
  const live = caps.whatsapp === 'meta';
  const number = live ? caps.whatsappNumber : db.firm.whatsappNumber;
  return (
    <div className="animate-slide-up">
      <PageHeader title="WhatsApp" description={`Business number ${number ?? '—'} · chats, broadcasts and festival wishes`} />
      <div className="mb-3 flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-xs text-emerald-900">
        <Info className="mt-px size-3.5 shrink-0" />
        <span>
          {live
            ? 'Messages are sent through the WhatsApp Business Platform. Outside the 24-hour reply window only Meta-approved templates are delivered. Clients who have left the firm are excluded automatically.'
            : 'Messages are simulated and not sent. Connect the WhatsApp Business Platform on the server to send for real (client opt-in and Meta-approved templates required). Clients who have left the firm are excluded automatically.'}
        </span>
      </div>
      <Tabs
        className="mb-4"
        value={tab}
        onChange={(t) => setParams({ tab: t }, { replace: true })}
        tabs={[
          { value: 'chats', label: 'Chats' },
          { value: 'broadcast', label: 'Broadcast' },
          { value: 'wishes', label: 'Festival wishes' },
          { value: 'history', label: 'Sent broadcasts', count: db.broadcasts.length },
        ]}
      />
      {tab === 'chats' && <Chats initialClient={params.get('client') ?? undefined} />}
      {tab === 'broadcast' && <BroadcastComposer />}
      {tab === 'wishes' && <FestivalWishes />}
      {tab === 'history' && <History />}
    </div>
  );
}

function ClientAvatar({ client, size = 'md' }: { client: Client; size?: 'sm' | 'md' }) {
  const hue = (client.code.charCodeAt(0) * 37 + client.code.charCodeAt(1) * 11) % 360;
  return (
    <span className={cn('flex shrink-0 items-center justify-center rounded-full font-semibold', size === 'md' ? 'size-9 text-xs' : 'size-7 text-[10px]')} style={{ background: `hsl(${hue} 60% 92%)`, color: `hsl(${hue} 45% 30%)` }}>
      {initials(client.name)}
    </span>
  );
}

function Chats({ initialClient }: { initialClient?: string }) {
  const db = useDb();
  const me = useCurrentUser();
  const { users } = useLookup();
  const [q, setQ] = useState('');
  const clients = visibleClients(db, me);
  const threads = useMemo(
    () =>
      clients
        .map((c) => {
          const msgs = db.chats.filter((m) => m.clientId === c.id);
          return { client: c, last: msgs[msgs.length - 1], unread: msgs.length && msgs[msgs.length - 1].direction === 'in' && msgs[msgs.length - 1].at > new Date(Date.now() - 86400000).toISOString() };
        })
        .sort((a, b) => (b.last?.at ?? '').localeCompare(a.last?.at ?? '')),
    [clients, db.chats],
  );
  const [active, setActive] = useState(initialClient ?? threads.find((t) => t.last)?.client.id);
  const [draft, setDraft] = useState('');
  // On phones only one pane is shown at a time.
  const [mobilePane, setMobilePane] = useState<'list' | 'thread'>(initialClient ? 'thread' : 'list');
  const endRef = useRef<HTMLDivElement>(null);
  const client = db.clients.find((c) => c.id === active);
  const messages = db.chats.filter((m) => m.clientId === active);
  // Braces matter: newer browsers return a Promise from scrollIntoView, which React would treat as a cleanup.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, active]);
  const send = () => {
    if (active && store.sendChat(active, draft)) setDraft('');
  };

  return (
    <Card className="grid h-[620px] overflow-hidden md:grid-cols-[300px_1fr]">
      <div className={cn('min-h-0 min-w-0 flex-col border-r border-line md:flex', mobilePane === 'list' ? 'flex' : 'hidden')}>
        <div className="border-b border-line p-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients" className="pl-8" aria-label="Search chats" />
          </div>
        </div>
        <ul className="flex-1 overflow-y-auto">
          {!q && !threads.some((t) => t.last) && <li className="px-4 py-6 text-center text-xs text-ink-500">No conversations yet. Search for a client to start one — incoming messages appear here automatically.</li>}
          {threads
            // Conversations only; searching finds any client so a new chat can be started.
            .filter((t) => (q ? t.client.name.toLowerCase().includes(q.toLowerCase()) : t.last || t.client.id === active))
            .map(({ client: c, last, unread }) => (
              <li key={c.id}>
                <button onClick={() => (setActive(c.id), setMobilePane('thread'))} className={cn('flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-slate-50', active === c.id && 'bg-emerald-50/70 hover:bg-emerald-50')}>
                  <ClientAvatar client={c} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className={cn('truncate text-[13px] text-ink-900', unread && 'font-semibold')}>{c.name}</span>
                      {last && <span className="ml-auto shrink-0 text-[10px] text-ink-400">{isToday(parseISO(last.at)) ? formatDate(last.at, 'h:mm a') : formatDate(last.at, 'd MMM')}</span>}
                    </span>
                    <span className="flex items-center gap-1 text-2xs text-ink-500">
                      {c.exitDate ? (
                        <span className="text-red-600">Left the firm · messaging off</span>
                      ) : (
                        <span className="truncate">{last ? `${last.direction === 'out' ? 'You: ' : ''}${last.body}` : 'No messages yet'}</span>
                      )}
                      {unread ? <span className="ml-auto size-2 shrink-0 rounded-full bg-emerald-500" /> : null}
                    </span>
                  </span>
                </button>
              </li>
            ))}
        </ul>
      </div>
      {client ? (
        <div className={cn('min-h-0 min-w-0 flex-col md:flex', mobilePane === 'thread' ? 'flex' : 'hidden')}>
          <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
            <button onClick={() => setMobilePane('list')} className="-ml-1 rounded p-1 text-ink-500 hover:bg-slate-100 md:hidden" aria-label="Back to chats">
              <ArrowLeft className="size-4" />
            </button>
            <ClientAvatar client={client} />
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-ink-900">{client.name}</p>
              <p className="text-2xs text-ink-500">
                {client.contactName} · {client.phone}
              </p>
            </div>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto bg-[#efeae2] px-4 py-4">
            {messages.length === 0 && <p className="mx-auto w-fit rounded-md bg-white/80 px-3 py-1 text-xs text-ink-500">No messages yet. Say hello 👋</p>}
            {messages.map((m) => (
              <div key={m.id} className={cn('flex', m.direction === 'out' ? 'justify-end' : 'justify-start')}>
                <div className={cn('max-w-[75%] rounded-lg px-3 py-1.5 text-[13px] shadow-sm', m.direction === 'out' ? 'rounded-tr-none bg-[#d9fdd3]' : 'rounded-tl-none bg-white')}>
                  {m.direction === 'out' && m.authorId && <p className="text-[10px] font-semibold text-emerald-700">{users.get(m.authorId)?.name}</p>}
                  <p className="whitespace-pre-wrap text-ink-900">{m.body}</p>
                  <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-ink-500">
                    {formatDate(m.at, isToday(parseISO(m.at)) ? 'h:mm a' : 'd MMM, h:mm a')}
                    {m.direction === 'out' &&
                      (m.status === 'failed' ? (
                        <AlertCircle className="size-3 text-red-600" aria-label="Not delivered" />
                      ) : m.status === 'sent' ? (
                        <Check className="size-3" />
                      ) : (
                        <CheckCheck className={cn('size-3', m.status === 'read' && 'text-sky-500')} />
                      ))}
                  </p>
                  {m.direction === 'out' && m.status === 'failed' && <p className="mt-0.5 text-right text-[10px] text-red-700">Not delivered{m.error ? ` — ${m.error}` : ''}</p>}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
          {client.exitDate ? (
            <div className="flex items-center gap-2 border-t border-line bg-red-50 px-4 py-3 text-xs text-red-700">
              <Ban className="size-4" /> {client.name} left the firm on {formatDate(client.exitDate)}. Messaging and notifications are switched off.
            </div>
          ) : (
            <div className="border-t border-line p-3">
              <div className="mb-2 flex gap-1.5 overflow-x-auto">
                {QUICK_REPLIES.map((r) => (
                  <button key={r} onClick={() => setDraft(r)} className="shrink-0 rounded-full border border-line bg-white px-2.5 py-1 text-2xs text-ink-600 hover:border-emerald-300 hover:text-emerald-800">
                    {r.slice(0, 38)}…
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  placeholder="Type a message"
                  className="min-h-[40px] resize-none"
                  aria-label="Message"
                />
                <Button variant="success" size="icon" className="size-10 shrink-0 rounded-full" onClick={send} disabled={!draft.trim()} aria-label="Send">
                  <Send />
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <EmptyState icon={<MessageCircle />} title="Select a chat" />
      )}
    </Card>
  );
}

function useAudience() {
  const db = useDb();
  const me = useCurrentUser();
  return visibleClients(db, me);
}

function AudiencePicker({ selected, setSelected }: { selected: Set<string>; setSelected: (s: Set<string>) => void }) {
  const clients = useAudience();
  const active = clients.filter((c) => !c.exitDate);
  const exited = clients.length - active.length;
  const preset = (pred: (c: Client) => boolean) => setSelected(new Set(active.filter(pred).map((c) => c.id)));
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {[
          ['All active clients', () => preset(() => true)],
          ['GST clients', () => preset((c) => !!c.taxesApplicable?.includes('GST'))],
          ['Income Tax only', () => preset((c) => !c.taxesApplicable?.includes('GST'))],
          ['Companies & LLPs', () => preset((c) => ['Private Limited', 'Public Limited', 'LLP'].includes(c.entityType))],
          ['Clear', () => setSelected(new Set())],
        ].map(([l, fn]) => (
          <button key={l as string} type="button" onClick={fn as () => void} className="h-7 rounded-full border border-line bg-white px-3 text-xs text-ink-700 hover:border-emerald-300">
            {l as string}
          </button>
        ))}
      </div>
      <div className="grid max-h-56 gap-1 overflow-y-auto rounded-md border border-line p-2 sm:grid-cols-2">
        {active.map((c) => (
          <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs text-ink-800 hover:bg-slate-50">
            <Checkbox checked={selected.has(c.id)} onCheckedChange={(v) => setSelected(v ? new Set(selected).add(c.id) : (selected.delete(c.id), new Set(selected)))} />
            <span className="truncate">{c.name}</span>
          </label>
        ))}
      </div>
      <p className="mt-1.5 text-2xs text-ink-500">
        {selected.size} selected{exited ? ` · ${exited} client(s) who left the firm are excluded` : ''}
      </p>
    </div>
  );
}

function PhonePreview({ body, firm }: { body: string; firm: string }) {
  return (
    <div className="mx-auto w-full max-w-[280px] rounded-[28px] border-[6px] border-ink-900 bg-[#efeae2] shadow-pop">
      <div className="rounded-t-[20px] bg-[#075e54] px-3 py-2 text-xs font-semibold text-white">{firm}</div>
      <div className="min-h-[260px] p-3">
        {body.trim() ? (
          <div className="rounded-lg rounded-tl-none bg-white px-3 py-2 text-[12px] text-ink-900 shadow-sm">
            <p className="whitespace-pre-wrap">{body}</p>
            <p className="mt-1 text-right text-[9px] text-ink-400">now</p>
          </div>
        ) : (
          <p className="pt-20 text-center text-2xs text-ink-500">Message preview</p>
        )}
      </div>
    </div>
  );
}

function BroadcastComposer() {
  const db = useDb();
  const { confirm, dialog } = useConfirm();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState('GST data reminder');
  const [body, setBody] = useState(QUICK_REPLIES[0]);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      {dialog}
      <Card>
        <CardHeader title="New broadcast" description="Send one message to many clients" icon={<Megaphone />} />
        <div className="space-y-4 p-4">
          <AudiencePicker selected={selected} setSelected={setSelected} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 text-xs font-medium text-ink-700">Template</p>
              <Select
                onChange={(e) => {
                  const i = Number(e.target.value);
                  setBody(QUICK_REPLIES[i]);
                  setTitle(['GST data reminder', 'Filing confirmation', 'Fee reminder', 'Pending documents'][i]);
                }}
                aria-label="Template"
              >
                {['GST data reminder', 'Filing confirmation', 'Fee reminder', 'Pending documents'].map((t, i) => (
                  <option key={t} value={i}>
                    {t}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium text-ink-700">Broadcast name</p>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Broadcast name" />
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-ink-700">Message</p>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[110px]" aria-label="Message" />
          </div>
          <div className="flex justify-end">
            <Button
              variant="success"
              disabled={!selected.size || !body.trim()}
              onClick={() =>
                confirm({
                  title: `Send to ${selected.size} clients?`,
                  description: `Each client receives this message individually on WhatsApp.${simNote() ? ' (Simulated — nothing is actually sent.)' : ''}`,
                  confirmLabel: 'Send broadcast',
                  onConfirm: () => {
                    const n = store.sendBroadcast({ title, body, kind: 'compliance', clientIds: [...selected] });
                    if (n) {
                      toast.success(`Broadcast queued for ${n} clients`, { description: simNote() });
                      setSelected(new Set());
                    }
                  },
                })
              }
            >
              <Send /> Send to {selected.size} clients
            </Button>
          </div>
        </div>
      </Card>
      <PhonePreview body={body} firm={db.firm.name} />
    </div>
  );
}

function FestivalWishes() {
  const db = useDb();
  const me = useCurrentUser();
  const { confirm, dialog } = useConfirm();
  const upcoming = FESTIVALS.filter((f) => f.date >= todayKey()).slice(0, 6);
  const [festival, setFestival] = useState(upcoming[0]?.name ?? 'Diwali');
  const [variant, setVariant] = useState(0);
  const [thinking, setThinking] = useState(false);
  const [chosen, setChosen] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const suggestions = festivalSuggestions(festival, db.firm.name, variant);
  const audience = visibleClients(db, me).filter((c) => !c.exitDate);
  const fest = upcoming.find((f) => f.name === festival);

  const regenerate = () => {
    setThinking(true);
    setChosen(null);
    setTimeout(() => {
      setVariant((v) => v + 1);
      setThinking(false);
    }, 900);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr_300px]">
      {dialog}
      <Card className="h-fit">
        <CardHeader title="Upcoming occasions" icon={<PartyPopper />} />
        <ul className="divide-y divide-line">
          {upcoming.map((f) => (
            <li key={f.name + f.date}>
              <button
                onClick={() => (setFestival(f.name), setChosen(null), setVariant(0))}
                className={cn('flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-slate-50', festival === f.name && 'bg-emerald-50/70')}
              >
                <span className="min-w-0 flex-1">
                  <span className={cn('block text-[13px] text-ink-900', festival === f.name && 'font-semibold')}>{f.name}</span>
                  <span className="text-2xs text-ink-500">{formatDate(f.date, 'EEE, d MMM yyyy')}</span>
                </span>
                {dismissed.has(f.name) ? <span className="text-2xs text-ink-400">Skipped</span> : db.broadcasts.some((b) => b.title.startsWith(f.name)) ? <span className="text-2xs text-emerald-700">Sent</span> : null}
              </button>
            </li>
          ))}
        </ul>
        <p className="border-t border-line px-4 py-2 text-[10px] text-ink-400">Dates are indicative for the demo.</p>
      </Card>

      <Card>
        <CardHeader
          title={`${festival} wishes`}
          description={fest ? `${formatDate(fest.date, 'd MMMM')} · ${audience.length} active clients` : undefined}
          icon={<Sparkles />}
          action={
            <Button size="sm" variant="ghost" onClick={regenerate} disabled={thinking}>
              <RefreshCw className={cn(thinking && 'animate-spin')} /> Regenerate
            </Button>
          }
        />
        <div className="space-y-3 p-4">
          <p className="flex items-center gap-1.5 text-xs text-ink-500">
            <Sparkles className="size-3.5 text-violet-500" /> AI-suggested messages (demo — generated from templates). Pick one, edit it, then send or skip.
          </p>
          {thinking
            ? [0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-lg bg-slate-100" />)
            : suggestions.map((s, i) => (
                <button
                  key={s}
                  onClick={() => (setChosen(i), setText(s))}
                  className={cn('block w-full rounded-lg border p-3 text-left text-[13px] leading-relaxed transition-colors', chosen === i ? 'border-emerald-400 bg-emerald-50 ring-1 ring-emerald-300' : 'border-line bg-white hover:border-slate-300')}
                >
                  <span className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-ink-400">Option {i + 1}</span>
                  {s}
                </button>
              ))}
          {chosen !== null && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-ink-700">Edit before sending</p>
              <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-[90px]" aria-label="Wish message" />
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              onClick={() => {
                setDismissed(new Set(dismissed).add(festival));
                setChosen(null);
                toast('Skipped — no messages will be sent for ' + festival);
              }}
            >
              <X /> Don’t send this time
            </Button>
            <Button
              variant="success"
              disabled={chosen === null || !text.trim()}
              onClick={() =>
                confirm({
                  title: `Send ${festival} wishes to ${audience.length} clients?`,
                  description: `One click sends the message to every active client’s WhatsApp number.${simNote() ? ' (Simulated — nothing is actually sent.)' : ''}`,
                  confirmLabel: 'Send to all',
                  onConfirm: () => {
                    const n = store.sendBroadcast({ title: `${festival} wishes`, body: text, kind: 'festival', clientIds: audience.map((c) => c.id) });
                    if (n) toast.success(`${festival} wishes sent to ${n} clients`, { description: simNote() });
                  },
                })
              }
            >
              <Send /> Send to all clients
            </Button>
          </div>
        </div>
      </Card>
      <PhonePreview body={chosen !== null ? text : ''} firm={db.firm.name} />
    </div>
  );
}

function History() {
  const db = useDb();
  const { users } = useLookup();
  const KIND: Record<Broadcast['kind'], string> = { festival: 'bg-violet-50 text-violet-700', compliance: 'bg-sky-50 text-sky-700', custom: 'bg-slate-100 text-ink-600' };
  return (
    <Card>
      {db.broadcasts.length === 0 ? (
        <EmptyState icon={<Megaphone />} title="No broadcasts yet" />
      ) : (
        <ul className="divide-y divide-line">
          {db.broadcasts.map((b) => (
            <li key={b.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-ink-900">{b.title}</span>
                  <span className={cn('rounded px-1.5 py-0.5 text-2xs font-medium capitalize', KIND[b.kind])}>{b.kind}</span>
                </p>
                <p className="mt-0.5 line-clamp-2 text-xs text-ink-600">{b.body}</p>
              </div>
              <div className="shrink-0 text-xs text-ink-500 sm:text-right">
                <p>
                  {b.recipients} clients · {users.get(b.sentBy)?.name}
                </p>
                <p className="text-2xs">{formatDateTime(b.sentAt)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
