import { useMemo } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CalendarClock, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Checkbox } from '@/components/ui/checkbox';
import { FREQUENCY_META, PRIORITY_META, PRIORITY_ORDER } from '@/lib/constants';
import { formatDate } from '@/lib/dates';
import { upcomingPeriods } from '@/lib/periods';
import { reviewerCandidates } from '@/lib/permissions';
import { store, useDb } from '@/store/store';
import { ENTITY_TYPES, type Frequency, type TaskTemplate } from '@/types';

const schema = z
  .object({
    name: z.string().trim().min(3, 'Enter a template name'),
    categoryId: z.string().min(1, 'Choose a category'),
    description: z.string().max(1000),
    checklist: z.array(z.object({ label: z.string() })),
    assignmentRule: z.enum(['fixed', 'relationship_manager', 'unassigned']),
    defaultAssigneeId: z.string().optional(),
    requiresReview: z.boolean(),
    reviewerId: z.string().optional(),
    frequency: z.enum(['monthly', 'quarterly', 'half_yearly', 'annual', 'custom']),
    intervalMonths: z.coerce.number().int().min(1).max(24).optional(),
    dueDay: z.coerce.number().int().min(1, '1–31').max(31, '1–31'),
    dueMonthOffset: z.coerce.number().int().min(0, '0–12').max(12, '0–12'),
    entityTypes: z.array(z.string()).min(1, 'Select at least one client type'),
    priority: z.enum(['low', 'medium', 'high', 'urgent']),
    estimateHours: z.coerce.number().min(0.5).max(500),
    active: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.assignmentRule === 'fixed' && !v.defaultAssigneeId) ctx.addIssue({ code: 'custom', path: ['defaultAssigneeId'], message: 'Choose a default assignee' });
    if (v.requiresReview && !v.reviewerId) ctx.addIssue({ code: 'custom', path: ['reviewerId'], message: 'Choose a reviewer' });
  });
type Values = z.infer<typeof schema>;

