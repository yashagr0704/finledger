import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowDown, KeyRound, MailCheck, MoreHorizontal, Pencil, Search, ShieldCheck, Trash2, UserMinus, UserPlus, UserRoundCheck, Users } from 'lucide-react';
import { EmployeeDialog } from '@/components/team/EmployeeDialog';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, PageHeader, Segmented } from '@/components/ui/misc';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { useConfirm } from '@/components/ui/confirm';
import { Avatar } from '@/components/badges';
import { ROLE_META } from '@/lib/constants';
import { completedInMonth, isOpen, isOverdue, workloadFor } from '@/lib/metrics';
import { WorkloadMeter } from '@/components/team/WorkloadMeter';
import { canManageTeam } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { showInviteLink, showResetLink, store, useCurrentUser, useDb } from '@/store/store';
import { api, BACKEND } from '@/api/client';
import { useUI } from '@/store/ui';
import type { Role, User } from '@/types';

type SortKey = 'name' | 'active' | 'overdue' | 'workload';

export default function Team() {
  const db = useDb();
  const me = useCurrentUser();
  const navigate = useNavigate();
  const { setInviteOpen } = useUI();
  const { confirm, dialog } = useConfirm();
  const [editing, setEditing] = useState<User | null>(null);
  const [role, setRole] = useState<'all' | Role>('all');
  const [sort, setSort] = useState<SortKey>('workload');
  const [q, setQ] = useState('');
  const admin = canManageTeam(me);

  const rows = useMemo(
    () =>
      db.users.map((u) => {
        const mine = db.tasks.filter((t) => t.assigneeId === u.id);
        const open = mine.filter(isOpen);
        return {
          user: u,
          active: open.length,
          overdue: open.filter(isOverdue).length,
          done: mine.filter((t) => completedInMonth(t)).length,
          load: workloadFor(open, u),
        };
      }),
    [db],
  );

  const shown = rows
    .filter((r) => role === 'all' || r.user.role === role)
    .filter((r) => !q || r.user.name.toLowerCase().includes(q.toLowerCase()) || r.user.title.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => {
      if (a.user.status !== b.user.status) return a.user.status === 'active' ? -1 : b.user.status === 'active' ? 1 : 0;
      if (sort === 'active') return b.active - a.active;
      if (sort === 'overdue') return b.overdue - a.overdue;
      if (sort === 'workload') return b.load.pct - a.load.pct;
      return a.user.name.localeCompare(b.user.name);
    });

  const Th = ({ k, children, className }: { k?: SortKey; children: string; className?: string }) => (
    <th className={cn('px-3 py-2 font-medium', className)}>
      {k ? (
        <button onClick={() => setSort(k)} className={cn('inline-flex items-center gap-1 uppercase tracking-wide hover:text-ink-700', sort === k && 'text-ink-700')}>
          {children}
          {sort === k && <ArrowDown className="size-3" />}
        </button>
      ) : (
        children
      )}
    </th>
  );

  const changeRole = (u: User, r: Role) =>
    confirm({
      title: `Change ${u.name}’s role?`,
      description: `${u.name} will become ${ROLE_META[r].label}. ${ROLE_META[r].description}`,
      confirmLabel: 'Change role',
      onConfirm: () => store.updateMember(u.id, { role: r }) && toast.success(`${u.name} is now ${ROLE_META[r].label}`),
    });

  return (
    <div className="animate-slide-up">
      {dialog}
      <EmployeeDialog open={!!editing} user={editing ?? undefined} onClose={() => setEditing(null)} />
      <PageHeader
        title="Employees"
        description={`${rows.filter((r) => r.user.status === 'active').length} active members · ${rows.filter((r) => r.user.status === 'invited').length} pending invites`}
        actions={
          admin && (
            <Button variant="primary" onClick={() => setInviteOpen(true)}>
              <UserPlus /> Add employee
            </Button>
          )
        }
      />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="relative w-full sm:w-60">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search people…"
              aria-label="Search people"
              className="h-8 w-full rounded-md border border-line bg-white pl-8 pr-2 text-[13px] shadow-sm placeholder:text-ink-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
          <Segmented
            value={role}
            onChange={setRole}
            options={[
              { value: 'all', label: 'All' },
              { value: 'admin', label: 'Admins' },
              { value: 'manager', label: 'Managers' },
              { value: 'employee', label: 'Employees' },
            ]}
          />
        </div>
        {shown.length === 0 ? (
          <EmptyState icon={<Users />} title="No team members match" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left">
              <thead>
                <tr className="border-b border-line text-2xs font-medium uppercase tracking-wide text-ink-400">
                  <Th k="name" className="pl-4">Member</Th>
                  <Th>Role</Th>
                  <Th k="active" className="text-right">Active</Th>
                  <Th k="overdue" className="text-right">Overdue</Th>
                  <Th className="text-right">Done this month</Th>
                  <Th k="workload">Workload</Th>
                  <th className="w-12 px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.map(({ user: u, active, overdue, done }) => (
                  <tr key={u.id} className={cn('cursor-pointer hover:bg-slate-50', u.status === 'deactivated' && 'opacity-60')} onClick={() => navigate(`/team/${u.id}`)}>
                    <td className="py-2.5 pl-4 pr-3">
                      <div className="flex items-center gap-3">
                        <Avatar user={u} size="md" />
                        <div className="min-w-0">
                          <Link to={`/team/${u.id}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-2 text-[13px] font-medium text-ink-900 hover:text-brand-700">
                            {u.name}
                            {u.id === me.id && <span className="rounded bg-slate-100 px-1 text-2xs font-normal text-ink-500">You</span>}
                          </Link>
                          <p className="truncate text-xs text-ink-500">{u.title}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-xs text-ink-700">{ROLE_META[u.role].label}</span>
                      {u.status !== 'active' && (
                        <span className={cn('ml-2 rounded-full px-1.5 py-0.5 text-2xs font-medium', u.status === 'invited' ? 'bg-sky-50 text-sky-700' : 'bg-slate-100 text-ink-500')}>
                          {u.status === 'invited' ? 'Invited' : 'Deactivated'}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right text-[13px] tabular-nums text-ink-800">{active}</td>
                    <td className={cn('px-3 py-2.5 text-right text-[13px] tabular-nums', overdue ? 'font-semibold text-red-600' : 'text-ink-400')}>{overdue}</td>
                    <td className="px-3 py-2.5 text-right text-[13px] tabular-nums text-ink-800">{done}</td>
                    <td className="px-3 py-2.5">{u.status === 'active' ? <WorkloadMeter user={u} /> : <span className="text-2xs text-ink-400">—</span>}</td>
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      {admin && (
                        <Menu>
                          <MenuTrigger asChild>
                            <Button size="icon-sm" variant="ghost" aria-label={`Manage ${u.name}`}>
                              <MoreHorizontal />
                            </Button>
                          </MenuTrigger>
                          <MenuContent>
                            <MenuItem onSelect={() => setEditing(u)}>
                              <Pencil /> Edit details & permissions
                            </MenuItem>
                            <MenuSeparator />
                            <MenuLabel>Change role</MenuLabel>
                            {(['admin', 'manager', 'employee'] as Role[]).map((r) => (
                              <MenuItem key={r} disabled={u.role === r} onSelect={() => changeRole(u, r)}>
                                <ShieldCheck /> {ROLE_META[r].label}
                              </MenuItem>
                            ))}
                            <MenuSeparator />
                            {u.status === 'invited' && (
                              <>
                                <MenuItem
                                  onSelect={() =>
                                    BACKEND
                                      ? void api.inviteLink(u.id).then(
                                          (r) => showInviteLink(r.inviteUrl, r.emailed),
                                          (e: Error) => toast.error(e.message),
                                        )
                                      : toast.success(`Invite re-sent to ${u.email}`, { description: 'Simulated — no email is sent in demo mode.' })
                                  }
                                >
                                  <MailCheck /> Resend invite
                                </MenuItem>
                                {!BACKEND && (
                                  <MenuItem onSelect={() => store.updateMember(u.id, { status: 'active' }) && toast.success(`${u.name} marked as joined (demo)`)}>
                                    <UserRoundCheck /> Mark as joined (demo)
                                  </MenuItem>
                                )}
                              </>
                            )}
                            {BACKEND && u.status === 'active' && u.id !== me.id && (
                              <MenuItem
                                onSelect={() =>
                                  void api.resetLink(u.id).then(
                                    (r) => showResetLink(u.name, r.resetUrl, r.emailed),
                                    (e: Error) => toast.error(e.message),
                                  )
                                }
                              >
                                <KeyRound /> Send password reset link
                              </MenuItem>
                            )}
                            {u.status === 'deactivated' ? (
                              <MenuItem onSelect={() => store.updateMember(u.id, { status: 'active' }) && toast.success(`${u.name} reactivated`)}>
                                <UserRoundCheck /> Restore
                              </MenuItem>
                            ) : (
                              <MenuItem
                                className="text-red-600"
                                onSelect={() =>
                                  confirm({
                                    title: `Delete ${u.name} temporarily?`,
                                    description: 'Their account is deactivated: they lose access and can’t be assigned work, but their history is kept and you can restore them any time. Open tasks must be reassigned first.',
                                    confirmLabel: 'Deactivate',
                                    tone: 'danger',
                                    onConfirm: () => store.updateMember(u.id, { status: 'deactivated' }) && toast.success(`${u.name} deactivated`),
                                  })
                                }
                              >
                                <UserMinus /> Delete (temporary)
                              </MenuItem>
                            )}
                            <MenuItem
                              className="text-red-600"
                              disabled={u.id === me.id}
                              onSelect={() =>
                                confirm({
                                  title: `Delete ${u.name} permanently?`,
                                  description: 'This removes the employee record completely and cannot be undone. Only possible when they have no tasks in the system — otherwise use temporary delete.',
                                  confirmLabel: 'Delete permanently',
                                  tone: 'danger',
                                  onConfirm: () => store.deleteMember(u.id) && toast.success(`${u.name} deleted`),
                                })
                              }
                            >
                              <Trash2 /> Delete permanently
                            </MenuItem>
                          </MenuContent>
                        </Menu>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="border-t border-line px-4 py-2 text-2xs text-ink-400">Workload = remaining estimated hours due in the next 14 days (incl. overdue) as a share of two weeks’ capacity.</div>
      </Card>
    </div>
  );
}
