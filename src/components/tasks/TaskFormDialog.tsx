import { useEffect, useMemo } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { addDays } from 'date-fns';
import { Plus, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Checkbox } from '@/components/ui/checkbox';
import { PRIORITY_ORDER, PRIORITY_META, ROLE_META } from '@/lib/constants';
import { toDateKey, todayKey } from '@/lib/dates';
import { assignableUsers, reviewerCandidates, taskableClients } from '@/lib/permissions';
import { store, useCurrentUser, useDb } from '@/store/store';
import { useUI } from '@/store/ui';

const schema = z
  .object({
    title: z.string().trim().min(3, 'Enter a title of at least 3 characters').max(140, 'Keep the title under 140 characters'),
    description: z.string().max(2000, 'Description is too long'),
    clientId: z.string().min(1, 'Select a client'),
    categoryId: z.string().min(1, 'Select a category'),
    serviceId: z.string().optional(),
    assigneeId: z.string().min(1, 'Select an assignee'),
    requiresReview: z.boolean(),
    reviewerId: z.string().optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']),
    startDate: z.string().min(1, 'Start date is required'),
    dueDate: z.string().min(1, 'Due date is required'),
    estimateHours: z.coerce.number({ invalid_type_error: 'Enter hours' }).min(0.5, 'Minimum 0.5 hours').max(500, 'Maximum 500 hours'),
    checklist: z.array(z.object({ label: z.string() })),
  })
  .superRefine((v, ctx) => {
    if (v.dueDate && v.startDate && v.dueDate < v.startDate) ctx.addIssue({ code: 'custom', path: ['dueDate'], message: 'Due date must be on or after the start date' });
    if (v.requiresReview && !v.reviewerId) ctx.addIssue({ code: 'custom', path: ['reviewerId'], message: 'Select a reviewer or turn off review' });
    if (v.requiresReview && v.reviewerId && v.reviewerId === v.assigneeId)
      ctx.addIssue({ code: 'custom', path: ['reviewerId'], message: 'Reviewer must be different from the assignee' });
  });

type FormValues = z.infer<typeof schema>;

