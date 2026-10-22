import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Checkbox } from '@/components/ui/checkbox';
import { Avatar } from '@/components/badges';
import { ENTITY_TYPES } from '@/types';
import { store, useDb } from '@/store/store';
import { useUI } from '@/store/ui';

const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const schema = z.object({
  name: z.string().trim().min(2, 'Enter the client’s name'),
  code: z
    .string()
    .trim()
    .min(2, 'Enter a short client code')
    .max(12, 'Max 12 characters')
    .regex(/^[A-Za-z0-9-]+$/, 'Letters, numbers and hyphens only'),
  entityType: z.enum(ENTITY_TYPES as [string, ...string[]]),
  industry: z.string().trim().max(60),
  contactName: z.string().trim().min(2, 'Enter a primary contact'),
  email: z.string().trim().email('Enter a valid email').or(z.literal('')),
  phone: z.string().trim().max(20),
  city: z.string().trim().max(40),
  pan: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => !v || PAN.test(v), 'PAN format looks wrong (e.g. ABCDE1234F)'),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => !v || GSTIN.test(v), 'GSTIN should be 15 characters (e.g. 27ABCDE1234F1Z5)'),
  relationshipManagerId: z.string().min(1, 'Choose a relationship manager'),
  teamIds: z.array(z.string()),
  status: z.enum(['active', 'onboarding', 'inactive']),
  notes: z.string().max(1000),
});
type Values = z.infer<typeof schema>;

