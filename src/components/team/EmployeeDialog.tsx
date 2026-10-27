import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Eye, EyeOff, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Tabs } from '@/components/ui/misc';
import { ROLE_META } from '@/lib/constants';
import { PERMISSION_META, ROLE_DEFAULTS } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { store, useDb } from '@/store/store';
import { BACKEND } from '@/api/client';
import type { Permissions, Role, User } from '@/types';

const schema = z.object({
  name: z.string().trim().min(2, 'Enter a full name'),
  title: z.string().trim().max(80),
  email: z.string().trim().email('Enter a valid email address'),
  phone: z.string().trim().max(20),
  address: z.string().trim().max(200),
  aadhaar: z
    .string()
    .trim()
    .refine((v) => !v || /^(\d{4}\s?\d{4}\s?\d{4}|XXXX XXXX \d{4})$/.test(v), 'Aadhaar should be 12 digits'),
  pan: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => !v || /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v), 'PAN format looks wrong'),
  username: z
    .string()
    .trim()
    .min(3, 'At least 3 characters')
    .regex(/^[a-z0-9._-]+$/i, 'Letters, numbers, dot, dash or underscore'),
  password: z.string(),
  role: z.enum(['admin', 'manager', 'employee']),
  managerId: z.string().optional(),
});
type Values = z.infer<typeof schema>;

/** Masks Aadhaar to the last four digits before it is stored. */
const maskAadhaar = (v: string) => (v ? `XXXX XXXX ${v.replace(/\s/g, '').slice(-4)}` : undefined);

