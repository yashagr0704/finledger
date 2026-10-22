import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form';
import { ROLE_META } from '@/lib/constants';
import { store, useDb } from '@/store/store';
import { useUI } from '@/store/ui';

const schema = z.object({
  name: z.string().trim().min(2, 'Enter a full name'),
  email: z.string().trim().email('Enter a valid email address'),
  role: z.enum(['admin', 'manager', 'employee']),
  title: z.string().trim().max(80),
  managerId: z.string().optional(),
});
type Values = z.infer<typeof schema>;

export function InviteDialog() {
  const { inviteOpen, setInviteOpen } = useUI();
  return (
    <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
      {inviteOpen && (
        <DialogContent title="Invite team member" description="They’ll appear as “Invited” until they accept. No email is sent in demo mode." size="sm">
          <InviteForm onDone={() => setInviteOpen(false)} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function InviteForm({ onDone }: { onDone: () => void }) {
  const db = useDb();
  const managers = db.users.filter((u) => u.role === 'manager' && u.status === 'active');
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { name: '', email: '', role: 'employee', title: '', managerId: managers[0]?.id } });
  const role = watch('role');
  return (
    <form
      noValidate
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={handleSubmit((v) => {
        const u = store.inviteMember(v);
        if (u) {
          toast.success(`Invitation created for ${u.name}`, { description: 'Simulated — no email was sent.' });
          onDone();
        }
      })}
    >
      <DialogBody className="space-y-4">
        <Field label="Full name" htmlFor="inv-name" error={errors.name?.message} required>
          <Input id="inv-name" autoFocus aria-invalid={!!errors.name} {...register('name')} />
        </Field>
        <Field label="Work email" htmlFor="inv-email" error={errors.email?.message} required>
          <Input id="inv-email" type="email" placeholder="name@firm.com" aria-invalid={!!errors.email} {...register('email')} />
        </Field>
        <Field label="Role" htmlFor="inv-role" hint={ROLE_META[role].description}>
          <Select id="inv-role" {...register('role')}>
            {(['employee', 'manager', 'admin'] as const).map((r) => (
              <option key={r} value={r}>
                {ROLE_META[r].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Job title" htmlFor="inv-title">
          <Input id="inv-title" placeholder="e.g. Associate — GST" {...register('title')} />
        </Field>
        {role === 'employee' && (
          <Field label="Reports to" htmlFor="inv-manager">
            <Select id="inv-manager" {...register('managerId')}>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </DialogBody>
      <DialogFooter>
        <Button onClick={onDone}>Cancel</Button>
        <Button type="submit" variant="primary">
          Send invite
        </Button>
      </DialogFooter>
    </form>
  );
}
