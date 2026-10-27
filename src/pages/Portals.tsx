import { useState } from 'react';
import { Copy, ExternalLink, Eye, EyeOff, Info, KeyRound, Plus, Search, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, EmptyState, PageHeader } from '@/components/ui/misc';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form';
import { canManageMasters, visibleClients } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { store, useCurrentUser, useDb } from '@/store/store';
import type { Portal } from '@/types';
import { api, BACKEND } from '@/api/client';

export default function PortalsPage() {
  const db = useDb();
  const me = useCurrentUser();
  const [adding, setAdding] = useState(false);
  const sorted = [...db.portals].sort((a, b) => b.clicks - a.clicks);
  const frequent = sorted.slice(0, 4);
  const rest = sorted.slice(4);
  const open = (p: Portal) => {
    store.trackPortalOpen(p.id);
    window.open(p.url, '_blank', 'noopener');
  };

  return (
    <div className="animate-slide-up">
      <PageHeader
        title="Portal Login"
        description="Government and statutory websites your team logs in to. Most-used portals move to the top automatically."
        actions={
          canManageMasters(me) && (
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus /> Add portal
            </Button>
          )
        }
      />

      <p className="mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-400">
        <TrendingUp className="size-3" /> Most frequent
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {frequent.map((p) => (
          <button
            key={p.id}
            onClick={() => open(p)}
            className="group flex flex-col rounded-xl border border-line bg-white p-4 text-left shadow-card transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            <div className="flex items-start justify-between">
              <span className="flex size-11 items-center justify-center rounded-lg text-sm font-bold" style={{ background: `hsl(${p.hue} 80% 94%)`, color: `hsl(${p.hue} 55% 32%)` }}>
                {p.short}
              </span>
              <ExternalLink className="size-4 text-ink-300 group-hover:text-brand-600" />
            </div>
            <p className="mt-3 text-[15px] font-semibold text-ink-900">{p.name}</p>
            <p className="text-xs text-ink-500">{p.description}</p>
            <p className="mt-2 text-2xs text-ink-400">Opened {p.clicks} times</p>
          </button>
        ))}
      </div>

      <p className="mb-2 mt-5 text-2xs font-semibold uppercase tracking-wide text-ink-400">All portals</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {rest.map((p) => (
          <button
            key={p.id}
            onClick={() => open(p)}
            className="flex items-center gap-2.5 rounded-lg border border-line bg-white px-3 py-2 text-left hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md text-[10px] font-bold" style={{ background: `hsl(${p.hue} 80% 94%)`, color: `hsl(${p.hue} 55% 32%)` }}>
              {p.short}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium text-ink-900">{p.name}</span>
              <span className="block truncate text-[10px] text-ink-400">{p.clicks} opens</span>
            </span>
          </button>
        ))}
      </div>

      <ClientCredentials />

      <PortalDialog open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function ClientCredentials() {
  const db = useDb();
  const me = useCurrentUser();
  const [q, setQ] = useState('');
  const [portal, setPortal] = useState('');
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  // Backend mode: passwords are fetched one at a time from the server (each reveal is audited).
  const [fetched, setFetched] = useState<Map<string, string>>(new Map());
  const portals = new Map(db.portals.map((p) => [p.id, p]));
  const rows = visibleClients(db, me)
    .filter((c) => !c.exitDate)
    .flatMap((c) => (c.portalLogins ?? []).map((l, i) => ({ key: `${c.id}_${i}`, index: i, client: c, login: l, portal: portals.get(l.portalId) })))
    .filter((r) => (!portal || r.login.portalId === portal) && (!q || r.client.name.toLowerCase().includes(q.toLowerCase())));
  const passwordOf = async (key: string, clientId: string, index: number, login: { password: string }) => {
    if (!BACKEND) return login.password;
    const known = fetched.get(key);
    if (known !== undefined) return known;
    const { password } = await api.revealLogin(clientId, index);
    setFetched((m) => new Map(m).set(key, password));
    return password;
  };
  const toggleReveal = (key: string, clientId: string, index: number, login: { password: string }) => {
    if (revealed.has(key)) return setRevealed((s) => (s.delete(key), new Set(s)));
    passwordOf(key, clientId, index, login).then(
      () => setRevealed((s) => new Set(s).add(key)),
      (e: Error) => toast.error(e.message),
    );
  };
  const copy = (text: string, what: string) => {
    void navigator.clipboard?.writeText(text).then(
      () => toast.success(`${what} copied`),
      () => toast.error('Copy not allowed here — select the text instead'),
    );
  };
  return (
    <Card className="mt-6">
      <CardHeader title="Client login details" description="Saved credentials for client portals" icon={<KeyRound />} />
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search client…" className="pl-8" aria-label="Search client" />
        </div>
        <div className="w-48">
          <Select value={portal} onChange={(e) => setPortal(e.target.value)} aria-label="Portal">
            <option value="">All portals</option>
            {db.portals.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState compact icon={<KeyRound />} title="No saved logins" description="Add portal logins from a client’s profile." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left">
            <thead>
              <tr className="border-b border-line text-2xs font-medium uppercase tracking-wide text-ink-400">
                <th className="px-4 py-2 font-medium">Client</th>
                <th className="px-3 py-2 font-medium">Portal</th>
                <th className="px-3 py-2 font-medium">Username / ID</th>
                <th className="px-3 py-2 font-medium">Password</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map(({ key, index, client, login, portal: p }) => (
                <tr key={key} className="hover:bg-slate-50">
                  <td className="px-4 py-2 text-[13px] font-medium text-ink-900">{client.name}</td>
                  <td className="px-3 py-2 text-xs text-ink-700">{p?.name}</td>
                  <td className="px-3 py-2">
                    <button onClick={() => copy(login.username, 'Username')} className="inline-flex items-center gap-1.5 font-mono text-xs text-ink-800 hover:text-brand-700">
                      {login.username} <Copy className="size-3 text-ink-400" />
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5 font-mono text-xs text-ink-800">
                      {revealed.has(key) ? (BACKEND ? fetched.get(key) : login.password) || '—' : BACKEND && !login.hasPassword ? '—' : '••••••••'}
                      <button
                        onClick={() => toggleReveal(key, client.id, index, login)}
                        className="rounded p-0.5 text-ink-400 hover:text-ink-700"
                        aria-label={revealed.has(key) ? 'Hide password' : 'Show password'}
                      >
                        {revealed.has(key) ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                      </button>
                      <button
                        onClick={() =>
                          passwordOf(key, client.id, index, login).then(
                            (pw) => copy(pw, 'Password'),
                            (e: Error) => toast.error(e.message),
                          )
                        } className="rounded p-0.5 text-ink-400 hover:text-ink-700" aria-label="Copy password">
                        <Copy className="size-3" />
                      </button>
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    {p && (
                      <Button size="sm" onClick={() => (store.trackPortalOpen(p.id), window.open(p.url, '_blank', 'noopener'))}>
                        Open <ExternalLink />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={cn('flex items-start gap-1.5 border-t border-line px-4 py-2.5 text-2xs text-ink-500')}>
        <Info className="mt-px size-3 shrink-0" />
        Demo credentials are fictional. In production these would be encrypted, visible only to permitted users, and every reveal would be logged. Automatic sign-in isn’t possible on most government portals because they require captcha or OTP.
      </p>
    </Card>
  );
}

function PortalDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [short, setShort] = useState('');
  const [url, setUrl] = useState('https://');
  const [description, setDescription] = useState('');
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      {open && (
        <DialogContent title="Add portal" description="Shows up for everyone in the firm." size="sm">
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              if (store.savePortal({ name, short: short || name.slice(0, 4).toUpperCase(), url, description })) {
                toast.success(`${name} added`);
                onClose();
              }
            }}
          >
            <DialogBody className="space-y-3">
              <Field label="Portal name" htmlFor="pt-name" required>
                <Input id="pt-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. SEZ Online" />
              </Field>
              <Field label="Short label" htmlFor="pt-short" hint="2–4 letters shown on the tile">
                <Input id="pt-short" maxLength={4} value={short} onChange={(e) => setShort(e.target.value.toUpperCase())} />
              </Field>
              <Field label="Website address" htmlFor="pt-url" required>
                <Input id="pt-url" value={url} onChange={(e) => setUrl(e.target.value)} />
              </Field>
              <Field label="What it’s used for" htmlFor="pt-desc">
                <Input id="pt-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button onClick={onClose}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={!name.trim()}>
                Add portal
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
