import { useState } from 'react';
import { Link } from 'react-router-dom';
import { isToday, parseISO } from 'date-fns';
import { Bell, Check, Pin, PinOff, Plus, Repeat, StickyNote, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, EmptyState, PageHeader } from '@/components/ui/misc';
import { Input, Select, Textarea } from '@/components/ui/form';
import { Checkbox } from '@/components/ui/checkbox';
import { formatDate, timeAgo } from '@/lib/dates';
import { useLookup } from '@/lib/lookup';
import { visibleClients } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { store, useCurrentUser, useDb } from '@/store/store';
import type { Note, Reminder } from '@/types';

const NOTE_COLORS: Record<Note['color'], string> = {
  yellow: 'bg-amber-50 border-amber-200',
  blue: 'bg-sky-50 border-sky-200',
  green: 'bg-emerald-50 border-emerald-200',
  pink: 'bg-rose-50 border-rose-200',
  slate: 'bg-white border-line',
};
const SWATCH: Record<Note['color'], string> = { yellow: 'bg-amber-300', blue: 'bg-sky-300', green: 'bg-emerald-300', pink: 'bg-rose-300', slate: 'bg-slate-200' };

export default function NotesPage() {
  const db = useDb();
  const me = useCurrentUser();
  const notes = db.notes.filter((n) => n.userId === me.id).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
  const reminders = db.reminders.filter((r) => r.userId === me.id);
  return (
    <div className="animate-slide-up">
      <PageHeader title="Notes & Reminders" description="Your private notes and reminders. Other team members can’t see them." />
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div>
          <NoteComposer />
          {notes.length === 0 ? (
            <Card className="mt-4">
              <EmptyState icon={<StickyNote />} title="No notes yet" description="Jot down client instructions, checklists or meeting points above." />
            </Card>
          ) : (
            <div className="mt-4 columns-1 gap-3 md:columns-2 2xl:columns-3 [&>*]:mb-3">
              {notes.map((n) => (
                <NoteCard key={n.id} note={n} />
              ))}
            </div>
          )}
        </div>
        <Reminders reminders={reminders} />
      </div>
    </div>
  );
}

function NoteComposer() {
  const db = useDb();
  const me = useCurrentUser();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [color, setColor] = useState<Note['color']>('yellow');
  const [clientId, setClientId] = useState('');
  const reset = () => (setTitle(''), setBody(''), setClientId(''), setOpen(false));
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="flex w-full items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-white px-4 py-3 text-left text-[13px] text-ink-500 hover:border-brand-300 hover:text-ink-800">
        <Plus className="size-4" /> Take a note…
      </button>
    );
  return (
    <Card className={cn('border p-3', NOTE_COLORS[color])}>
      <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="border-0 bg-transparent px-1 text-[14px] font-semibold shadow-none focus:ring-0" />
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write your note…" className="mt-1 border-0 bg-transparent px-1 shadow-none focus:ring-0" />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {(Object.keys(SWATCH) as Note['color'][]).map((c) => (
          <button key={c} onClick={() => setColor(c)} aria-label={`${c} note`} className={cn('size-5 rounded-full ring-offset-2', SWATCH[c], color === c && 'ring-2 ring-brand-500')} />
        ))}
        <div className="w-52">
          <Select value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="Link to client">
            <option value="">No client</option>
            {visibleClients(db, me).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="ml-auto flex gap-2">
          <Button onClick={reset}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              if (store.saveNote({ title, body, color, pinned: false, clientId: clientId || undefined })) {
                toast.success('Note saved');
                reset();
              }
            }}
          >
            Save note
          </Button>
        </div>
      </div>
    </Card>
  );
}

