import { EmployeeDialog } from '@/components/team/EmployeeDialog';
import { useUI } from '@/store/ui';

/** Global "Add employee" dialog opened from quick-create and the Employees page. */
export function InviteDialog() {
  const { inviteOpen, setInviteOpen } = useUI();
  return <EmployeeDialog open={inviteOpen} onClose={() => setInviteOpen(false)} />;
}
