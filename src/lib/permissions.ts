import type { Client, Database, Permissions, Task, User } from '@/types';

/**
 * Authorization rules for the demo. These checks run inside every store
 * action (not just in navigation), but they execute in the browser: a real
 * deployment must enforce the same rules on the server.
 */

export class PermissionError extends Error {
  constructor(message = 'You do not have permission to perform this action.') {
    super(message);
    this.name = 'PermissionError';
  }
}

export const PERMISSION_META: Record<keyof Permissions, { label: string; description: string }> = {
  viewAllTasks: { label: 'View all pending tasks', description: 'See every task in the firm, not only their own or their team’s.' },
  createTaskForOthers: { label: 'Create tasks for others', description: 'Assign new work to colleagues. Without this, tasks can only be created for themselves.' },
  billing: { label: 'Billing', description: 'Access WIP, unbilled and billed work, invoices and client ledgers.' },
  manageClients: { label: 'Add / alter clients', description: 'Create clients and edit client master data.' },
  manageMasters: { label: 'Manage masters', description: 'Edit groups, services and referral sources.' },
  whatsapp: { label: 'WhatsApp & broadcasts', description: 'Chat with clients and send broadcast messages.' },
  reports: { label: 'Reports', description: 'View firm and team reports.' },
  deleteRecords: { label: 'Delete records', description: 'Permanently delete tasks and other records.' },
};

export const ROLE_DEFAULTS: Record<User['role'], Permissions> = {
  admin: { viewAllTasks: true, createTaskForOthers: true, billing: true, manageClients: true, manageMasters: true, whatsapp: true, reports: true, deleteRecords: true },
  manager: { viewAllTasks: false, createTaskForOthers: true, billing: false, manageClients: false, manageMasters: false, whatsapp: true, reports: true, deleteRecords: false },
  employee: { viewAllTasks: false, createTaskForOthers: false, billing: false, manageClients: false, manageMasters: false, whatsapp: false, reports: false, deleteRecords: false },
};

/** Role defaults with the admin's per-user overrides applied. Admins always have everything. */
export function permissionsOf(u: User): Permissions {
  if (u.role === 'admin') return ROLE_DEFAULTS.admin;
  return { ...ROLE_DEFAULTS[u.role], ...u.permissions };
}

export const isAdmin = (u: User) => u.role === 'admin';
export const isManager = (u: User) => u.role === 'manager';

/** Users whose work a manager oversees (direct reports). */
export function reportsOf(db: Database, managerId: string) {
  return db.users.filter((u) => u.managerId === managerId);
}

function managesClient(client: Client | undefined, user: User) {
  if (!client) return false;
  return client.relationshipManagerId === user.id || client.teamIds.includes(user.id);
}

export function canViewTask(db: Database, user: User, task: Task) {
  if (permissionsOf(user).viewAllTasks) return true;
  if (task.assigneeId === user.id || task.reviewerId === user.id) return true;
  if (isManager(user)) {
    if (task.createdBy === user.id) return true;
    const assignee = db.users.find((u) => u.id === task.assigneeId);
    if (assignee?.managerId === user.id) return true;
    return managesClient(db.clients.find((c) => c.id === task.clientId), user);
  }
  return false;
}

export function visibleTasks(db: Database, user: User) {
  if (permissionsOf(user).viewAllTasks) return db.tasks;
  return db.tasks.filter((t) => canViewTask(db, user, t));
}

export function canViewClient(db: Database, user: User, client: Client) {
  if (permissionsOf(user).viewAllTasks || permissionsOf(user).manageClients) return true;
  if (managesClient(client, user)) return true;
  return db.tasks.some((t) => t.clientId === client.id && canViewTask(db, user, t));
}

export function visibleClients(db: Database, user: User) {
  if (permissionsOf(user).viewAllTasks || permissionsOf(user).manageClients) return db.clients;
  return db.clients.filter((c) => canViewClient(db, user, c));
}

/** Everyone can create tasks for themselves; assigning to others needs permission. */
export const canCreateTask = (user: User) => user.status === 'active';

export function canEditTask(db: Database, user: User, task: Task) {
  if (isAdmin(user)) return true;
  if (task.createdBy === user.id && task.assigneeId === user.id) return true;
  return isManager(user) && canViewTask(db, user, task);
}

export function canDeleteTask(user: User) {
  return permissionsOf(user).deleteRecords;
}

/** Who `user` may assign work to. */
export function assignableUsers(db: Database, user: User) {
  const active = db.users.filter((u) => u.status === 'active');
  if (isAdmin(user)) return active;
  const p = permissionsOf(user);
  if (!p.createTaskForOthers) return active.filter((u) => u.id === user.id);
  if (isManager(user) && !p.viewAllTasks) return active.filter((u) => u.id === user.id || u.managerId === user.id || (u.role === 'employee' && !u.managerId));
  return active;
}

export function canAssignTo(db: Database, user: User, assigneeId: string) {
  return assignableUsers(db, user).some((u) => u.id === assigneeId);
}

export function reviewerCandidates(db: Database) {
  return db.users.filter((u) => u.status === 'active' && (u.role === 'admin' || u.role === 'manager'));
}

/** Clients a user may create tasks for. */
export function taskableClients(db: Database, user: User) {
  const live = db.clients.filter((c) => !c.exitDate);
  if (isAdmin(user) || permissionsOf(user).viewAllTasks) return live;
  if (isManager(user)) return live.filter((c) => managesClient(c, user) || c.teamIds.some((id) => reportsOf(db, user.id).some((r) => r.id === id)));
  return live.filter((c) => managesClient(c, user));
}

export function canWorkOnTask(db: Database, user: User, task: Task) {
  return task.assigneeId === user.id || canEditTask(db, user, task);
}

export function canReviewTask(user: User, task: Task) {
  return isAdmin(user) || task.reviewerId === user.id;
}

export const canBulkReassign = (user: User) => isAdmin(user) || (isManager(user) && permissionsOf(user).createTaskForOthers);
export const canCreateClient = (user: User) => permissionsOf(user).manageClients;
export function canEditClient(user: User, client: Client) {
  return permissionsOf(user).manageClients || (isManager(user) && client.relationshipManagerId === user.id);
}
export const canAccessBilling = (user: User) => permissionsOf(user).billing;
export const canManageMasters = (user: User) => permissionsOf(user).manageMasters;
export const canUseWhatsApp = (user: User) => permissionsOf(user).whatsapp;
export function canManageDocuments(db: Database, user: User, client: Client) {
  return isAdmin(user) || managesClient(client, user) || db.tasks.some((t) => t.clientId === client.id && t.assigneeId === user.id);
}
export const canManageTeam = (user: User) => isAdmin(user);
export const canViewTeam = (user: User) => isAdmin(user) || isManager(user);
export const canViewReports = (user: User) => permissionsOf(user).reports;
export const canManageTemplates = (user: User) => isAdmin(user);
export const canManageFirm = (user: User) => isAdmin(user);
export const canReview = (user: User) => isAdmin(user) || isManager(user);

export function assert(condition: boolean, message?: string): asserts condition {
  if (!condition) throw new PermissionError(message);
}
