import type { Client, Database, Task, User } from '@/types';

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
  if (isAdmin(user)) return true;
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
  if (isAdmin(user)) return db.tasks;
  return db.tasks.filter((t) => canViewTask(db, user, t));
}

export function canViewClient(db: Database, user: User, client: Client) {
  if (isAdmin(user)) return true;
  if (managesClient(client, user)) return true;
  return db.tasks.some((t) => t.clientId === client.id && canViewTask(db, user, t));
}

export function visibleClients(db: Database, user: User) {
  if (isAdmin(user)) return db.clients;
  return db.clients.filter((c) => canViewClient(db, user, c));
}

export const canCreateTask = (user: User) => isAdmin(user) || isManager(user);

export function canEditTask(db: Database, user: User, task: Task) {
  if (isAdmin(user)) return true;
  return isManager(user) && canViewTask(db, user, task);
}

export function canDeleteTask(user: User) {
  return isAdmin(user);
}

/** Who `user` may assign work to. */
export function assignableUsers(db: Database, user: User) {
  const active = db.users.filter((u) => u.status === 'active');
  if (isAdmin(user)) return active;
  if (isManager(user)) return active.filter((u) => u.id === user.id || u.managerId === user.id || (u.role === 'employee' && !u.managerId));
  return [];
}

export function canAssignTo(db: Database, user: User, assigneeId: string) {
  return assignableUsers(db, user).some((u) => u.id === assigneeId);
}

export function reviewerCandidates(db: Database) {
  return db.users.filter((u) => u.status === 'active' && (u.role === 'admin' || u.role === 'manager'));
}

/** Clients a user may create tasks for. */
export function taskableClients(db: Database, user: User) {
  if (isAdmin(user)) return db.clients;
  if (isManager(user)) return db.clients.filter((c) => managesClient(c, user) || c.teamIds.some((id) => reportsOf(db, user.id).some((r) => r.id === id)));
  return [];
}

export function canWorkOnTask(db: Database, user: User, task: Task) {
  return task.assigneeId === user.id || canEditTask(db, user, task);
}

export function canReviewTask(user: User, task: Task) {
  return isAdmin(user) || task.reviewerId === user.id;
}

export const canBulkReassign = (user: User) => isAdmin(user) || isManager(user);
export const canCreateClient = (user: User) => isAdmin(user);
export function canEditClient(user: User, client: Client) {
  return isAdmin(user) || (isManager(user) && client.relationshipManagerId === user.id);
}
export function canManageDocuments(db: Database, user: User, client: Client) {
  return isAdmin(user) || managesClient(client, user) || db.tasks.some((t) => t.clientId === client.id && t.assigneeId === user.id);
}
export const canManageTeam = (user: User) => isAdmin(user);
export const canViewTeam = (user: User) => isAdmin(user) || isManager(user);
export const canViewReports = (user: User) => isAdmin(user) || isManager(user);
export const canManageTemplates = (user: User) => isAdmin(user);
export const canManageFirm = (user: User) => isAdmin(user);
export const canReview = (user: User) => isAdmin(user) || isManager(user);

export function assert(condition: boolean, message?: string): asserts condition {
  if (!condition) throw new PermissionError(message);
}