function NoteCard({ note }: { note: Note }) {
  const { clients } = useLookup();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const client = note.clientId ? clients.get(note.clientId) : undefined;
  return (
    <div className={cn('group break-inside-avoid rounded-lg border p-3 shadow-card', NOTE_COLORS[note.color])}>
      {editing ? (
        <>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} className="mb-1 bg-white/70" />
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="bg-white/70" />
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={() => store.saveNote({ ...note, title, body }, note.id) && setEditing(false)}>
              Save
            </Button>
          </div>
        </>
      ) : (
        <button className="block w-full text-left" onClick={() => setEditing(true)}>
          <p className="text-[13px] font-semibold text-ink-900">{note.title || 'Untitled'}</p>
          <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-ink-700">{note.body}</p>
        </button>
      )}
      <div className="mt-3 flex items-center gap-2 text-2xs text-ink-500">
        {client && (
          <Link to={`/clients/${client.id}`} className="rounded bg-white/70 px-1.5 py-0.5 font-medium text-ink-700 hover:text-brand-700">
            {client.name}
          </Link>
        )}
        <span>{timeAgo(note.updatedAt)}</span>
        <span className="ml-auto flex gap-0.5 opacity-60 group-hover:opacity-100">
          <button onClick={() => store.saveNote({ ...note, pinned: !note.pinned }, note.id)} className="rounded p-1 hover:bg-white/70" aria-label={note.pinned ? 'Unpin' : 'Pin'}>
            {note.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
          </button>
          <button onClick={() => store.deleteNote(note.id) && toast.success('Note deleted')} className="rounded p-1 hover:bg-white/70 hover:text-red-600" aria-label="Delete note">
            <Trash2 className="size-3.5" />
          </button>
        </span>
      </div>
    </div>
  );
}

function Reminders({ reminders }: { reminders: Reminder[] }) {
  const db = useDb();
  const me = useCurrentUser();
  const { clients } = useLookup();
  const [title, setTitle] = useState('');
  const [dueAt, setDueAt] = useState(() => {
    const d = new Date(Date.now() + 3600_000);
    d.setMinutes(0, 0, 0);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [repeat, setRepeat] = useState<Reminder['repeat']>('none');
  const [clientId, setClientId] = useState('');
  const now = new Date().toISOString();
  const open = reminders.filter((r) => !r.done).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const groups: [string, Reminder[], string][] = [
    ['Overdue', open.filter((r) => r.dueAt < now), 'text-red-600'],
    ['Today', open.filter((r) => r.dueAt >= now && isToday(parseISO(r.dueAt))), 'text-amber-700'],
    ['Upcoming', open.filter((r) => r.dueAt >= now && !isToday(parseISO(r.dueAt))), 'text-ink-500'],
    ['Done', reminders.filter((r) => r.done), 'text-ink-400'],
  ];
  return (
    <Card className="h-fit">
      <CardHeader title="Reminders" description="In-app reminders (no SMS or email in the demo)" icon={<Bell />} />
      <form
        className="space-y-2 border-b border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (store.saveReminder({ title, dueAt: new Date(dueAt).toISOString(), repeat, clientId: clientId || undefined })) {
            toast.success('Reminder set');
            setTitle('');
          }
        }}
      >
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Remind me to…" aria-label="Reminder" />
        <div className="grid grid-cols-2 gap-2">
          <Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} aria-label="When" />
          <Select value={repeat} onChange={(e) => setRepeat(e.target.value as Reminder['repeat'])} aria-label="Repeat">
            <option value="none">Doesn’t repeat</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </Select>
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <Select value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="Client">
              <option value="">No client</option>
              {visibleClients(db, me).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="primary" disabled={!title.trim()}>
            <Plus /> Add
          </Button>
        </div>
      </form>
      {groups.map(([label, items, tone]) =>
        items.length ? (
          <section key={label}>
            <h3 className={cn('bg-slate-50/70 px-4 py-1.5 text-2xs font-semibold uppercase tracking-wide', tone)}>
              {label} · {items.length}
            </h3>
            <ul className="divide-y divide-line">
              {items.map((r) => (
                <li key={r.id} className="group flex items-start gap-2.5 px-4 py-2">
                  <Checkbox className="mt-0.5" checked={r.done} onCheckedChange={() => store.toggleReminder(r.id)} aria-label={`Mark ${r.title} done`} />
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-[13px]', r.done ? 'text-ink-400 line-through' : 'text-ink-900')}>{r.title}</p>
                    <p className="flex flex-wrap items-center gap-x-2 text-2xs text-ink-500">
                      <span className={cn(!r.done && r.dueAt < now && 'font-medium text-red-600')}>{formatDate(r.dueAt, 'EEE d MMM, h:mm a')}</span>
                      {r.repeat !== 'none' && (
                        <span className="flex items-center gap-0.5">
                          <Repeat className="size-3" /> {r.repeat}
                        </span>
                      )}
                      {r.clientId && <span>{clients.get(r.clientId)?.name}</span>}
                    </p>
                  </div>
                  <button onClick={() => store.deleteReminder(r.id)} className="rounded p-1 text-ink-300 opacity-0 hover:text-red-600 group-hover:opacity-100" aria-label="Delete reminder">
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null,
      )}
      {reminders.length === 0 && <EmptyState compact icon={<Check />} title="No reminders" />}
    </Card>
  );
}