export function TemplateDialog({ open, template, onClose }: { open: boolean; template?: TaskTemplate; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      {open && (
        <DialogContent title={template ? 'Edit recurring template' : 'New recurring template'} description="Defines a repeatable task and its schedule." size="lg">
          <TemplateForm template={template} onClose={onClose} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function TemplateForm({ template, onClose }: { template?: TaskTemplate; onClose: () => void }) {
  const db = useDb();
  const staff = db.users.filter((u) => u.status === 'active');
  const reviewers = reviewerCandidates(db);
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    control,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: template
      ? { ...template, checklist: template.checklist.map((label) => ({ label })), defaultAssigneeId: template.defaultAssigneeId ?? '', reviewerId: template.reviewerId ?? '', intervalMonths: template.intervalMonths ?? 2 }
      : {
          name: '',
          categoryId: db.categories[0]?.id ?? '',
          description: '',
          checklist: [{ label: '' }],
          assignmentRule: 'fixed',
          defaultAssigneeId: '',
          requiresReview: true,
          reviewerId: '',
          frequency: 'monthly',
          intervalMonths: 2,
          dueDay: 15,
          dueMonthOffset: 1,
          entityTypes: ['Private Limited'],
          priority: 'medium',
          estimateHours: 4,
          active: true,
        },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'checklist' });
  const v = watch();

  const preview = useMemo(() => {
    const dueDay = Number(v.dueDay);
    const offset = Number(v.dueMonthOffset);
    if (!(dueDay >= 1 && dueDay <= 31 && offset >= 0 && offset <= 12)) return [];
    return upcomingPeriods({ frequency: v.frequency, intervalMonths: Number(v.intervalMonths) || 1, dueDay, dueMonthOffset: offset }, new Date(), 4);
  }, [v.frequency, v.intervalMonths, v.dueDay, v.dueMonthOffset]);
  const clientsMatching = db.clients.filter((c) => c.status !== 'inactive' && v.entityTypes.includes(c.entityType)).length;

  const onSubmit = (val: Values) => {
    const saved = store.saveTemplate(
      {
        ...val,
        frequency: val.frequency as Frequency,
        entityTypes: val.entityTypes as TaskTemplate['entityTypes'],
        checklist: val.checklist.map((c) => c.label.trim()).filter(Boolean),
        defaultAssigneeId: val.assignmentRule === 'fixed' ? val.defaultAssigneeId : undefined,
        reviewerId: val.requiresReview ? val.reviewerId : undefined,
        intervalMonths: val.frequency === 'custom' ? val.intervalMonths : undefined,
      },
      template?.id,
    );
    if (saved) {
      toast.success(template ? 'Template updated' : 'Template created');
      onClose();
    }
  };

  return (
    <form noValidate onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
      <DialogBody className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Template name" htmlFor="tp-name" error={errors.name?.message} required className="sm:col-span-2">
            <Input id="tp-name" autoFocus placeholder="e.g. GSTR-3B monthly return" aria-invalid={!!errors.name} {...register('name')} />
          </Field>
          <Field label="Category" htmlFor="tp-cat" error={errors.categoryId?.message} required>
            <Select id="tp-cat" {...register('categoryId')}>
              {db.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Default priority" htmlFor="tp-pri">
            <Select id="tp-pri" {...register('priority')}>
              {PRIORITY_ORDER.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_META[p].label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Default description" htmlFor="tp-desc" className="sm:col-span-2">
            <Textarea id="tp-desc" {...register('description')} />
          </Field>
        </div>

        <div className="rounded-lg border border-line p-3">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-500">Schedule</p>
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Frequency" htmlFor="tp-freq">
              <Select id="tp-freq" {...register('frequency')}>
                {(Object.keys(FREQUENCY_META) as Frequency[]).map((f) => (
                  <option key={f} value={f}>
                    {FREQUENCY_META[f]}
                  </option>
                ))}
              </Select>
            </Field>
            {v.frequency === 'custom' && (
              <Field label="Every N months" htmlFor="tp-int" error={errors.intervalMonths?.message}>
                <Input id="tp-int" type="number" min={1} max={24} {...register('intervalMonths')} />
              </Field>
            )}
            <Field label="Due on day" htmlFor="tp-day" error={errors.dueDay?.message}>
              <Input id="tp-day" type="number" min={1} max={31} aria-invalid={!!errors.dueDay} {...register('dueDay')} />
            </Field>
            <Field label="Months after period end" htmlFor="tp-off" error={errors.dueMonthOffset?.message}>
              <Input id="tp-off" type="number" min={0} max={12} aria-invalid={!!errors.dueMonthOffset} {...register('dueMonthOffset')} />
            </Field>
          </div>
          <div className="mt-3 rounded-md bg-slate-50 p-2.5">
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-ink-700">
              <CalendarClock className="size-3.5" /> Next occurrences (preview)
            </p>
            {preview.length ? (
              <ul className="grid gap-1 sm:grid-cols-2">
                {preview.map((p) => (
                  <li key={p.label} className="flex justify-between rounded bg-white px-2 py-1 text-xs ring-1 ring-line">
                    <span className="text-ink-700">{p.label}</span>
                    <span className="tabular-nums text-ink-500">due {formatDate(p.dueDate, 'd MMM yyyy')}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-ink-400">Enter a valid due-date rule to preview.</p>
            )}
            <p className="mt-1.5 text-2xs text-ink-400">Quarterly, half-yearly and annual periods follow the April–March financial year. Verify due-date rules against current notifications.</p>
          </div>
        </div>

        <div className="rounded-lg border border-line p-3">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-500">Assignment</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Assignment rule" htmlFor="tp-rule">
              <Select id="tp-rule" {...register('assignmentRule')}>
                <option value="fixed">Always assign to a specific person</option>
                <option value="relationship_manager">Client’s relationship manager</option>
                <option value="unassigned">Assign to whoever generates it</option>
              </Select>
            </Field>
            {v.assignmentRule === 'fixed' && (
              <Field label="Default assignee" htmlFor="tp-asg" error={errors.defaultAssigneeId?.message} required>
                <Select id="tp-asg" aria-invalid={!!errors.defaultAssigneeId} {...register('defaultAssigneeId')}>
                  <option value="">Select…</option>
                  {staff.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <label className="flex items-center gap-2 text-[13px] text-ink-800 sm:pt-5">
              <Checkbox checked={v.requiresReview} onCheckedChange={(c) => setValue('requiresReview', c === true, { shouldValidate: true })} />
              Requires review
            </label>
            {v.requiresReview && (
              <Field label="Reviewer" htmlFor="tp-rev" error={errors.reviewerId?.message} required>
                <Select id="tp-rev" aria-invalid={!!errors.reviewerId} {...register('reviewerId')}>
                  <option value="">Select…</option>
                  {reviewers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Estimated effort (hours)" htmlFor="tp-est">
              <Input id="tp-est" type="number" step="0.5" {...register('estimateHours')} />
            </Field>
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium text-ink-700">
            Applicable client types <span className="text-red-500">*</span>
            <span className="ml-2 font-normal text-ink-500">· matches {clientsMatching} current clients</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {ENTITY_TYPES.map((e) => {
              const on = v.entityTypes.includes(e);
              return (
                <button
                  type="button"
                  key={e}
                  aria-pressed={on}
                  onClick={() => setValue('entityTypes', on ? v.entityTypes.filter((x) => x !== e) : [...v.entityTypes, e], { shouldValidate: true })}
                  className={on ? 'h-7 rounded-full border border-brand-300 bg-brand-50 px-3 text-xs font-medium text-brand-800' : 'h-7 rounded-full border border-line bg-white px-3 text-xs text-ink-600 hover:border-slate-300'}
                >
                  {e}
                </button>
              );
            })}
          </div>
          {errors.entityTypes && <p className="mt-1 text-xs text-red-600">{errors.entityTypes.message}</p>}
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-medium text-ink-700">Default checklist</span>
            <Button size="sm" variant="ghost" onClick={() => append({ label: '' })}>
              <Plus /> Add item
            </Button>
          </div>
          <div className="space-y-1.5">
            {fields.map((f, i) => (
              <div key={f.id} className="flex items-center gap-2">
                <span className="w-5 text-right text-2xs tabular-nums text-ink-400">{i + 1}.</span>
                <Input {...register(`checklist.${i}.label` as const)} placeholder="Checklist step" />
                <Button size="icon-sm" variant="ghost" onClick={() => remove(i)} aria-label="Remove item">
                  <X />
                </Button>
              </div>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 text-[13px] text-ink-800">
          <Checkbox checked={v.active} onCheckedChange={(c) => setValue('active', c === true)} />
          Template is active
        </label>
      </DialogBody>
      <DialogFooter>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary">
          {template ? 'Save template' : 'Create template'}
        </Button>
      </DialogFooter>
    </form>
  );
}
