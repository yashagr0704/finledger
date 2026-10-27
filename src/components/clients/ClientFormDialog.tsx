import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, BadgeCheck, CheckCircle2, Eye, EyeOff, Info, Loader2, Paperclip, Plus, ShieldCheck, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs } from '@/components/ui/misc';
import { Avatar } from '@/components/badges';
import { checkGstin, DEMO_GST_DIRECTORY, lookupGstin, type GstRecord } from '@/lib/gstin';
import { formatFileSize } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { ENTITY_TYPES, type TaxHead } from '@/types';
import { store, useCaps, useCurrentUser, useDb } from '@/store/store';
import { canManageMasters } from '@/lib/permissions';
import { PortalDialog } from '@/components/portals/PortalDialog';
import { useUI } from '@/store/ui';
import { api, BACKEND } from '@/api/client';
import { uploadFiles } from '@/lib/uploads';

/** Uploads queued KYC files (backend mode) and files them in the client's Drive → KYC folder. */
async function saveKyc(clientId: string, files: { file: File }[]) {
  const uploaded = await uploadFiles(files.map((f) => f.file), { clientId });
  if (uploaded.length) store.addDriveFiles(clientId, 'KYC', uploaded);
}

const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

const schema = z.object({
  taxesApplicable: z.array(z.enum(['GST', 'Income Tax', 'Other'])).min(1, 'Select at least one'),
  name: z.string().trim().min(2, 'Enter the client’s name'),
  code: z
    .string()
    .trim()
    .min(2, 'Enter a short client code')
    .max(12, 'Max 12 characters')
    .regex(/^[A-Za-z0-9-]+$/, 'Letters, numbers and hyphens only'),
  fileNo: z.string().trim().max(20),
  billingName: z.string().trim().max(120),
  tradeName: z.string().trim().max(120),
  incorporatedOn: z.string(),
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
    .refine((v) => !v || checkGstin(v).ok, 'GSTIN format looks wrong (e.g. 27ABCDE1234F1Z5)'),
  relationshipManagerId: z.string().min(1, 'Choose a relationship manager'),
  teamIds: z.array(z.string()),
  serviceIds: z.array(z.string()),
  referredById: z.string(),
  status: z.enum(['active', 'onboarding', 'inactive']),
  exitDate: z.string(),
  notes: z.string().max(1000),
  contacts: z.array(z.object({ name: z.string(), designation: z.string(), phone: z.string(), email: z.string() })),
  customFields: z.array(z.object({ label: z.string(), value: z.string() })),
  portalLogins: z.array(
    z
      .object({ id: z.string().optional(), portalId: z.string().min(1, 'Choose a portal'), username: z.string().trim().max(120), password: z.string().max(200), hasPassword: z.boolean().optional(), extra: z.string().trim().max(200) })
      .refine((l) => !l.password || l.username, { message: 'Enter the login ID for this password', path: ['username'] }),
  ),
});
type Values = z.infer<typeof schema>;
type Section = 'basic' | 'tax' | 'contacts' | 'groups' | 'custom' | 'logins' | 'attachments';

const SECTION_FIELDS: Record<Section, (keyof Values)[]> = {
  basic: ['name', 'code', 'fileNo', 'billingName', 'tradeName', 'entityType', 'status', 'industry', 'contactName', 'email', 'phone', 'city', 'relationshipManagerId'],
  tax: ['pan', 'gstin'],
  contacts: ['contacts'],
  groups: ['serviceIds', 'teamIds', 'referredById'],
  custom: ['customFields'],
  logins: ['portalLogins'],
  attachments: [],
};