export function EmployeeDialog({ user, open, onClose }: { user?: User; open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      {open && (
        <DialogContent title={user ? `Edit ${user.name}` : 'Add employee'} description={user ? undefined : 'They’ll appear as “Invited” until they sign in. No email is sent in demo mode.'} size="lg">
          <EmployeeForm key={user?.id ?? 'new'} user={user} onClose={onClose} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function EmployeeForm({ user, onClose }: { user?: User; onClose: () => void }) {
  const db = useDb();
  const [tab, setTab] = useState<'profile' | 'access'>('profile');
  const [showPw, setShowPw] = useState(false);
  const [perms, setPerms] = useState<Partial<Permissions>>(user?.permissions ?? {});
  const managers = db.users.filter((u) => u.role === 'manager' && u.status === 'active');
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: user?.name ?? '',
      title: user?.title ?? '',
      email: user?.email ?? '',
      phone: user?.phone ?? '',
      address: user?.address ?? '',
      aadhaar: user?.aadhaar ?? '',
      pan: user?.pan ?? '',
      username: user?.username ?? '',
      password: '',
      role: user?.role ?? 'employee',
      managerId: user?.managerId ?? managers[0]?.id,
    },
  });
  const role = watch('role') as Role;
  const effective = { ...ROLE_DEFAULTS[role], ...perms };

  const onSubmit = (v: Values) => {
    const common = { ...v, aadhaar: v.aadhaar.startsWith('XXXX') ? v.aadhaar : maskAadhaar(v.aadhaar), pan: v.pan || undefined, permissions: role === 'admin' ? undefined : perms };
    if (user) {
      const { password: _pw, ...patch } = common;
      void _pw;
      if (store.updateMember(user.id, { ...patch, managerId: role === 'employee' ? v.managerId : undefined })) {
        toast.success(`${v.name} updated`);
        onClose();
      }
    } else {
      const u = store.inviteMember({ ...common, managerId: role === 'employee' ? v.managerId : undefined });
      if (u) {
        // In backend mode the server replies with the invite link (see store.showInviteLink).
        if (!BACKEND) toast.success(`${u.name} added`, { description: 'Simulated invitation — no email was sent.' });
        onClose();
      }
    }
  };

  return (
    <form noValidate onSubmit={handleSubmit(onSubmit, () => (setTab('profile'), toast.error('Please fix the highlighted fields')))} className="flex min-h-0 flex-1 flex-col">
      <div className="px-5 pt-2">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'profile', label: 'Profile & login' },
            { value: 'access', label: 'Role & permissions' },
          ]}
        />
      </div>
      <DialogBody className="min-h-[360px]">
        {tab === 'profile' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor="em-name" error={errors.name?.message} required>
              <Input id="em-name" autoFocus aria-invalid={!!errors.name} {...register('name')} />
            </Field>
            <Field label="Post / designation" htmlFor="em-title">
              <Input id="em-title" placeholder="e.g. Associate — GST" {...register('title')} />
            </Field>
            <Field label="Email" htmlFor="em-email" error={errors.email?.message} required>
              <Input id="em-email" type="email" aria-invalid={!!errors.email} {...register('email')} />
            </Field>
            <Field label="Mobile no." htmlFor="em-phone">
              <Input id="em-phone" type="tel" {...register('phone')} />
            </Field>
            <Field label="Address" htmlFor="em-addr" className="sm:col-span-2">
              <Textarea id="em-addr" className="min-h-[56px]" {...register('address')} />
            </Field>
            <Field label="Aadhaar no. (optional)" htmlFor="em-aadhaar" error={errors.aadhaar?.message} hint="Only the last 4 digits are kept.">
              <Input id="em-aadhaar" inputMode="numeric" maxLength={14} aria-invalid={!!errors.aadhaar} {...register('aadhaar')} />
            </Field>
            <Field label="PAN (optional)" htmlFor="em-pan" error={errors.pan?.message}>
              <Input id="em-pan" className="font-mono uppercase" maxLength={10} aria-invalid={!!errors.pan} {...register('pan')} />
            </Field>
            <Field label="Username" htmlFor="em-user" error={errors.username?.message} required>
              <Input id="em-user" autoComplete="off" aria-invalid={!!errors.username} {...register('username')} />
            </Field>
            {!BACKEND && (
              <Field label={user ? 'Reset password' : 'Temporary password'} htmlFor="em-pw" hint="Demo only — not stored. Real sign-in will use the identity provider.">
                <div className="relative">
                  <Input id="em-pw" type={showPw ? 'text' : 'password'} autoComplete="new-password" className="pr-8" {...register('password')} />
                  <button type="button" onClick={() => setShowPw((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-400" aria-label="Toggle password">
                    {showPw ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </button>
                </div>
              </Field>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Role" htmlFor="em-role" hint={ROLE_META[role].description}>
                <Select id="em-role" {...register('role')}>
                  {(['employee', 'manager', 'admin'] as const).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_META[r].label}
                    </option>
                  ))}
                </Select>
              </Field>
              {role === 'employee' && (
                <Field label="Reports to" htmlFor="em-mgr">
                  <Select id="em-mgr" {...register('managerId')}>
                    {managers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>
            <PermissionSwitches role={role} value={perms} onChange={setPerms} effective={effective} />
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary">
          {user ? 'Save changes' : 'Add employee'}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function PermissionSwitches({ role, value, onChange, effective }: { role: Role; value: Partial<Permissions>; onChange: (p: Partial<Permissions>) => void; effective: Permissions }) {
  if (role === 'admin')
    return (
      <p className="flex items-center gap-2 rounded-md bg-slate-50 p-3 text-xs text-ink-600">
        <Info className="size-3.5" /> Firm admins always have every permission.
      </p>
    );
  return (
    <div className="divide-y divide-line rounded-md border border-line">
      {(Object.keys(PERMISSION_META) as (keyof Permissions)[]).map((k) => {
        const on = effective[k];
        const overridden = value[k] !== undefined && value[k] !== ROLE_DEFAULTS[role][k];
        return (
          <label key={k} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-slate-50">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-[13px] font-medium text-ink-900">
                {PERMISSION_META[k].label}
                {overridden && <span className="rounded bg-brand-50 px-1 text-[10px] font-semibold text-brand-700">Custom</span>}
              </p>
              <p className="text-2xs text-ink-500">{PERMISSION_META[k].description}</p>
            </div>
            <Switch checked={on} onChange={(v) => onChange({ ...value, [k]: v })} label={PERMISSION_META[k].label} />
          </label>
        );
      })}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => (e.preventDefault(), onChange(!checked))}
      className={cn('relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:opacity-50', checked ? 'bg-brand-600' : 'bg-slate-300')}
    >
      <span className={cn('inline-block size-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-0.5')} />
    </button>
  );
}
