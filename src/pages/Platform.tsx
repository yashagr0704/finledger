import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { Ban, Building2, KeyRound, Loader2, LogOut, MoreHorizontal, Plus, Search, Trash2, UserMinus, UserPlus, UserRoundCheck } from 'lucide-react';
import { toast } from 'sonner';
import { brand } from '@/config/brand';
import { api, ApiError, type FirmAdmin, type PlatformFirm } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/form';
import { Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/misc';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { useConfirm } from '@/components/ui/confirm';
import { cn } from '@/lib/utils';
import { AuthCard } from './Auth';

type Me = { id: string; email: string; name: string };

/**
 * The platform superadmin console at /superadmin: firms and their admins only. Separate sign-in
 * from firm users; what happens inside a firm (clients, tasks, employees) is for its admins.
 */
export default function PlatformApp() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    api.platform.me().then(setMe, () => setMe(null));
  }, []);
  if (me === undefined) return <div className="p-6"><Skeleton className="h-40" /></div>;
  if (!me) return <PlatformLogin onSignedIn={setMe} />;
  return <Console me={me} onSignedOut={() => setMe(null)} />;
}

function PlatformLogin({ onSignedIn }: { onSignedIn: (me: Me) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <AuthCard title="Superadmin sign in" subtitle="For platform operators. Firm staff sign in on the main page.">
      <FormBody
        submitLabel="Sign in"
        canSubmit={!!email && !!password}
        onSubmit={async () => {
          await api.platform.login(email, password);
          onSignedIn(await api.platform.me());
        }}
        footer={false}
      >
        <Field label="Email" htmlFor="pl-email">
          <Input id="pl-email" type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" htmlFor="pl-password">
          <Input id="pl-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
      </FormBody>
    </AuthCard>
  );
}

type DialogState =
  | { kind: 'newFirm' }
  | { kind: 'addAdmin'; firm: PlatformFirm }
  | { kind: 'adminPassword'; admin: FirmAdmin }
  | { kind: 'deleteFirm'; firm: PlatformFirm }
  | { kind: 'myPassword' }
  | null;