export function ClientFormDialog() {
  const { clientForm, closeClientForm } = useUI();
  return (
    <Dialog open={!!clientForm} onOpenChange={(v) => !v && closeClientForm()}>
      {clientForm && (
        <DialogContent title={clientForm.clientId ? 'Edit client' : 'Add client'} description={clientForm.clientId ? undefined : 'Only the name, code and primary contact are required. Tax identifiers are optional.'} size="lg" className="max-w-4xl">
          <ClientForm clientId={clientForm.clientId} initialSection={clientForm.section} onDone={closeClientForm} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function suggestCode(name: string, taken: string[]) {
  const letters = name
    .replace(/[^A-Za-z ]/g, '')
    .trim()
    .split(/\s+/)
    .filter((w) => !/^(pvt|ltd|llp|the|and|of|dr|mr|ms|private|limited)$/i.test(w));
  const base = (letters.length > 1 ? letters.map((w) => w[0]).join('') : (letters[0] ?? 'CL')).slice(0, 3).toUpperCase().padEnd(3, 'X');
  let n = taken.length + 1;
  let code = `${base}-${String(n).padStart(3, '0')}`;
  while (taken.includes(code)) code = `${base}-${String(++n).padStart(3, '0')}`;
  return code;
}

function ClientForm({ clientId, initialSection, onDone }: { clientId?: string; initialSection?: Section; onDone: () => void }) {
  const db = useDb();
  const me = useCurrentUser();
  const navigate = useNavigate();
  const [addingPortal, setAddingPortal] = useState(false);
  const editing = clientId ? db.clients.find((c) => c.id === clientId) : undefined;
  const managers = db.users.filter((u) => u.status === 'active' && (u.role === 'manager' || u.role === 'admin'));
  const staff = db.users.filter((u) => u.status === 'active');
  const [section, setSection] = useState<Section>(initialSection ?? 'basic');
  const [gstOpen, setGstOpen] = useState(false);
  const [queued, setQueued] = useState<{ name: string; sizeKb: number; file: File }[]>([]);
  const [showPw, setShowPw] = useState<Set<number>>(new Set());

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    getValues,
    control,
    formState: { errors, dirtyFields },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: editing
      ? {
          ...editing,
          taxesApplicable: editing.taxesApplicable ?? ['Income Tax'],
          fileNo: editing.fileNo ?? '',
          billingName: editing.billingName ?? '',
          tradeName: editing.tradeName ?? '',
          incorporatedOn: editing.incorporatedOn ?? '',
          pan: editing.pan ?? '',
          gstin: editing.gstin ?? '',
          notes: editing.notes ?? '',
          referredById: editing.referredById ?? '',
          exitDate: editing.exitDate ?? '',
          serviceIds: editing.serviceIds ?? [],
          contacts: editing.contacts ?? [],
          customFields: editing.customFields ?? [],
          portalLogins: (editing.portalLogins ?? []).map((l) => ({ ...l, hasPassword: l.hasPassword || !!l.password, password: '', extra: l.extra ?? '' })),
        }
      : {
          taxesApplicable: ['Income Tax'],
          name: '',
          code: '',
          fileNo: `F-${String(101 + db.clients.length).padStart(3, '0')}`,
          billingName: '',
          tradeName: '',
          incorporatedOn: '',
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
          serviceIds: [],
          referredById: '',
          status: 'onboarding',
          exitDate: '',
          notes: '',
          contacts: [],
          customFields: [{ label: 'Financial year end', value: '31 March' }],
          portalLogins: [],
        },
  });
  const contacts = useFieldArray({ control, name: 'contacts' });
  const customFields = useFieldArray({ control, name: 'customFields' });
  const logins = useFieldArray({ control, name: 'portalLogins' });
  const taxes = watch('taxesApplicable');
  const teamIds = watch('teamIds');
  const serviceIds = watch('serviceIds');
  const entityType = watch('entityType');
  const status = watch('status');

  const errorSections = (Object.keys(SECTION_FIELDS) as Section[]).filter((s) => SECTION_FIELDS[s].some((f) => errors[f]));

  const applyGst = (rec: GstRecord | null, gstin: string, pan: string) => {
    setValue('gstin', gstin, { shouldDirty: true, shouldValidate: true });
    setValue('pan', pan, { shouldDirty: true });
    if (!taxes.includes('GST')) setValue('taxesApplicable', [...taxes, 'GST']);
    if (rec) {
      setValue('name', rec.legalName, { shouldValidate: true });
      setValue('billingName', rec.legalName);
      setValue('tradeName', rec.tradeName);
      setValue('entityType', rec.entityType);
      setValue('city', rec.city);
      setValue('incorporatedOn', rec.registeredOn);
      setValue('industry', rec.natureOfBusiness);
      if (!dirtyFields.code) setValue('code', suggestCode(rec.legalName, db.clients.map((c) => c.code)));
      const custom = getValues('customFields').filter((f) => !['Registered address', 'GST taxpayer type', 'GST registration date'].includes(f.label));
      setValue('customFields', [...custom, { label: 'Registered address', value: `${rec.address}, ${rec.city}` }, { label: 'GST taxpayer type', value: rec.taxpayerType }, { label: 'GST registration date', value: rec.registeredOn }]);
    }
  };

  const onSubmit = (v: Values) => {
    const input = {
      ...v,
      entityType: v.entityType as (typeof ENTITY_TYPES)[number],
      taxesApplicable: v.taxesApplicable as TaxHead[],
      pan: v.pan || undefined,
      gstin: v.gstin || undefined,
      notes: v.notes || undefined,
      billingName: v.billingName || undefined,
      tradeName: v.tradeName || undefined,
      fileNo: v.fileNo || undefined,
      incorporatedOn: v.incorporatedOn || undefined,
      referredById: v.referredById || undefined,
      exitDate: v.status === 'inactive' && v.exitDate ? v.exitDate : undefined,
      contacts: v.contacts.filter((c) => c.name.trim()),
      customFields: v.customFields.filter((c) => c.label.trim()),
      portalLogins: v.portalLogins.filter((l) => l.username.trim()).map((l) => ({ ...l, extra: l.extra || undefined })),
    };
    if (editing) {
      if (store.updateClient(editing.id, input)) {
        if (queued.length) void saveKyc(editing.id, queued);
        toast.success('Client updated', { description: input.exitDate ? 'Client marked as exited — messaging is switched off.' : undefined });
        onDone();
      }
    } else {
      const c = store.createClient(input);
      if (c) {
        if (queued.length) void saveKyc(c.id, queued);
        toast.success(`${c.name} added`, { description: `Client code ${c.code}` });
        onDone();
        navigate(`/clients/${c.id}`);
      }
    }
  };

  return (
    <form
      noValidate
      onSubmit={handleSubmit(onSubmit, (errs) => {
        const first = (Object.keys(SECTION_FIELDS) as Section[]).find((s) => SECTION_FIELDS[s].some((f) => errs[f]));
        if (first) setSection(first);
        toast.error('Please fix the highlighted fields');
      })}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="shrink-0 border-b border-line px-5 pt-3">
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-xs font-medium text-ink-700">
            Taxes applicable <span className="text-red-500">*</span>
          </span>
          {(['GST', 'Income Tax', 'Other'] as const).map((t) => (
            <label key={t} className="flex items-center gap-1.5 text-[13px] text-ink-800">
              <Checkbox checked={taxes.includes(t)} onCheckedChange={(v) => setValue('taxesApplicable', v ? [...taxes, t] : taxes.filter((x) => x !== t), { shouldValidate: true })} />
              {t}
            </label>
          ))}
          {errors.taxesApplicable && <span className="text-xs text-red-600">{errors.taxesApplicable.message}</span>}
          {taxes.includes('GST') && (
            <Button size="sm" className="ml-auto" onClick={() => setGstOpen(true)}>
              <ShieldCheck /> Validate GSTIN & auto-fill
            </Button>
          )}
        </div>
        <Tabs
          className="border-b-0"
          value={section}
          onChange={setSection}
          tabs={[
            { value: 'basic', label: 'Basic Details' },
            { value: 'tax', label: 'Tax Details' },
            { value: 'contacts', label: 'Contact Persons', count: contacts.fields.length || undefined },
            { value: 'groups', label: 'Client Groups' },
            { value: 'custom', label: 'Custom Fields' },
            { value: 'logins', label: 'Login Details', count: logins.fields.length || undefined },
            { value: 'attachments', label: 'Attachments', count: queued.length || undefined },
          ]}
        />
      </div>
      {errorSections.length > 0 && (
        <p className="flex shrink-0 items-center gap-1.5 bg-red-50 px-5 py-1.5 text-xs text-red-700">
          <AlertTriangle className="size-3.5" /> Check: {errorSections.map((s) => ({ basic: 'Basic Details', tax: 'Tax Details', contacts: 'Contact Persons', groups: 'Client Groups', custom: 'Custom Fields', logins: 'Login Details', attachments: '' })[s]).join(', ')}
        </p>
      )}

      <DialogBody className="min-h-0 sm:min-h-[min(380px,40vh)]">
        {section === 'basic' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="File no." htmlFor="cl-file">
              <Input id="cl-file" {...register('fileNo')} />
            </Field>
            <Field label="Type of client" htmlFor="cl-entity" required>
              <Select id="cl-entity" {...register('entityType')}>
                {ENTITY_TYPES.map((e) => (
                  <option key={e}>{e}</option>
                ))}
              </Select>
            </Field>
            <Field label="Name" htmlFor="cl-name" error={errors.name?.message} required className="sm:col-span-2">
              <Input
                id="cl-name"
                autoFocus
                aria-invalid={!!errors.name}
                {...register('name', {
                  onBlur: () => {
                    if (!editing && !dirtyFields.code && getValues('name')) setValue('code', suggestCode(getValues('name'), db.clients.map((c) => c.code)));
                    if (!getValues('billingName')) setValue('billingName', getValues('name'));
                  },
                })}
              />
            </Field>
            <Field label="Trade name" htmlFor="cl-trade">
              <Input id="cl-trade" {...register('tradeName')} />
            </Field>
            <Field label="Billing name" htmlFor="cl-billing" hint="Name printed on invoices">
              <Input id="cl-billing" {...register('billingName')} />
            </Field>
            <Field label="Client code" htmlFor="cl-code" error={errors.code?.message} required>
              <Input id="cl-code" className="font-mono uppercase" aria-invalid={!!errors.code} {...register('code')} />
            </Field>
            <Field label={entityType === 'Individual' ? 'Date of birth' : 'Date of incorporation'} htmlFor="cl-dob">
              <Input id="cl-dob" type="date" {...register('incorporatedOn')} />
            </Field>
            <Field label="Industry / nature of business" htmlFor="cl-industry">
              <Input id="cl-industry" {...register('industry')} />
            </Field>
            <Field label="City" htmlFor="cl-city">
              <Input id="cl-city" {...register('city')} />
            </Field>
            <Field label="Primary contact" htmlFor="cl-contact" error={errors.contactName?.message} required>
              <Input id="cl-contact" aria-invalid={!!errors.contactName} {...register('contactName')} />
            </Field>
            <Field label="Email" htmlFor="cl-email" error={errors.email?.message}>
              <Input id="cl-email" type="email" aria-invalid={!!errors.email} {...register('email')} />
            </Field>
            <Field label="Mobile (WhatsApp)" htmlFor="cl-phone">
              <Input id="cl-phone" type="tel" {...register('phone')} />
            </Field>
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
            <Field label="Status" htmlFor="cl-status">
              <Select id="cl-status" {...register('status')}>
                <option value="onboarding">Onboarding</option>
                <option value="active">Active</option>
                <option value="inactive">Left the firm</option>
              </Select>
            </Field>
            {status === 'inactive' ? (
              <Field label="Exit date" htmlFor="cl-exit" hint="From this date the client gets no updates, messages or notifications.">
                <Input id="cl-exit" type="date" {...register('exitDate')} />
              </Field>
            ) : (
              <div className="hidden sm:block" />
            )}
            <Field label="Notes" htmlFor="cl-notes" className="sm:col-span-2">
              <Textarea id="cl-notes" placeholder="Engagement scope, communication preferences…" {...register('notes')} />
            </Field>
          </div>
        )}

        {section === 'tax' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="PAN" htmlFor="cl-pan" error={errors.pan?.message} hint="Optional. Use fictional values in the demo.">
              <Input id="cl-pan" className="font-mono uppercase" maxLength={10} aria-invalid={!!errors.pan} {...register('pan')} />
            </Field>
            <Field label="GSTIN" htmlFor="cl-gstin" error={errors.gstin?.message} hint={taxes.includes('GST') ? 'Use “Validate GSTIN” above to fill details automatically.' : 'Tick GST under Taxes applicable to enable.'}>
              <Input id="cl-gstin" className="font-mono uppercase" maxLength={15} aria-invalid={!!errors.gstin} disabled={!taxes.includes('GST')} {...register('gstin')} />
            </Field>
            <div className="rounded-md bg-slate-50 p-3 text-xs leading-relaxed text-ink-600 sm:col-span-2">
              <p className="mb-1 flex items-center gap-1.5 font-medium text-ink-800">
                <Info className="size-3.5" /> Income tax details
              </p>
              Assessing officer, ward and e-filing login can be added under Custom Fields and Login Details. Aadhaar is not collected for clients.
            </div>
          </div>
        )}

        {section === 'contacts' && (
          <div className="space-y-2">
            {contacts.fields.map((f, i) => (
              <div key={f.id} className="grid gap-2 rounded-md border border-line p-2.5 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]">
                <Input placeholder="Name" aria-label="Contact name" {...register(`contacts.${i}.name` as const)} />
                <Input placeholder="Designation" aria-label="Designation" {...register(`contacts.${i}.designation` as const)} />
                <Input placeholder="Mobile" aria-label="Mobile" {...register(`contacts.${i}.phone` as const)} />
                <Input placeholder="Email" aria-label="Email" {...register(`contacts.${i}.email` as const)} />
                <Button size="icon" variant="ghost" onClick={() => contacts.remove(i)} aria-label="Remove contact">
                  <Trash2 />
                </Button>
              </div>
            ))}
            {!contacts.fields.length && <p className="text-[13px] text-ink-400">No additional contacts. The primary contact is on Basic Details.</p>}
            <Button size="sm" onClick={() => contacts.append({ name: '', designation: '', phone: '', email: '' })}>
              <Plus /> Add contact person
            </Button>
          </div>
        )}

        {section === 'groups' && (
          <div className="space-y-5">
            <div>
              <p className="mb-2 text-xs font-medium text-ink-700">Services for this client</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {db.categories.map((g) => {
                  const svcs = db.services.filter((s) => s.groupId === g.id);
                  if (!svcs.length) return null;
                  return (
                    <div key={g.id} className="rounded-md border border-line p-2.5">
                      <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-ink-400">{g.name}</p>
                      {svcs.map((s) => (
                        <label key={s.id} className="flex cursor-pointer items-center gap-2 py-0.5 text-xs text-ink-800">
                          <Checkbox checked={serviceIds.includes(s.id)} onCheckedChange={(v) => setValue('serviceIds', v ? [...serviceIds, s.id] : serviceIds.filter((x) => x !== s.id), { shouldDirty: true })} />
                          {s.name}
                          <span className="ml-auto text-2xs text-ink-400">{s.frequency}</span>
                        </label>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
            <Field label="Referred by" htmlFor="cl-ref">
              <Select id="cl-ref" {...register('referredById')}>
                <option value="">—</option>
                {db.referrers.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} {r.firmName !== r.name && `· ${r.firmName}`}
                  </option>
                ))}
              </Select>
            </Field>
            <div>
              <p className="mb-1.5 text-xs font-medium text-ink-700">Engagement team</p>
              <div className="grid gap-1.5 sm:grid-cols-3">
                {staff.map((u) => (
                  <label key={u.id} className="flex cursor-pointer items-center gap-2 rounded-md border border-line px-2.5 py-1.5 hover:bg-slate-50">
                    <Checkbox checked={teamIds.includes(u.id)} onCheckedChange={(v) => setValue('teamIds', v ? [...teamIds, u.id] : teamIds.filter((id) => id !== u.id), { shouldDirty: true })} />
                    <Avatar user={u} size="xs" />
                    <span className="truncate text-xs text-ink-800">{u.name}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        {section === 'custom' && (
          <div className="space-y-2">
            {customFields.fields.map((f, i) => (
              <div key={f.id} className="flex gap-2">
                <Input placeholder="Field name" aria-label="Field name" className="w-2/5 min-w-0 shrink-0 sm:w-56" {...register(`customFields.${i}.label` as const)} />
                <Input placeholder="Value" aria-label="Value" className="min-w-0 flex-1" {...register(`customFields.${i}.value` as const)} />
                <Button size="icon" variant="ghost" onClick={() => customFields.remove(i)} aria-label="Remove field">
                  <X />
                </Button>
              </div>
            ))}
            <Button size="sm" onClick={() => customFields.append({ label: '', value: '' })}>
              <Plus /> Add field
            </Button>
          </div>
        )}

        {section === 'logins' && (
          <div className="space-y-2">
            {logins.fields.length > 0 && (
              <div className="hidden gap-2 text-2xs font-medium uppercase tracking-wide text-ink-400 sm:grid sm:grid-cols-[180px_1fr_1fr_1fr_auto]">
                <span>Portal</span>
                <span>Login ID / username</span>
                <span>Password</span>
                <span>Other details (not secret)</span>
                <span className="w-8" />
              </div>
            )}
            {logins.fields.map((f, i) => {
              const err = errors.portalLogins?.[i];
              const saved = getValues(`portalLogins.${i}.hasPassword`);
              return (
                <div key={f.id} className="grid gap-2 rounded-md border border-line p-2 sm:grid-cols-[180px_1fr_1fr_1fr_auto] sm:border-0 sm:p-0">
                  <Select aria-label="Portal" aria-invalid={!!err?.portalId} {...register(`portalLogins.${i}.portalId` as const)}>
                    {db.portals.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                  <div>
                    <Input placeholder="Login ID / username" aria-label="Login ID" aria-invalid={!!err?.username} autoComplete="off" {...register(`portalLogins.${i}.username` as const)} />
                    {err?.username && <p className="mt-0.5 text-2xs text-red-600">{err.username.message}</p>}
                  </div>
                  <div className="relative">
                    <Input
                      type={showPw.has(i) ? 'text' : 'password'}
                      placeholder={saved ? 'Saved — leave blank to keep' : 'Password'}
                      aria-label="Password"
                      autoComplete="new-password"
                      className="pr-8"
                      {...register(`portalLogins.${i}.password` as const)}
                    />
                    <button type="button" onClick={() => setShowPw((s) => (s.has(i) ? (s.delete(i), new Set(s)) : new Set(s).add(i)))} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-400" aria-label="Toggle password">
                      {showPw.has(i) ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    </button>
                  </div>
                  <Input placeholder="e.g. TAN, OTP mobile" aria-label="Other details" {...register(`portalLogins.${i}.extra` as const)} />
                  <Button size="icon" variant="ghost" onClick={() => logins.remove(i)} aria-label="Remove login">
                    <Trash2 />
                  </Button>
                </div>
              );
            })}
            {!db.portals.length && <p className="text-[13px] text-ink-400">No portals are set up yet.</p>}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={!db.portals.length} onClick={() => logins.append({ portalId: db.portals[0]?.id ?? '', username: '', password: '', extra: '' })}>
                <Plus /> Add login
              </Button>
              {canManageMasters(me) && (
                <Button size="sm" variant="ghost" onClick={() => setAddingPortal(true)}>
                  <Plus /> New portal
                </Button>
              )}
            </div>
            <p className="pt-1 text-2xs text-ink-400">
              {BACKEND ? 'Passwords are encrypted on the server and never shown here. Leave a saved password blank to keep it.' : 'Demo: passwords stay in this browser tab only and are not saved to browser storage.'} Don’t put passwords in “Other details”.
            </p>
            <PortalDialog open={addingPortal} onClose={() => setAddingPortal(false)} onSaved={(portalId) => logins.append({ portalId, username: '', password: '', extra: '' })} />
          </div>
        )}

        {section === 'attachments' && (
          <div>
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-line bg-slate-50/60 px-4 py-8 text-center hover:border-brand-300">
              <Paperclip className="mb-2 size-5 text-ink-400" />
              <span className="text-[13px] font-medium text-ink-800">Click to choose KYC documents</span>
              <span className="text-xs text-ink-500">PAN card, incorporation certificate, GST certificate, partnership deed…</span>
              <input
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  setQueued((q) => [...q, ...Array.from(e.target.files ?? []).map((f) => ({ name: f.name, sizeKb: f.size / 1024, file: f }))]);
                  e.target.value = '';
                }}
              />
            </label>
            {queued.length > 0 && (
              <ul className="mt-3 divide-y divide-line rounded-md border border-line">
                {queued.map((f, i) => (
                  <li key={i} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                    <Paperclip className="size-3.5 text-ink-400" />
                    <span className="flex-1 truncate">{f.name}</span>
                    <span className="text-ink-400">{formatFileSize(Math.round(f.sizeKb))}</span>
                    <button type="button" onClick={() => setQueued((q) => q.filter((_, k) => k !== i))} className="text-ink-400 hover:text-red-600" aria-label="Remove">
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-2xs text-ink-400">Saved to the client’s Drive → KYC folder. {BACKEND ? 'Files are uploaded when you save.' : 'The demo keeps file names only.'}</p>
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        <Button onClick={onDone}>Cancel</Button>
        <Button type="submit" variant="primary">
          {editing ? 'Save changes' : 'Save client'}
        </Button>
      </DialogFooter>
      <GstinDialog open={gstOpen} initial={getValues('gstin')} onClose={() => setGstOpen(false)} onApply={(rec, g, pan) => (applyGst(rec, g, pan), setGstOpen(false), setSection('basic'))} />
    </form>
  );
}

function GstinDialog({ open, initial, onClose, onApply }: { open: boolean; initial: string; onClose: () => void; onApply: (rec: GstRecord | null, gstin: string, pan: string) => void }) {
  const caps = useCaps();
  const [value, setValue] = useState(initial);
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ rec: GstRecord | null; pan: string; stateName: string; checksumOk: boolean } | null>(null);
  const validate = () => {
    const chk = checkGstin(value);
    setResult(null);
    if (!chk.ok) return setError(chk.error);
    setError('');
    setState('loading');
    if (BACKEND) {
      api.gstin(value).then(
        (r) => (setResult({ rec: (r.record as GstRecord | null) ?? null, pan: r.pan, stateName: r.state, checksumOk: r.checksumOk }), setState('done')),
        (e: Error) => (setError(e.message), setState('idle')),
      );
      return;
    }
    setTimeout(() => {
      setResult({ rec: lookupGstin(value) ?? null, pan: chk.pan, stateName: chk.state, checksumOk: chk.checksumOk });
      setState('done');
    }, 900);
  };
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      {open && (
        <DialogContent title="Validate GSTIN" description="Checks the number and fills client details automatically." size="sm">
          <DialogBody className="space-y-3">
            <Field label="GSTIN" htmlFor="gst-v" required error={error}>
              <Input
                id="gst-v"
                autoFocus
                value={value}
                onChange={(e) => (setValue(e.target.value.toUpperCase()), setState('idle'), setResult(null))}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), validate())}
                maxLength={15}
                className="font-mono uppercase tracking-wide"
                aria-invalid={!!error}
              />
            </Field>
            {caps.gstLookup === 'demo' && (
              <div className="flex flex-wrap items-center gap-1.5 text-2xs text-ink-500">
                Try a demo GSTIN:
                {DEMO_GST_DIRECTORY.map((r) => (
                  <button key={r.gstin} type="button" onClick={() => (setValue(r.gstin), setResult(null), setError(''))} className="rounded border border-line bg-white px-1.5 py-0.5 font-mono text-ink-700 hover:border-brand-300">
                    {r.gstin}
                  </button>
                ))}
              </div>
            )}
            {state === 'loading' && (
              <p className="flex items-center gap-2 text-xs text-ink-500">
                <Loader2 className="size-3.5 animate-spin" /> Looking up taxpayer details…
              </p>
            )}
            {result && (
              <div className={cn('rounded-md border p-3 text-xs', result.rec ? 'border-emerald-200 bg-emerald-50/60' : 'border-amber-200 bg-amber-50/60')}>
                {result.rec ? (
                  <>
                    <p className="mb-1.5 flex items-center gap-1.5 font-semibold text-emerald-800">
                      <BadgeCheck className="size-4" /> {result.rec.status} · {result.rec.taxpayerType} taxpayer
                    </p>
                    <dl className="grid grid-cols-[110px_1fr] gap-y-0.5 text-ink-700">
                      <dt className="text-ink-500">Legal name</dt>
                      <dd className="font-medium">{result.rec.legalName}</dd>
                      <dt className="text-ink-500">Trade name</dt>
                      <dd>{result.rec.tradeName}</dd>
                      <dt className="text-ink-500">Constitution</dt>
                      <dd>{result.rec.entityType}</dd>
                      <dt className="text-ink-500">PAN</dt>
                      <dd className="font-mono">{result.pan}</dd>
                      <dt className="text-ink-500">State</dt>
                      <dd>{result.stateName}</dd>
                      <dt className="text-ink-500">Registered</dt>
                      <dd>{result.rec.registeredOn}</dd>
                      <dt className="text-ink-500">Address</dt>
                      <dd>
                        {result.rec.address}, {result.rec.city}
                      </dd>
                    </dl>
                  </>
                ) : (
                  <>
                    <p className="mb-1 flex items-center gap-1.5 font-semibold text-amber-800">
                      <CheckCircle2 className="size-4" /> Format valid · {result.stateName} · PAN {result.pan}
                    </p>
                    {!result.checksumOk && <p className="mb-1 text-amber-800">The last character (check digit) doesn’t match — please double-check the number.</p>}
                    <p className="text-ink-600">Name and address aren’t in the demo directory. Live lookup will need a GST API provider; we can still fill PAN and state.</p>
                  </>
                )}
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <Button onClick={onClose}>Cancel</Button>
            {result ? (
              <Button variant="primary" onClick={() => onApply(result.rec, value.trim(), result.pan)}>
                Use these details
              </Button>
            ) : (
              <Button variant="primary" onClick={validate} disabled={state === 'loading' || !value.trim()}>
                Validate
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