export function ClientFormDialog() {
  const { clientForm, closeClientForm } = useUI();
  return (
    <Dialog open={!!clientForm} onOpenChange={(v) => !v && closeClientForm()}>
      {clientForm && (
        <DialogContent
          title={clientForm.clientId ? 'Edit client' : 'Add client'}
          description={clientForm.clientId ? undefined : 'Only the name, code and primary contact are required. Tax identifiers are optional.'}
          size="lg"
        >
          <ClientForm clientId={clientForm.clientId} onDone={closeClientForm} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function suggestCode(name: string, taken: string[]) {
  const letters = name.replace(/[^A-Za-z ]/g, '').trim().split(/\s+/).filter((w) => !/^(pvt|ltd|llp|the|and|of|dr|mr|ms)$/i.test(w));
  const base = (letters.length > 1 ? letters.map((w) => w[0]).join('') : (letters[0] ?? 'CL')).slice(0, 3).toUpperCase().padEnd(3, 'X');
  let n = taken.length + 1;
  let code = `${base}-${String(n).padStart(3, '0')}`;
  while (taken.includes(code)) code = `${base}-${String(++n).padStart(3, '0')}`;
  return code;
}

function ClientForm({ clientId, onDone }: { clientId?: string; onDone: () => void }) {
  const db = useDb();
  const navigate = useNavigate();
  const editing = clientId ? db.clients.find((c) => c.id === clientId) : undefined;
  const managers = db.users.filter((u) => u.status === 'active' && (u.role === 'manager' || u.role === 'admin'));
  const staff = db.users.filter((u) => u.status === 'active');
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    getValues,
    formState: { errors, dirtyFields },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: editing
      ? { ...editing, pan: editing.pan ?? '', gstin: editing.gstin ?? '', notes: editing.notes ?? '' }
      : {
          name: '',
          code: '',
          entityType: 'Private Limited',
          industry: '',
          contactName: '',
          email: '',
          phone: '',
          city: '',
          pan: '',
          gstin: '',
          relationshipManagerId: managers.find((m) => m.role === 'manager')?.id ?? '',
          teamIds: [],
          status: 'onboarding',
          notes: '',
        },
  });
  const teamIds = watch('teamIds');

  const onSubmit = (v: Values) => {
    const input = { ...v, entityType: v.entityType as (typeof ENTITY_TYPES)[number], pan: v.pan || undefined, gstin: v.gstin || undefined, notes: v.notes || undefined };
    if (editing) {
      if (store.updateClient(editing.id, input)) {
        toast.success('Client updated');
        onDone();
      }
    } else {
      const c = store.createClient(input);
      if (c) {
        toast.success(`${c.name} added`, { description: `Client code ${c.code}` });
        onDone();
        navigate(`/clients/${c.id}`);
      }
    }
  };

  return (
    <form noValidate onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
      <DialogBody className="space-y-5">
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Client</legend>
          <Field label="Client name" htmlFor="cl-name" error={errors.name?.message} required className="sm:col-span-2">
            <Input
              id="cl-name"
              autoFocus
              aria-invalid={!!errors.name}
              {...register('name', {
                onBlur: () => {
                  if (!editing && !dirtyFields.code && getValues('name')) setValue('code', suggestCode(getValues('name'), db.clients.map((c) => c.code)));
                },
              })}
            />
          </Field>
          <Field label="Client code" htmlFor="cl-code" error={errors.code?.message} required hint="Short internal reference, e.g. SUN-001">
            <Input id="cl-code" className="font-mono uppercase" aria-invalid={!!errors.code} {...register('code')} />
          </Field>
          <Field label="Entity type" htmlFor="cl-entity">
            <Select id="cl-entity" {...register('entityType')}>
              {ENTITY_TYPES.map((e) => (
                <option key={e}>{e}</option>
              ))}
            </Select>
          </Field>
          <Field label="Industry / nature of business" htmlFor="cl-industry">
            <Input id="cl-industry" {...register('industry')} />
          </Field>
          <Field label="Status" htmlFor="cl-status">
            <Select id="cl-status" {...register('status')}>
              <option value="onboarding">Onboarding</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </Field>
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Primary contact</legend>
          <Field label="Contact name" htmlFor="cl-contact" error={errors.contactName?.message} required>
            <Input id="cl-contact" aria-invalid={!!errors.contactName} {...register('contactName')} />
          </Field>
          <Field label="Email" htmlFor="cl-email" error={errors.email?.message}>
            <Input id="cl-email" type="email" aria-invalid={!!errors.email} {...register('email')} />
          </Field>
          <Field label="Phone" htmlFor="cl-phone">
            <Input id="cl-phone" type="tel" {...register('phone')} />
          </Field>
          <Field label="City" htmlFor="cl-city">
            <Input id="cl-city" {...register('city')} />
          </Field>
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Tax identifiers (optional)</legend>
          <Field label="PAN" htmlFor="cl-pan" error={errors.pan?.message} hint="Use fictional values in the demo.">
            <Input id="cl-pan" className="font-mono uppercase" maxLength={10} aria-invalid={!!errors.pan} {...register('pan')} />
          </Field>
          <Field label="GSTIN" htmlFor="cl-gstin" error={errors.gstin?.message}>
            <Input id="cl-gstin" className="font-mono uppercase" maxLength={15} aria-invalid={!!errors.gstin} {...register('gstin')} />
          </Field>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Engagement team</legend>
          <Field label="Relationship manager" htmlFor="cl-rm" error={errors.relationshipManagerId?.message} required>
            <Select id="cl-rm" aria-invalid={!!errors.relationshipManagerId} {...register('relationshipManagerId')}>
              <option value="">Select…</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} — {m.title}
                </option>
              ))}
            </Select>
          </Field>
          <div>
            <p className="mb-1.5 text-xs font-medium text-ink-700">Team members</p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {staff.map((u) => {
                const checked = teamIds.includes(u.id);
                return (
                  <label key={u.id} className="flex cursor-pointer items-center gap-2 rounded-md border border-line px-2.5 py-1.5 hover:bg-slate-50">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => setValue('teamIds', v ? [...teamIds, u.id] : teamIds.filter((id) => id !== u.id), { shouldDirty: true })}
                    />
                    <Avatar user={u} size="xs" />
                    <span className="truncate text-xs text-ink-800">{u.name}</span>
                  </label>
                );
              })}
            </div>
          </div>
          <Field label="Notes" htmlFor="cl-notes">
            <Textarea id="cl-notes" placeholder="Engagement scope, communication preferences…" {...register('notes')} />
          </Field>
        </fieldset>
      </DialogBody>
      <DialogFooter>
        <Button onClick={onDone}>Cancel</Button>
        <Button type="submit" variant="primary">
          {editing ? 'Save changes' : 'Add client'}
        </Button>
      </DialogFooter>
    </form>
  );
}