export function TaskFormDialog() {
  const { taskForm, closeTaskForm, openTask } = useUI();
  return (
    <Dialog open={!!taskForm} onOpenChange={(v) => !v && closeTaskForm()}>
      {taskForm && (
        <DialogContent
          title={taskForm.mode === 'create' ? 'New task' : 'Edit task'}
          description={taskForm.mode === 'create' ? 'Assign work to your team with a clear owner, reviewer and deadline.' : taskForm.taskId}
          size="lg"
        >
          <TaskForm key={taskForm.taskId ?? 'new'} onDone={(id) => (closeTaskForm(), id && taskForm.mode === 'create' && openTask(id))} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function TaskForm({ onDone }: { onDone: (createdId?: string) => void }) {
  const db = useDb();
  const me = useCurrentUser();
  const { taskForm } = useUI();
  const editing = taskForm?.mode === 'edit' ? db.tasks.find((t) => t.id === taskForm.taskId) : undefined;

  const clients = useMemo(() => taskableClients(db, me).filter((c) => c.status !== 'inactive' || c.id === editing?.clientId), [db, me, editing]);
  const assignees = useMemo(() => assignableUsers(db, me), [db, me]);
  const reviewers = useMemo(() => reviewerCandidates(db), [db]);
  const templates = db.templates;

  const defaults: FormValues = editing
    ? {
        title: editing.title,
        description: editing.description,
        clientId: editing.clientId,
        categoryId: editing.categoryId,
        serviceId: editing.serviceId ?? '',
        assigneeId: editing.assigneeId,
        requiresReview: editing.requiresReview,
        reviewerId: editing.reviewerId ?? '',
        priority: editing.priority,
        startDate: editing.startDate,
        dueDate: editing.dueDate,
        estimateHours: editing.estimateHours,
        checklist: [],
      }
    : {
        title: taskForm?.defaults?.title ?? '',
        description: '',
        clientId: taskForm?.defaults?.clientId ?? '',
        categoryId: taskForm?.defaults?.categoryId ?? '',
        serviceId: '',
        assigneeId: taskForm?.defaults?.assigneeId ?? '',
        requiresReview: true,
        reviewerId: me.role === 'manager' ? me.id : me.role === 'employee' ? (me.managerId ?? '') : '',
        priority: 'medium',
        startDate: todayKey(),
        dueDate: taskForm?.defaults?.dueDate ?? toDateKey(addDays(new Date(), 7)),
        estimateHours: 4,
        checklist: [{ label: '' }],
      };

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: defaults });
  const { fields, append, remove } = useFieldArray({ control, name: 'checklist' });
  const requiresReview = watch('requiresReview');
  const categoryId = watch('categoryId');
  const groupServices = db.services.filter((s) => s.groupId === categoryId);
  const clientId = watch('clientId');

  // Suggest the client's relationship manager as reviewer when creating.
  useEffect(() => {
    if (editing || !clientId) return;
    const c = db.clients.find((x) => x.id === clientId);
    if (c && !watch('reviewerId')) setValue('reviewerId', c.relationshipManagerId);
  }, [clientId, db.clients, editing, setValue, watch]);

  const applyTemplate = (id: string) => {
    const tpl = templates.find((t) => t.id === id);
    if (!tpl) return;
    const cur = watch();
    reset({
      ...cur,
      title: cur.title || tpl.name,
      description: tpl.description,
      categoryId: tpl.categoryId,
      priority: tpl.priority,
      estimateHours: tpl.estimateHours,
      requiresReview: tpl.requiresReview,
      reviewerId: tpl.reviewerId ?? cur.reviewerId,
      assigneeId: tpl.defaultAssigneeId && assignees.some((a) => a.id === tpl.defaultAssigneeId) ? tpl.defaultAssigneeId : cur.assigneeId,
      checklist: tpl.checklist.map((label) => ({ label })),
    });
    toast.success(`Applied “${tpl.name}”`);
  };

  const onSubmit = (v: FormValues) => {
    const input = { ...v, serviceId: v.serviceId || undefined, reviewerId: v.requiresReview ? v.reviewerId : undefined, checklist: v.checklist.map((c) => c.label.trim()).filter(Boolean) };
    if (editing) {
      const { checklist: _ignored, ...patch } = input;
      void _ignored;
      if (store.updateTask(editing.id, patch)) {
        toast.success('Task updated');
        onDone();
      }
    } else {
      const created = store.createTask(input);
      if (created) {
        toast.success(`${created.id} created`, { description: created.title });
        onDone(created.id);
      }
    }
  };

  if (!clients.length) {
    return (
      <DialogBody>
        <p className="text-[13px] text-ink-600">You don’t have any clients you can create tasks for. Ask a firm admin to add you to a client team.</p>
      </DialogBody>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col" noValidate>
      <DialogBody className="space-y-4">
        {!editing && templates.length > 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-brand-200 bg-brand-50/50 px-3 py-2">
            <Sparkles className="size-4 shrink-0 text-brand-600" />
            <span className="text-xs text-ink-700">Start from a template</span>
            <div className="ml-auto w-56">
              <Select defaultValue="" onChange={(e) => applyTemplate(e.target.value)} aria-label="Apply template">
                <option value="">Choose template…</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        )}

        <Field label="Title" htmlFor="title" error={errors.title?.message} required>
          <Input id="title" autoFocus placeholder="e.g. GSTR-3B return — September" aria-invalid={!!errors.title} {...register('title')} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Client" htmlFor="clientId" error={errors.clientId?.message} required>
            <Select id="clientId" aria-invalid={!!errors.clientId} {...register('clientId')}>
              <option value="">Select client…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Category" htmlFor="categoryId" error={errors.categoryId?.message} required>
            <Select id="categoryId" aria-invalid={!!errors.categoryId} {...register('categoryId')}>
              <option value="">Select category…</option>
              {db.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Service" htmlFor="serviceId" hint={categoryId ? undefined : 'Choose a category first'}>
            <Select
              id="serviceId"
              disabled={!groupServices.length}
              {...register('serviceId', {
                onChange: (e) => {
                  const svc = db.services.find((s) => s.id === e.target.value);
                  if (svc && !watch('title')) setValue('title', svc.name, { shouldValidate: true });
                },
              })}
            >
              <option value="">{groupServices.length ? 'Select service…' : 'No services in this group'}</option>
              {groupServices.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.frequency}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Assignee" htmlFor="assigneeId" error={errors.assigneeId?.message} required hint={assignees.length === 1 ? 'You can create tasks for yourself. Ask an admin for “Create tasks for others”.' : me.role === 'manager' ? 'You can assign to yourself and your direct reports.' : undefined}>
            <Select id="assigneeId" aria-invalid={!!errors.assigneeId} {...register('assigneeId')}>
              <option value="">Select assignee…</option>
              {assignees.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} — {ROLE_META[u.role].short}
                </option>
              ))}
              {editing && !assignees.some((a) => a.id === editing.assigneeId) && (
                <option value={editing.assigneeId}>{db.users.find((u) => u.id === editing.assigneeId)?.name}</option>
              )}
            </Select>
          </Field>
          <Field label="Priority" htmlFor="priority">
            <Select id="priority" {...register('priority')}>
              {PRIORITY_ORDER.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_META[p].label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Start date" htmlFor="startDate" error={errors.startDate?.message} required>
            <Input id="startDate" type="date" aria-invalid={!!errors.startDate} {...register('startDate')} />
          </Field>
          <Field label="Due date" htmlFor="dueDate" error={errors.dueDate?.message} required>
            <Input id="dueDate" type="date" aria-invalid={!!errors.dueDate} {...register('dueDate')} />
          </Field>
          <Field label="Estimated effort (hours)" htmlFor="estimateHours" error={errors.estimateHours?.message}>
            <Input id="estimateHours" type="number" step="0.5" min="0.5" aria-invalid={!!errors.estimateHours} {...register('estimateHours')} />
          </Field>
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-2 pt-5 text-[13px] text-ink-800">
              <Checkbox checked={requiresReview} onCheckedChange={(v) => setValue('requiresReview', v === true, { shouldValidate: true })} />
              Requires review before completion
            </label>
          </div>
          {requiresReview && (
            <Field label="Reviewer" htmlFor="reviewerId" error={errors.reviewerId?.message} required className="sm:col-span-2">
              <Select id="reviewerId" aria-invalid={!!errors.reviewerId} {...register('reviewerId')}>
                <option value="">Select reviewer…</option>
                {reviewers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} — {u.title}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>

        <Field label="Description" htmlFor="description" error={errors.description?.message}>
          <Textarea id="description" placeholder="Scope, client-specific notes, and what “done” looks like." {...register('description')} />
        </Field>

        {!editing && (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium text-ink-700">Checklist</span>
              <Button size="sm" variant="ghost" onClick={() => append({ label: '' })}>
                <Plus /> Add item
              </Button>
            </div>
            <div className="space-y-1.5">
              {fields.map((f, i) => (
                <div key={f.id} className="flex items-center gap-2">
                  <span className="w-5 text-right text-2xs tabular-nums text-ink-400">{i + 1}.</span>
                  <Input placeholder="Checklist step" {...register(`checklist.${i}.label` as const)} />
                  <Button size="icon-sm" variant="ghost" onClick={() => remove(i)} aria-label="Remove item">
                    <X />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        <Button onClick={() => onDone()}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={isSubmitting}>
          {editing ? 'Save changes' : 'Create task'}
        </Button>
      </DialogFooter>
    </form>
  );
}