function Console({ me, onSignedOut }: { me: Me; onSignedOut: () => void }) {
  const { confirm, dialog } = useConfirm();
  const [firms, setFirms] = useState<PlatformFirm[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<DialogState>(null);

  const load = useCallback(
    () =>
      api.platform.firms().then(
        (d) => (setFirms(d.firms), setError('')),
        (e: Error) => (e instanceof ApiError && e.status === 401 ? onSignedOut() : setError(e.message)),
      ),
    [onSignedOut],
  );
  useEffect(() => void load(), [load]);

  const run = async (p: Promise<unknown>, done: string) => {
    try {
      await p;
      toast.success(done);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Something went wrong.');
    }
  };
  const close = () => setOpen(null);
  const closeAndReload = () => (setOpen(null), void load());

  const onlyActiveAdmin = (firm: PlatformFirm, a: FirmAdmin) => a.status === 'active' && firm.admins.filter((x) => x.status === 'active').length === 1;
  const noAdminWarning = (firm: PlatformFirm, a: FirmAdmin) => (onlyActiveAdmin(firm, a) ? ` ${firm.name} will have no active admin until you add or reactivate one.` : '');

  const shown = (firms ?? []).filter((f) => !q || `${f.name} ${f.admins.map((a) => `${a.name} ${a.email}`).join(' ')}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="min-h-screen bg-canvas">
      {dialog}
      <header className="sticky top-[env(safe-area-inset-top,0px)] z-10 border-b border-line bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <span className="flex size-8 items-center justify-center rounded-lg bg-brand-600 text-xs font-bold text-white">{brand.mark}</span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-ink-900">{brand.name} · Superadmin</p>
            <p className="truncate text-2xs text-ink-500">{me.email}</p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setOpen({ kind: 'myPassword' })}>
            <KeyRound /> <span className="hidden sm:inline">Password</span>
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void api.platform.logout().finally(onSignedOut)}>
            <LogOut /> <span className="hidden sm:inline">Sign out</span>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        <PageHeader
          title="Firms"
          description={firms ? `${firms.length} firm${firms.length === 1 ? '' : 's'} · ${firms.filter((f) => f.suspendedAt).length} suspended` : 'Firms and their admins'}
          actions={
            <Button variant="primary" onClick={() => setOpen({ kind: 'newFirm' })}>
              <Plus /> New firm
            </Button>
          }
        />
        <div className="relative mb-4 w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search firm, admin or email…"
            aria-label="Search firms"
            className="h-8 w-full rounded-md border border-line bg-white pl-8 pr-2 text-[13px] shadow-sm placeholder:text-ink-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </div>

        {error ? (
          <Card>
            <EmptyState icon={<Building2 />} title="Couldn’t load firms" description={error} />
          </Card>
        ) : !firms ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-36" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <Card>
            <EmptyState icon={<Building2 />} title={firms.length ? 'No firms match' : 'No firms yet'} />
          </Card>
        ) : (
          <div className="space-y-3">
            {shown.map((firm) => (
              <Card key={firm.id} className={cn('overflow-hidden', firm.suspendedAt && 'border-amber-200')}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-ink-900">
                      {firm.name}
                      {firm.suspendedAt && <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-2xs font-medium text-amber-700">Suspended</span>}
                    </p>
                    <p className="text-xs text-ink-500">
                      Since {format(new Date(firm.createdAt), 'd MMM yyyy')} · {firm.members} member{firm.members === 1 ? '' : 's'}
                    </p>
                  </div>
                  <Button size="sm" onClick={() => setOpen({ kind: 'addAdmin', firm })}>
                    <UserPlus /> Add admin
                  </Button>
                  <Menu>
                    <MenuTrigger asChild>
                      <Button size="icon-sm" variant="ghost" aria-label={`Manage ${firm.name}`}>
                        <MoreHorizontal />
                      </Button>
                    </MenuTrigger>
                    <MenuContent>
                      {firm.suspendedAt ? (
                        <MenuItem onSelect={() => void run(api.platform.setSuspended(firm.id, false), `${firm.name} reactivated`)}>
                          <UserRoundCheck /> Reactivate firm
                        </MenuItem>
                      ) : (
                        <MenuItem
                          onSelect={() =>
                            confirm({
                              title: `Suspend ${firm.name}?`,
                              description: 'Everyone in this firm is signed out and can’t sign in, and its scheduled reminders stop. Nothing is deleted; you can reactivate it any time.',
                              confirmLabel: 'Suspend firm',
                              tone: 'danger',
                              onConfirm: () => void run(api.platform.setSuspended(firm.id, true), `${firm.name} suspended`),
                            })
                          }
                        >
                          <Ban /> Suspend firm
                        </MenuItem>
                      )}
                      <MenuSeparator />
                      <MenuItem className="text-red-600" onSelect={() => setOpen({ kind: 'deleteFirm', firm })}>
                        <Trash2 /> Delete firm…
                      </MenuItem>
                    </MenuContent>
                  </Menu>
                </div>

                {firm.admins.length === 0 ? (
                  <p className="px-4 py-3 text-xs text-amber-700">This firm has no admin. Add one so someone can manage it.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {firm.admins.map((a) => (
                      <li key={a.id} className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5', a.status === 'deactivated' && 'opacity-60')}>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium text-ink-900">{a.name}</p>
                          <p className="truncate text-xs text-ink-500">{a.email}</p>
                        </div>
                        <StatusBadge admin={a} />
                        <span className="w-28 text-right text-2xs text-ink-400">{a.lastLoginAt ? `Seen ${formatDistanceToNow(new Date(a.lastLoginAt), { addSuffix: true })}` : 'Never signed in'}</span>
                        <Menu>
                          <MenuTrigger asChild>
                            <Button size="icon-sm" variant="ghost" aria-label={`Manage ${a.name}`}>
                              <MoreHorizontal />
                            </Button>
                          </MenuTrigger>
                          <MenuContent>
                            <MenuItem onSelect={() => setOpen({ kind: 'adminPassword', admin: a })}>
                              <KeyRound /> Set password
                            </MenuItem>
                            {a.status === 'active' ? (
                              <MenuItem
                                onSelect={() =>
                                  confirm({
                                    title: `Deactivate ${a.name}?`,
                                    description: `They’re signed out and can’t sign in until reactivated. Their work in the firm is kept.${noAdminWarning(firm, a)}`,
                                    confirmLabel: 'Deactivate',
                                    tone: 'danger',
                                    onConfirm: () => void run(api.platform.setAdminStatus(a.id, 'deactivated'), `${a.name} deactivated`),
                                  })
                                }
                              >
                                <UserMinus /> Deactivate
                              </MenuItem>
                            ) : (
                              <MenuItem
                                onSelect={() =>
                                  a.hasPassword
                                    ? void run(api.platform.setAdminStatus(a.id, 'active'), `${a.name} activated`)
                                    : (toast.info('Set a password first, then activate.'), setOpen({ kind: 'adminPassword', admin: a }))
                                }
                              >
                                <UserRoundCheck /> Activate
                              </MenuItem>
                            )}
                            <MenuSeparator />
                            <MenuItem
                              className="text-red-600"
                              onSelect={() =>
                                confirm({
                                  title: `Delete ${a.name} permanently?`,
                                  description: `This removes their account and can’t be undone. It’s refused while tasks are assigned to them; deactivate them instead in that case.${noAdminWarning(firm, a)}`,
                                  confirmLabel: 'Delete permanently',
                                  tone: 'danger',
                                  onConfirm: () => void run(api.platform.deleteAdmin(a.id), `${a.name} deleted`),
                                })
                              }
                            >
                              <Trash2 /> Delete permanently
                            </MenuItem>
                          </MenuContent>
                        </Menu>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            ))}
          </div>
        )}
        <p className="mt-6 text-center text-2xs text-ink-400">Employees, clients and work inside a firm are managed by that firm’s admins.</p>
      </main>

      {open?.kind === 'newFirm' && <NewFirmDialog onClose={close} onDone={closeAndReload} />}
      {open?.kind === 'addAdmin' && <AddAdminDialog firm={open.firm} onClose={close} onDone={closeAndReload} />}
      {open?.kind === 'adminPassword' && <AdminPasswordDialog admin={open.admin} onClose={close} onDone={closeAndReload} />}
      {open?.kind === 'deleteFirm' && <DeleteFirmDialog firm={open.firm} onClose={close} onDone={closeAndReload} />}
      {open?.kind === 'myPassword' && <MyPasswordDialog onClose={close} />}
    </div>
  );
}

function StatusBadge({ admin }: { admin: FirmAdmin }) {
  return (
    <span className="flex items-center gap-2">
      <span
        className={cn(
          'rounded-full px-1.5 py-0.5 text-2xs font-medium',
          admin.status === 'active' ? 'bg-emerald-50 text-emerald-700' : admin.status === 'invited' ? 'bg-sky-50 text-sky-700' : 'bg-slate-100 text-ink-500',
        )}
      >
        {admin.status === 'active' ? 'Active' : admin.status === 'invited' ? 'Invited' : 'Deactivated'}
      </span>
      {!admin.hasPassword && <span className="text-2xs text-amber-700">No password</span>}
    </span>
  );
}

// ---------------------------------------------------------------- dialogs

/** Form body with busy state and an inline error; `footer` false renders a full-width submit. */
function FormBody({
  children,
  submitLabel,
  canSubmit,
  onSubmit,
  onCancel,
  danger,
  footer = true,
}: {
  children: ReactNode;
  submitLabel: string;
  canSubmit: boolean;
  onSubmit: () => Promise<void>;
  onCancel?: () => void;
  danger?: boolean;
  footer?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSubmit();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setBusy(false);
    }
  };
  const errorBox = error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>;
  const button = (
    <Button type="submit" variant={danger ? 'danger' : 'primary'} size={footer ? undefined : 'lg'} className={footer ? undefined : 'w-full'} disabled={busy || !canSubmit}>
      {busy && <Loader2 className="animate-spin" />} {submitLabel}
    </Button>
  );
  if (!footer)
    return (
      <form onSubmit={submit} className="space-y-4" noValidate>
        {children}
        {errorBox}
        {button}
      </form>
    );
  return (
    <form onSubmit={submit} noValidate>
      <DialogBody className="space-y-4">
        {children}
        {errorBox}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {button}
      </DialogFooter>
    </form>
  );
}

function FormDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={title} size="sm">
        {children}
      </DialogContent>
    </Dialog>
  );
}

const PW_HINT = 'At least 8 characters. Share it with them securely.';

function NewFirmDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState({ firmName: '', adminName: '', email: '', password: '' });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  return (
    <FormDialog title="New firm" onClose={onClose}>
      <FormBody
        submitLabel="Create firm"
        canSubmit={Object.values(v).every(Boolean)}
        onCancel={onClose}
        onSubmit={async () => {
          await api.platform.createFirm(v);
          toast.success(`${v.firmName} created`, { description: `${v.adminName} can sign in now as its admin.` });
          onDone();
        }}
      >
        <Field label="Firm name" htmlFor="nf-firm">
          <Input id="nf-firm" autoFocus value={v.firmName} onChange={set('firmName')} />
        </Field>
        <Field label="Admin’s name" htmlFor="nf-name">
          <Input id="nf-name" value={v.adminName} onChange={set('adminName')} />
        </Field>
        <Field label="Admin’s email" htmlFor="nf-email">
          <Input id="nf-email" type="email" autoComplete="off" value={v.email} onChange={set('email')} />
        </Field>
        <Field label="Admin’s password" htmlFor="nf-pw" hint={PW_HINT}>
          <Input id="nf-pw" type="password" autoComplete="new-password" value={v.password} onChange={set('password')} />
        </Field>
      </FormBody>
    </FormDialog>
  );
}

function AddAdminDialog({ firm, onClose, onDone }: { firm: PlatformFirm; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState({ name: '', email: '', password: '' });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  return (
    <FormDialog title={`Add admin to ${firm.name}`} onClose={onClose}>
      <FormBody
        submitLabel="Add admin"
        canSubmit={Object.values(v).every(Boolean)}
        onCancel={onClose}
        onSubmit={async () => {
          await api.platform.addAdmin(firm.id, v);
          toast.success(`${v.name} is now an admin of ${firm.name}`, { description: 'They can sign in now with the password you set.' });
          onDone();
        }}
      >
        <Field label="Name" htmlFor="aa-name">
          <Input id="aa-name" autoFocus value={v.name} onChange={set('name')} />
        </Field>
        <Field label="Email" htmlFor="aa-email">
          <Input id="aa-email" type="email" autoComplete="off" value={v.email} onChange={set('email')} />
        </Field>
        <Field label="Password" htmlFor="aa-pw" hint={PW_HINT}>
          <Input id="aa-pw" type="password" autoComplete="new-password" value={v.password} onChange={set('password')} />
        </Field>
      </FormBody>
    </FormDialog>
  );
}

function AdminPasswordDialog({ admin, onClose, onDone }: { admin: FirmAdmin; onClose: () => void; onDone: () => void }) {
  const [pw, setPw] = useState('');
  return (
    <FormDialog title={`Set password for ${admin.name}`} onClose={onClose}>
      <FormBody
        submitLabel="Set password"
        canSubmit={!!pw}
        onCancel={onClose}
        onSubmit={async () => {
          await api.platform.setAdminPassword(admin.id, pw);
          toast.success(`Password set for ${admin.name}`, { description: 'They have been signed out everywhere.' });
          onDone();
        }}
      >
        <Field label="New password" htmlFor="ap-pw" hint={PW_HINT}>
          <Input id="ap-pw" type="password" autoComplete="new-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
      </FormBody>
    </FormDialog>
  );
}

function DeleteFirmDialog({ firm, onClose, onDone }: { firm: PlatformFirm; onClose: () => void; onDone: () => void }) {
  const [typed, setTyped] = useState('');
  return (
    <FormDialog title={`Delete ${firm.name}?`} onClose={onClose}>
      <FormBody
        submitLabel="Delete firm permanently"
        danger
        canSubmit={typed === firm.name}
        onCancel={onClose}
        onSubmit={async () => {
          await api.platform.deleteFirm(firm.id, typed);
          toast.success(`${firm.name} deleted`);
          onDone();
        }}
      >
        <p className="text-[13px] leading-relaxed text-ink-600">
          This permanently deletes the firm with all its users, clients, tasks, files and messages. It can’t be undone. To keep the data, suspend the firm instead.
        </p>
        <Field label={`Type “${firm.name}” to confirm`} htmlFor="df-name">
          <Input id="df-name" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </Field>
      </FormBody>
    </FormDialog>
  );
}

function MyPasswordDialog({ onClose }: { onClose: () => void }) {
  const [v, setV] = useState({ current: '', next: '', confirm: '' });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  return (
    <FormDialog title="Change your password" onClose={onClose}>
      <FormBody
        submitLabel="Change password"
        canSubmit={!!v.current && !!v.next}
        onCancel={onClose}
        onSubmit={async () => {
          if (v.next !== v.confirm) throw new Error('The two new passwords don’t match.');
          await api.platform.changePassword(v.current, v.next);
          toast.success('Password changed', { description: 'Your other sessions have been signed out.' });
          onClose();
        }}
      >
        <Field label="Current password" htmlFor="mp-cur">
          <Input id="mp-cur" type="password" autoComplete="current-password" autoFocus value={v.current} onChange={set('current')} />
        </Field>
        <Field label="New password" htmlFor="mp-next" hint="At least 8 characters.">
          <Input id="mp-next" type="password" autoComplete="new-password" value={v.next} onChange={set('next')} />
        </Field>
        <Field label="Confirm new password" htmlFor="mp-confirm">
          <Input id="mp-confirm" type="password" autoComplete="new-password" value={v.confirm} onChange={set('confirm')} />
        </Field>
      </FormBody>
    </FormDialog>
  );
}
