import { formatDate } from '@/lib/dates';
import { STATUS_LONG_LABEL } from '@/lib/constants';
import {
  assert,
  canAccessBilling,
  canAssignTo,
  canBulkReassign,
  canCreateClient,
  canCreateTask,
  canDeleteTask,
  canEditClient,
  canEditTask,
  canManageDocuments,
  canManageFirm,
  canManageMasters,
  canManageTeam,
  canManageTemplates,
  canUseWhatsApp,
  canViewClient,
  canViewTask,
  canWorkOnTask,
  permissionsOf,
  reviewerCandidates,
  taskableClients,
} from '@/lib/permissions';
import { upcomingPeriods } from '@/lib/periods';
import { canTransition } from '@/lib/workflow';
import { ENTITY_TYPES } from '@/types';
import type {
  Broadcast,
  Client,
  Database,
  DocMovement,
  DocumentRequest,
  Dsc,
  FilingStage,
  Firm,
  Invoice,
  Note,
  Notice,
  Payment,
  Portal,
  Referrer,
  Reminder,
  Role,
  Service,
  Task,
  TaskStatus,
  TaskTemplate,
  User,
} from '@/types';
import { fail, found, log, notify, pick, type Ctx } from './context';

export interface TaskInput {
  title: string;
  description: string;
  clientId: string;
  categoryId: string;
  assigneeId: string;
  reviewerId?: string;
  priority: Task['priority'];
  startDate: string;
  dueDate: string;
  estimateHours: number;
  requiresReview: boolean;
  checklist: string[];
  serviceId?: string;
  fee?: number;
}

export type ClientInput = Omit<Client, 'id' | 'since'>;
export type TemplateInput = Omit<TaskTemplate, 'id' | 'createdAt' | 'lastGeneratedAt'>;
export type MemberInput = { name: string; email: string; role: Role; title: string; managerId?: string } & Partial<Pick<User, 'phone' | 'address' | 'aadhaar' | 'pan' | 'username' | 'permissions'>>;
export type MemberPatch = Partial<Pick<User, 'role' | 'status' | 'title' | 'managerId' | 'capacityHours' | 'name' | 'email' | 'phone' | 'address' | 'aadhaar' | 'pan' | 'username' | 'permissions'>>;

const CLIENT_KEYS = [
  'code', 'name', 'entityType', 'industry', 'contactName', 'email', 'phone', 'city', 'pan', 'gstin', 'relationshipManagerId', 'teamIds', 'status', 'notes',
  'billingName', 'tradeName', 'fileNo', 'incorporatedOn', 'taxesApplicable', 'referredById', 'exitDate', 'contacts', 'customFields', 'portalLogins', 'serviceIds',
] as const satisfies readonly (keyof ClientInput)[];
const MEMBER_KEYS = ['role', 'status', 'title', 'managerId', 'capacityHours', 'name', 'email', 'phone', 'address', 'aadhaar', 'pan', 'username', 'permissions'] as const;
const FIRM_KEYS = ['name', 'legalName', 'registrationNo', 'city', 'email', 'phone', 'atRiskDays', 'whatsappNumber', 'invoicePrefix', 'defaultGstRate', 'gstin', 'address'] as const;
const TEMPLATE_KEYS = [
  'name', 'categoryId', 'description', 'checklist', 'assignmentRule', 'defaultAssigneeId', 'reviewerId', 'frequency', 'intervalMonths', 'dueDay', 'dueMonthOffset',
  'entityTypes', 'priority', 'estimateHours', 'requiresReview', 'active',
] as const;

const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);

// ----------------------------------------------------------------- helpers

function task(ctx: Ctx, id: string) {
  return found(ctx.db.tasks.find((t) => t.id === id), 'Task');
}
function visibleClient(ctx: Ctx, id: string) {
  const c = found(ctx.db.clients.find((x) => x.id === id), 'Client');
  assert(canViewClient(ctx.db, ctx.me, c), 'You don’t have access to this client.');
  return c;
}
function activeUser(ctx: Ctx, id: string | undefined, what = 'User') {
  const u = ctx.db.users.find((x) => x.id === id);
  if (!u || u.status !== 'active') fail(`${what} is not an active team member.`);
  return u;
}
function touch(ctx: Ctx, t: Task) {
  t.updatedAt = now();
  t.updatedBy = ctx.me.id;
}

// ------------------------------------------------------------------- tasks

export function createTask(ctx: Ctx, input: TaskInput) {
  const { db, me } = ctx;
  assert(canCreateTask(me), 'Your account can’t create tasks.');
  if (!input.title?.trim()) fail('Task title is required.');
  assert(taskableClients(db, me).some((c) => c.id === input.clientId), 'You cannot create tasks for this client.');
  assert(canAssignTo(db, me, input.assigneeId), 'You cannot assign work to this person.');
  const category = found(db.categories.find((c) => c.id === input.categoryId), 'Category');
  if (input.requiresReview) {
    if (!reviewerCandidates(db).some((u) => u.id === input.reviewerId)) fail('Choose a valid reviewer.');
    if (input.reviewerId === input.assigneeId) fail('Reviewer must be different from the assignee.');
  }
  if (input.dueDate < input.startDate) fail('Due date must be on or after the start date.');
  const at = now();
  const id = ctx.newTaskId();
  const t: Task = {
    id,
    title: input.title.trim(),
    description: (input.description ?? '').trim(),
    clientId: input.clientId,
    categoryId: category.id,
    assigneeId: input.assigneeId,
    reviewerId: input.requiresReview ? input.reviewerId : undefined,
    priority: input.priority,
    status: 'not_started',
    startDate: input.startDate,
    dueDate: input.dueDate,
    estimateHours: input.estimateHours,
    checklist: (input.checklist ?? []).filter(Boolean).map((label, i) => ({ id: `${id}_ck${i}`, label, done: false })),
    attachments: [],
    requiresReview: input.requiresReview,
    filingStage: category.isFiling ? 'preparation' : undefined,
    serviceId: db.services.some((s) => s.id === input.serviceId) ? input.serviceId : undefined,
    fee: input.fee ?? db.services.find((s) => s.id === input.serviceId)?.defaultFee,
    createdBy: me.id,
    createdAt: at,
    updatedAt: at,
    updatedBy: me.id,
  };
  db.tasks.push(t);
  log(ctx, { type: 'task_created', taskId: id, clientId: t.clientId });
  notify(ctx, t.assigneeId, { type: 'assigned', title: 'New task assigned', body: `${t.title} · due ${formatDate(t.dueDate, 'd MMM')}`, taskId: id, clientId: t.clientId });
  return t;
}

export function updateTask(ctx: Ctx, id: string, patch: Partial<TaskInput>) {
  const { db, me } = ctx;
  const t = task(ctx, id);
  assert(canEditTask(db, me, t), 'You cannot edit this task.');
  if (patch.assigneeId && patch.assigneeId !== t.assigneeId) assert(canAssignTo(db, me, patch.assigneeId), 'You cannot assign work to this person.');
  if (patch.clientId && patch.clientId !== t.clientId) assert(taskableClients(db, me).some((c) => c.id === patch.clientId), 'You cannot move tasks to this client.');
  if (patch.categoryId) found(db.categories.find((c) => c.id === patch.categoryId), 'Category');
  if (patch.reviewerId && !reviewerCandidates(db).some((u) => u.id === patch.reviewerId)) fail('Choose a valid reviewer.');
  const prev = { ...t };
  if (patch.title !== undefined) t.title = patch.title.trim() || fail('Task title is required.');
  if (patch.description !== undefined) t.description = patch.description.trim();
  if (patch.clientId !== undefined) t.clientId = patch.clientId;
  if (patch.categoryId !== undefined) t.categoryId = patch.categoryId;
  if (patch.serviceId !== undefined) t.serviceId = patch.serviceId || undefined;
  if (patch.priority !== undefined) t.priority = patch.priority;
  if (patch.startDate !== undefined) t.startDate = patch.startDate;
  if (patch.estimateHours !== undefined) t.estimateHours = patch.estimateHours;
  if (patch.requiresReview !== undefined) t.requiresReview = patch.requiresReview;
  if (patch.reviewerId !== undefined || patch.requiresReview !== undefined) t.reviewerId = t.requiresReview ? (patch.reviewerId ?? t.reviewerId) : undefined;
  if (t.requiresReview && t.reviewerId === (patch.assigneeId ?? t.assigneeId)) fail('Reviewer must be different from the assignee.');
  if (patch.assigneeId && patch.assigneeId !== prev.assigneeId) {
    t.assigneeId = patch.assigneeId;
    log(ctx, { type: 'reassigned', taskId: id, clientId: t.clientId, meta: { from: prev.assigneeId, to: t.assigneeId } });
    notify(ctx, t.assigneeId, { type: 'assigned', title: 'Task reassigned to you', body: `${t.title} · due ${formatDate(t.dueDate, 'd MMM')}`, taskId: id, clientId: t.clientId });
  }
  if (patch.dueDate && patch.dueDate !== prev.dueDate) {
    t.dueDate = patch.dueDate;
    log(ctx, { type: 'due_changed', taskId: id, clientId: t.clientId, meta: { from: prev.dueDate, to: t.dueDate } });
    notify(ctx, t.assigneeId, { type: 'due_changed', title: 'Deadline changed', body: `${t.title} is now due ${formatDate(t.dueDate, 'd MMM yyyy')}`, taskId: id, clientId: t.clientId });
  }
  const otherChange = (['title', 'description', 'priority', 'categoryId', 'estimateHours', 'reviewerId', 'requiresReview', 'clientId', 'startDate'] as const).some((k) => String(prev[k] ?? '') !== String(t[k] ?? ''));
  if (otherChange) log(ctx, { type: 'task_updated', taskId: id, clientId: t.clientId });
  touch(ctx, t);
  return true;
}

export function transitionTask(ctx: Ctx, id: string, to: TaskStatus, note?: string) {
  const { db, me } = ctx;
  const t = task(ctx, id);
  const tr = canTransition(db, me, t, to);
  assert(!!tr, `You can’t move this task to ${STATUS_LONG_LABEL[to] ?? to}.`);
  if (tr.requiresNote && !note?.trim()) fail('An explanation is required when returning work.');
  const from = t.status;
  const at = now();
  t.status = to;
  touch(ctx, t);
  if (to === 'in_review') {
    t.submittedAt = at;
    if (t.filingStage === 'preparation') t.filingStage = 'review';
    notify(ctx, t.reviewerId, { type: 'submitted', title: 'Submitted for review', body: `${me.name} submitted ${t.title}`, taskId: id, clientId: t.clientId });
  }
  if (from === 'in_review' && (to === 'completed' || to === 'changes_requested')) {
    const decision = to === 'completed' ? 'approved' : 'returned';
    db.reviews.push({ id: ctx.newId('rev'), taskId: id, reviewerId: me.id, submittedAt: t.submittedAt ?? at, decidedAt: at, decision, note: note?.trim() });
    log(ctx, { type: decision === 'approved' ? 'review_approved' : 'review_returned', taskId: id, clientId: t.clientId, meta: note ? { note: note.trim() } : undefined });
    if (decision === 'approved') {
      if (t.filingStage === 'review' || t.filingStage === 'preparation') t.filingStage = 'ready_to_file';
      notify(ctx, t.assigneeId, { type: 'approved', title: 'Review approved', body: `${me.name} approved ${t.title}`, taskId: id, clientId: t.clientId });
    } else {
      db.comments.push({ id: ctx.newId('cmt'), taskId: id, authorId: me.id, body: note!.trim(), createdAt: at });
      notify(ctx, t.assigneeId, { type: 'changes_requested', title: 'Changes requested', body: `${me.name}: “${note!.trim().slice(0, 80)}”`, taskId: id, clientId: t.clientId });
    }
  } else {
    log(ctx, { type: 'status_changed', taskId: id, clientId: t.clientId, meta: { from, to } });
  }
  if (to === 'completed') t.completedAt = at;
  if (from === 'completed') t.completedAt = undefined;
  return true;
}

export function setFilingStage(ctx: Ctx, id: string, stage: FilingStage, reference?: string) {
  const t = task(ctx, id);
  assert(canWorkOnTask(ctx.db, ctx.me, t), 'You cannot update this filing.');
  if ((stage === 'filed' || stage === 'ready_to_file') && t.requiresReview && t.status !== 'completed')
    fail('Internal review must be approved before the filing can be marked Ready to File or Filed.');
  const prev = t.filingStage;
  t.filingStage = stage;
  if (reference !== undefined) t.filingReference = reference.trim() || undefined;
  touch(ctx, t);
  log(ctx, { type: 'filing_updated', taskId: id, clientId: t.clientId, meta: { from: prev ?? '', to: stage } });
  return true;
}

function workable(ctx: Ctx, taskId: string, message: string) {
  const t = task(ctx, taskId);
  assert(canWorkOnTask(ctx.db, ctx.me, t), message);
  return t;
}

export function toggleChecklistItem(ctx: Ctx, taskId: string, itemId: string) {
  const t = workable(ctx, taskId, 'You cannot update this checklist.');
  const item = found(t.checklist.find((c) => c.id === itemId), 'Checklist item');
  item.done = !item.done;
  touch(ctx, t);
}

export function addChecklistItem(ctx: Ctx, taskId: string, label: string) {
  const t = workable(ctx, taskId, 'You cannot update this checklist.');
  if (!label.trim()) return;
  t.checklist.push({ id: ctx.newId('ck'), label: label.trim(), done: false });
  touch(ctx, t);
  log(ctx, { type: 'checklist_updated', taskId, clientId: t.clientId, meta: { name: label.trim() } });
}

export function removeChecklistItem(ctx: Ctx, taskId: string, itemId: string) {
  const t = workable(ctx, taskId, 'You cannot update this checklist.');
  t.checklist = t.checklist.filter((c) => c.id !== itemId);
  touch(ctx, t);
}

export function addComment(ctx: Ctx, taskId: string, body: string) {
  const t = task(ctx, taskId);
  assert(canViewTask(ctx.db, ctx.me, t), 'You cannot comment on this task.');
  if (!body.trim()) fail('Comment cannot be empty.');
  ctx.db.comments.push({ id: ctx.newId('cmt'), taskId, authorId: ctx.me.id, body: body.trim(), createdAt: now() });
  log(ctx, { type: 'commented', taskId, clientId: t.clientId });
  const preview = `${ctx.me.name}: “${body.trim().slice(0, 80)}”`;
  for (const target of new Set([t.assigneeId, t.reviewerId])) notify(ctx, target, { type: 'comment', title: 'New comment', body: preview, taskId, clientId: t.clientId });
  return true;
}

export function addAttachment(ctx: Ctx, taskId: string, file: { name: string; sizeKb: number; fileId?: string }) {
  const t = workable(ctx, taskId, 'You cannot add files to this task.');
  const at = now();
  t.attachments.push({ id: ctx.newId('att'), name: file.name, sizeKb: Math.max(1, Math.round(file.sizeKb)), uploadedBy: ctx.me.id, uploadedAt: at, fileId: file.fileId });
  touch(ctx, t);
  log(ctx, { type: 'attachment_added', taskId, clientId: t.clientId, meta: { name: file.name } });
  for (const target of new Set([t.assigneeId, t.reviewerId])) notify(ctx, target, { type: 'document', title: 'Document uploaded', body: `${ctx.me.name} added ${file.name} to ${t.title}`, taskId, clientId: t.clientId });
  return true;
}

export function removeAttachment(ctx: Ctx, taskId: string, attachmentId: string) {
  const t = workable(ctx, taskId, 'You cannot remove files from this task.');
  t.attachments = t.attachments.filter((a) => a.id !== attachmentId);
  touch(ctx, t);
}

export function bulkReassign(ctx: Ctx, ids: string[], assigneeId: string) {
  const { db, me } = ctx;
  assert(canBulkReassign(me), 'Only admins and managers can reassign tasks.');
  assert(canAssignTo(db, me, assigneeId), 'You cannot assign work to this person.');
  const editable = ids.filter((id) => {
    const t = db.tasks.find((x) => x.id === id);
    return t && canEditTask(db, me, t) && t.assigneeId !== assigneeId;
  });
  for (const id of editable) {
    const t = task(ctx, id);
    const from = t.assigneeId;
    t.assigneeId = assigneeId;
    touch(ctx, t);
    log(ctx, { type: 'reassigned', taskId: id, clientId: t.clientId, meta: { from, to: assigneeId } });
  }
  if (editable.length) notify(ctx, assigneeId, { type: 'assigned', title: `${editable.length} tasks reassigned to you`, body: `${me.name} moved work to your queue`, taskId: editable[0] });
  return editable.length;
}

export function deleteTask(ctx: Ctx, id: string) {
  assert(canDeleteTask(ctx.me), 'You don’t have permission to delete tasks.');
  task(ctx, id);
  const d = ctx.db;
  d.tasks = d.tasks.filter((t) => t.id !== id);
  d.comments = d.comments.filter((c) => c.taskId !== id);
  d.notifications = d.notifications.filter((n) => n.taskId !== id);
  d.documents = d.documents.map((doc) => (doc.taskId === id ? { ...doc, taskId: undefined } : doc));
  return true;
}

// ----------------------------------------------------------------- clients

function cleanClient(ctx: Ctx, input: Partial<ClientInput>, existing?: Client) {
  const c = pick<ClientInput, (typeof CLIENT_KEYS)[number]>(input, CLIENT_KEYS);
  if (c.entityType && !ENTITY_TYPES.includes(c.entityType)) fail('Unknown entity type.');
  if (c.relationshipManagerId) activeUser(ctx, c.relationshipManagerId, 'Relationship manager');
  if (c.teamIds) c.teamIds = c.teamIds.filter((id) => ctx.db.users.some((u) => u.id === id));
  if (c.referredById && !ctx.db.referrers.some((r) => r.id === c.referredById)) c.referredById = undefined;
  if (c.serviceIds) c.serviceIds = c.serviceIds.filter((id) => ctx.db.services.some((s) => s.id === id));
  if (c.portalLogins) {
    const seen = new Set<string>();
    // A blank password means "keep the saved one" (the server never sends passwords out in bulk).
    c.portalLogins = c.portalLogins.map((l) => {
      if (!ctx.db.portals.some((p) => p.id === l.portalId)) fail('Unknown portal in login details.');
      const username = l.username.trim();
      const key = `${l.portalId}\n${username.toLowerCase()}`;
      if (seen.has(key)) fail('The same portal login is listed twice.');
      seen.add(key);
      const prevs = existing?.portalLogins ?? [];
      // Match by id first (survives username edits), then by portal + username for older records.
      // A saved password never moves to a different portal.
      const prev = (l.id ? prevs.find((p) => p.id === l.id) : undefined) ?? prevs.find((p) => p.portalId === l.portalId && p.username === username);
      const same = prev?.portalId === l.portalId ? prev : undefined;
      const password = l.password || same?.password || '';
      const extra = l.extra?.trim() || undefined;
      // hasPassword only matters on scoped (client-side) copies, where saved passwords are blank.
      return {
        id: same?.id ?? ctx.newId('pl'),
        portalId: l.portalId,
        username,
        password,
        ...(extra ? { extra } : {}),
        ...(!password && same?.hasPassword ? { hasPassword: true } : {}),
      };
    });
  }
  if (c.status === 'inactive' && !c.exitDate && !existing?.exitDate) c.exitDate = today();
  if (c.status && c.status !== 'inactive') c.exitDate = undefined;
  return c;
}

export function createClient(ctx: Ctx, input: ClientInput) {
  assert(canCreateClient(ctx.me), 'You don’t have permission to add clients.');
  const code = input.code?.trim().toUpperCase();
  if (!code) fail('Client code is required.');
  if (!input.name?.trim()) fail('Client name is required.');
  if (ctx.db.clients.some((c) => c.code === code)) fail(`Client code ${code} is already in use.`);
  const client = { teamIds: [], status: 'onboarding', ...cleanClient(ctx, input), code, id: ctx.newId('cl'), since: today() } as Client;
  ctx.db.clients.push(client);
  log(ctx, { type: 'client_created', clientId: client.id });
  return client;
}

export function updateClient(ctx: Ctx, id: string, patch: Partial<ClientInput>) {
  const client = found(ctx.db.clients.find((c) => c.id === id), 'Client');
  assert(canEditClient(ctx.me, client), 'You cannot edit this client.');
  const code = patch.code?.trim().toUpperCase();
  if (code && ctx.db.clients.some((c) => c.id !== id && c.code === code)) fail('That client code is already in use.');
  Object.assign(client, cleanClient(ctx, patch, client), code ? { code } : {});
  log(ctx, { type: 'client_updated', clientId: id });
  return true;
}

export function setClientExit(ctx: Ctx, clientId: string, exitDate: string | undefined) {
  const c = found(ctx.db.clients.find((x) => x.id === clientId), 'Client');
  assert(canEditClient(ctx.me, c), 'You cannot edit this client.');
  c.exitDate = exitDate;
  c.status = exitDate ? 'inactive' : 'active';
  log(ctx, { type: 'client_updated', clientId, meta: { name: exitDate ? 'exit' : 'rejoin' } });
  return true;
}

export function requestDocument(ctx: Ctx, input: { clientId: string; taskId?: string; name: string; dueDate?: string }) {
  const client = found(ctx.db.clients.find((c) => c.id === input.clientId), 'Client');
  assert(canManageDocuments(ctx.db, ctx.me, client), 'You cannot request documents for this client.');
  if (!input.name?.trim()) fail('Document name is required.');
  if (input.taskId && !ctx.db.tasks.some((t) => t.id === input.taskId && t.clientId === client.id)) fail('That task belongs to another client.');
  const doc: DocumentRequest = { id: ctx.newId('doc'), clientId: client.id, taskId: input.taskId, name: input.name.trim(), dueDate: input.dueDate, status: 'pending', requestedAt: now() };
  ctx.db.documents.push(doc);
  log(ctx, { type: 'document_requested', clientId: doc.clientId, taskId: doc.taskId, meta: { name: doc.name } });
  return doc;
}

export function setDocumentStatus(ctx: Ctx, docId: string, status: DocumentRequest['status']) {
  const x = found(ctx.db.documents.find((d) => d.id === docId), 'Document request');
  const client = found(ctx.db.clients.find((c) => c.id === x.clientId), 'Client');
  assert(canManageDocuments(ctx.db, ctx.me, client), 'You cannot update this document request.');
  x.status = status;
  x.receivedAt = status === 'received' ? now() : undefined;
  if (status === 'received') {
    log(ctx, { type: 'document_received', clientId: x.clientId, taskId: x.taskId, meta: { name: x.name } });
    const t = x.taskId ? ctx.db.tasks.find((tt) => tt.id === x.taskId) : undefined;
    if (t) notify(ctx, t.assigneeId, { type: 'document', title: 'Document received', body: `${x.name} received from ${client.name}`, taskId: t.id, clientId: x.clientId });
  }
  return true;
}

// -------------------------------------------------------------------- team

export function inviteMember(ctx: Ctx, input: MemberInput) {
  assert(canManageTeam(ctx.me), 'Only firm admins can add team members.');
  const email = input.email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Enter a valid email address.');
  if (!input.name?.trim()) fail('Name is required.');
  if (!['admin', 'manager', 'employee'].includes(input.role)) fail('Unknown role.');
  if (ctx.db.users.some((u) => u.email.toLowerCase() === email)) fail('Someone with this email is already on the team.');
  const user: User = {
    id: ctx.newId('usr'),
    name: input.name.trim(),
    email,
    phone: input.phone ?? '',
    address: input.address,
    aadhaar: input.aadhaar,
    pan: input.pan,
    username: input.username || email.split('@')[0],
    permissions: input.permissions,
    role: input.role,
    title: input.title?.trim() || (input.role === 'employee' ? 'Associate' : 'Manager'),
    managerId: input.role === 'employee' && ctx.db.users.some((u) => u.id === input.managerId) ? input.managerId : undefined,
    status: 'invited',
    joinedAt: today(),
    capacityHours: 45,
    avatarHue: Math.floor(Math.random() * 360),
  };
  ctx.db.users.push(user);
  log(ctx, { type: 'member_invited', userId: user.id });
  return user;
}

export function updateMember(ctx: Ctx, userId: string, rawPatch: MemberPatch) {
  const { db, me } = ctx;
  assert(canManageTeam(me), 'Only firm admins can manage team members.');
  const patch = pick<User, (typeof MEMBER_KEYS)[number]>(rawPatch, MEMBER_KEYS);
  const user = found(db.users.find((u) => u.id === userId), 'Member');
  if (userId === me.id && ((patch.role && patch.role !== 'admin') || patch.status === 'deactivated')) fail('You cannot remove your own admin access.');
  const admins = db.users.filter((u) => u.role === 'admin' && u.status === 'active');
  if (user.role === 'admin' && admins.length === 1 && ((patch.role && patch.role !== 'admin') || patch.status === 'deactivated')) fail('The firm must keep at least one active admin.');
  if (patch.status === 'deactivated') {
    const open = db.tasks.filter((t) => t.assigneeId === userId && t.status !== 'completed').length;
    if (open) fail(`Reassign ${open} open task${open > 1 ? 's' : ''} before deactivating this member.`);
  }
  if (patch.email) {
    patch.email = patch.email.trim().toLowerCase();
    if (db.users.some((u) => u.id !== userId && u.email.toLowerCase() === patch.email)) fail('Someone else already uses this email.');
  }
  Object.assign(user, patch);
  if (user.role !== 'employee') user.managerId = undefined;
  log(ctx, { type: 'member_updated', userId, meta: Object.fromEntries(Object.entries(patch).filter(([k]) => k === 'role' || k === 'status').map(([k, v]) => [k, String(v ?? '')])) });
  return true;
}

export function deleteMember(ctx: Ctx, userId: string) {
  assert(canManageTeam(ctx.me), 'Only firm admins can delete team members.');
  if (userId === ctx.me.id) fail('You cannot delete yourself.');
  found(ctx.db.users.find((u) => u.id === userId), 'Member');
  removeMember(ctx.db, userId);
  return true;
}

/** Removes a person and their private data from `db` (also used by the platform superadmin). Refused while tasks point at them. */
export function removeMember(db: Database, userId: string) {
  if (db.tasks.some((t) => t.assigneeId === userId || t.reviewerId === userId)) fail('This person has tasks in the system. Deactivate them instead, or reassign their work first.');
  db.users = db.users.filter((u) => u.id !== userId);
  db.notes = db.notes.filter((n) => n.userId !== userId);
  db.reminders = db.reminders.filter((r) => r.userId !== userId);
  db.notifications = db.notifications.filter((n) => n.userId !== userId);
}

export function updateFirm(ctx: Ctx, patch: Partial<Firm>) {
  assert(canManageFirm(ctx.me), 'Only firm admins can change firm settings.');
  const p = pick<Firm, (typeof FIRM_KEYS)[number]>(patch, FIRM_KEYS);
  if (p.name !== undefined && !p.name.trim()) fail('Firm name is required.');
  if (p.atRiskDays !== undefined && !(p.atRiskDays >= 1 && p.atRiskDays <= 14)) fail('At-risk window must be between 1 and 14 days.');
  Object.assign(ctx.db.firm, p);
  return true;
}

export function addCategory(ctx: Ctx, name: string, isFiling: boolean) {
  assert(canManageFirm(ctx.me), 'Only firm admins can manage categories.');
  if (!name.trim()) fail('Category name is required.');
  if (ctx.db.categories.some((c) => c.name.toLowerCase() === name.trim().toLowerCase())) fail('That category already exists.');
  ctx.db.categories.push({ id: ctx.newId('cat'), name: name.trim(), isFiling: !!isFiling, colorSlot: ctx.db.categories.length % 8 });
  return true;
}

// ----------------------------------------------------------- notifications

export function markNotificationRead(ctx: Ctx, id: string, read = true) {
  const n = ctx.db.notifications.find((x) => x.id === id && x.userId === ctx.me.id);
  if (n) n.read = read;
}

export function markAllNotificationsRead(ctx: Ctx) {
  ctx.db.notifications.forEach((n) => {
    if (n.userId === ctx.me.id) n.read = true;
  });
}

// --------------------------------------------------------------- templates

export function saveTemplate(ctx: Ctx, input: TemplateInput, id?: string) {
  assert(canManageTemplates(ctx.me), 'Only firm admins can manage templates.');
  const p = pick<TemplateInput, (typeof TEMPLATE_KEYS)[number]>(input, TEMPLATE_KEYS);
  if (p.categoryId) found(ctx.db.categories.find((c) => c.id === p.categoryId), 'Category');
  if (id) {
    const t = found(ctx.db.templates.find((x) => x.id === id), 'Template');
    Object.assign(t, p);
    return t;
  }
  if (!p.name?.trim()) fail('Template name is required.');
  const saved = { ...(p as TemplateInput), id: ctx.newId('tpl'), createdAt: now() };
  ctx.db.templates.push(saved);
  return saved;
}

/** Creates tasks for the next period of a template for every applicable client that lacks one. */
export function generateFromTemplate(ctx: Ctx, templateId: string, opts?: { onlyIfDueWithinDays?: number }) {
  const { db, me } = ctx;
  assert(canManageTemplates(me), 'Only firm admins can generate recurring tasks.');
  const tpl = found(db.templates.find((t) => t.id === templateId), 'Template');
  const [period] = upcomingPeriods(tpl, new Date(), 1);
  if (!period) fail('No upcoming period for this schedule.');
  if (opts?.onlyIfDueWithinDays !== undefined && (new Date(period.dueDate).getTime() - Date.now()) / 86400000 > opts.onlyIfDueWithinDays) return { created: 0, period };
  const targets = db.clients.filter(
    (c) =>
      c.status !== 'inactive' &&
      !c.exitDate &&
      tpl.entityTypes.includes(c.entityType) &&
      !db.tasks.some((t) => t.clientId === c.id && t.recurrence?.templateId === tpl.id && t.recurrence.periodLabel === period.label),
  );
  let created = 0;
  for (const c of targets) {
    const id = ctx.newTaskId();
    const fixed = tpl.assignmentRule === 'fixed' && db.users.some((u) => u.id === tpl.defaultAssigneeId && u.status === 'active') ? tpl.defaultAssigneeId! : undefined;
    const assigneeId = tpl.assignmentRule === 'relationship_manager' ? c.relationshipManagerId : (fixed ?? me.id);
    const at = now();
    const category = db.categories.find((x) => x.id === tpl.categoryId);
    db.tasks.push({
      id,
      title: `${tpl.name} — ${period.label}`,
      description: tpl.description,
      clientId: c.id,
      categoryId: tpl.categoryId,
      assigneeId,
      reviewerId: tpl.requiresReview && tpl.reviewerId !== assigneeId ? tpl.reviewerId : undefined,
      priority: tpl.priority,
      status: 'not_started',
      startDate: at.slice(0, 10),
      dueDate: period.dueDate,
      estimateHours: tpl.estimateHours,
      checklist: tpl.checklist.map((label, i) => ({ id: `${id}_ck${i}`, label, done: false })),
      attachments: [],
      requiresReview: tpl.requiresReview && !!tpl.reviewerId && tpl.reviewerId !== assigneeId,
      filingStage: category?.isFiling ? 'preparation' : undefined,
      recurrence: { templateId: tpl.id, frequency: tpl.frequency, periodLabel: period.label },
      createdBy: me.id,
      createdAt: at,
      updatedAt: at,
      updatedBy: me.id,
    });
    log(ctx, { type: 'task_created', taskId: id, clientId: c.id, meta: { template: tpl.name } });
    notify(ctx, assigneeId, { type: 'assigned', title: 'New recurring task', body: `${tpl.name} — ${period.label} · ${c.name}`, taskId: id, clientId: c.id });
    created += 1;
  }
  // Scheduled runs only touch the template when they actually created something.
  if (created || !opts) tpl.lastGeneratedAt = now();
  return { created, period };
}

// ------------------------------------------------------- notes & reminders

function mine<T extends { userId: string }>(ctx: Ctx, item: T | undefined) {
  assert(!!item && item.userId === ctx.me.id, 'You can only change your own notes and reminders.');
  return item;
}

export function saveNote(ctx: Ctx, input: Omit<Note, 'id' | 'userId' | 'updatedAt'>, id?: string) {
  const p = pick<Note, 'title' | 'body' | 'color' | 'pinned' | 'clientId'>(input, ['title', 'body', 'color', 'pinned', 'clientId'] as const);
  if (!p.title?.trim() && !p.body?.trim()) fail('Write a title or some text for the note.');
  if (p.clientId) visibleClient(ctx, p.clientId);
  if (id) Object.assign(mine(ctx, ctx.db.notes.find((n) => n.id === id)), p, { updatedAt: now() });
  else ctx.db.notes.unshift({ title: '', body: '', color: 'yellow', pinned: false, ...p, id: ctx.newId('note'), userId: ctx.me.id, updatedAt: now() });
  return true;
}

export function deleteNote(ctx: Ctx, id: string) {
  mine(ctx, ctx.db.notes.find((n) => n.id === id));
  ctx.db.notes = ctx.db.notes.filter((n) => n.id !== id);
  return true;
}

export function saveReminder(ctx: Ctx, input: Omit<Reminder, 'id' | 'userId' | 'done'>) {
  const p = pick<Reminder, 'title' | 'dueAt' | 'clientId' | 'repeat'>(input, ['title', 'dueAt', 'clientId', 'repeat'] as const);
  if (!p.title?.trim()) fail('Reminder title is required.');
  if (!p.dueAt || Number.isNaN(Date.parse(p.dueAt))) fail('Choose when to be reminded.');
  if (p.clientId) visibleClient(ctx, p.clientId);
  ctx.db.reminders.push({ repeat: 'none', ...p, title: p.title.trim(), dueAt: p.dueAt, id: ctx.newId('rem'), userId: ctx.me.id, done: false });
  return true;
}

export function toggleReminder(ctx: Ctx, id: string) {
  const r = mine(ctx, ctx.db.reminders.find((x) => x.id === id));
  r.done = !r.done;
}

export function deleteReminder(ctx: Ctx, id: string) {
  mine(ctx, ctx.db.reminders.find((r) => r.id === id));
  ctx.db.reminders = ctx.db.reminders.filter((r) => r.id !== id);
}

// ----------------------------------------------------------------- portals

export function trackPortalOpen(ctx: Ctx, id: string) {
  found(ctx.db.portals.find((p) => p.id === id), 'Portal').clicks += 1;
}

/** host + path, lower-cased and without a trailing slash, for spotting the same site twice. */
function siteKey(url: string) {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export function savePortal(ctx: Ctx, input: Omit<Portal, 'id' | 'clicks' | 'hue'>) {
  assert(canManageMasters(ctx.me), 'Only users who manage masters can add portals.');
  const p = pick<Portal, 'name' | 'short' | 'url' | 'loginUrl' | 'description'>(input, ['name', 'short', 'url', 'loginUrl', 'description'] as const);
  const name = p.name?.trim();
  if (!name) fail('Portal name is required.');
  const isUrl = (v: string) => /^https?:\/\/[^\s]+$/.test(v) && siteKey(v) !== v.toLowerCase();
  if (!p.url || !isUrl(p.url)) fail('Enter a full website address starting with https://');
  const loginUrl = p.loginUrl?.trim() || undefined;
  if (loginUrl && !isUrl(loginUrl)) fail('Enter a full sign-in page address starting with https://');
  if (ctx.db.portals.some((x) => x.name.trim().toLowerCase() === name.toLowerCase())) fail(`A portal named “${name}” already exists.`);
  const dup = ctx.db.portals.find((x) => siteKey(x.url) === siteKey(p.url!) || (loginUrl && x.loginUrl && siteKey(x.loginUrl) === siteKey(loginUrl)));
  if (dup) fail(`That address is already saved as “${dup.name}”.`);
  const id = ctx.newId('portal');
  ctx.db.portals.push({ name, short: (p.short || name.slice(0, 4)).toUpperCase(), url: p.url, ...(loginUrl ? { loginUrl } : {}), description: p.description ?? '', id, clicks: 0, hue: Math.floor(Math.random() * 360) });
  return id;
}

// ----------------------------------------------------------------- notices

export function updateNotice(ctx: Ctx, id: string, patch: Partial<Pick<Notice, 'status' | 'assigneeId'>>) {
  const n = found(ctx.db.notices.find((x) => x.id === id), 'Notice');
  visibleClient(ctx, n.clientId);
  const p = pick<Notice, 'status' | 'assigneeId'>(patch, ['status', 'assigneeId'] as const);
  if (p.assigneeId) activeUser(ctx, p.assigneeId, 'Assignee');
  Object.assign(n, p);
  return true;
}

export function addNotice(ctx: Ctx, input: Pick<Notice, 'clientId' | 'source' | 'form' | 'subject' | 'reference' | 'issuedOn' | 'dueOn' | 'amount' | 'assigneeId'>) {
  visibleClient(ctx, input.clientId);
  if (!input.form?.trim() || !input.subject?.trim()) fail('Enter the notice form/section and subject.');
  if (input.assigneeId) activeUser(ctx, input.assigneeId, 'Assignee');
  const n: Notice = {
    id: ctx.newId('notice'),
    clientId: input.clientId,
    source: input.source,
    form: input.form.trim(),
    subject: input.subject.trim(),
    reference: input.reference?.trim() || '—',
    issuedOn: input.issuedOn,
    dueOn: input.dueOn,
    amount: input.amount || undefined,
    status: 'new',
    assigneeId: input.assigneeId,
    fetchedAt: now(),
  };
  ctx.db.notices.unshift(n);
  if (n.assigneeId) notify(ctx, n.assigneeId, { type: 'assigned', title: `${n.source} notice assigned`, body: `${n.form} — ${n.subject}`, clientId: n.clientId });
  return n;
}

/** Demo-only: simulates a portal sync. Real firms need a GST provider (GSP) connection. */
export function fetchNotices(ctx: Ctx) {
  if (!ctx.db.firm.isDemo) fail('Automatic notice fetching needs a GST/Income Tax provider connection. Add notices manually for now.');
  const pool: Omit<Notice, 'id' | 'fetchedAt' | 'issuedOn' | 'dueOn' | 'reference'>[] = [
    { clientId: 'c_nimbus', source: 'GST', form: 'GSTR-3A', subject: 'Notice for non-filing of GSTR-3B (Sep 2026)', status: 'new' },
    { clientId: 'c_horizon', source: 'Income Tax', form: '143(2)', subject: 'Notice for scrutiny assessment — AY 2025-26', status: 'new' },
    { clientId: 'c_arora', source: 'TDS', form: 'TRACES Intimation', subject: 'Late filing fee u/s 234E — Q2 FY 2026-27', status: 'new', amount: 4200 },
    { clientId: 'c_coastal', source: 'GST', form: 'DRC-01', subject: 'Summary of show cause notice — ITC on hotel renovation', status: 'new', amount: 215000 },
  ];
  const existing = new Set(ctx.db.notices.map((n) => n.clientId + n.form));
  const fresh = pool.filter((n) => ctx.db.clients.some((c) => c.id === n.clientId) && !existing.has(n.clientId + n.form)).slice(0, 2);
  const at = new Date();
  fresh.forEach((n) =>
    ctx.db.notices.unshift({
      ...n,
      id: ctx.newId('notice'),
      reference: `ZD${Math.floor(10000000 + Math.random() * 89999999)}`,
      issuedOn: at.toISOString().slice(0, 10),
      dueOn: new Date(at.getTime() + 15 * 86400000).toISOString().slice(0, 10),
      fetchedAt: at.toISOString(),
    }),
  );
  return fresh.length;
}

export function noticeToTask(ctx: Ctx, id: string) {
  const n = found(ctx.db.notices.find((x) => x.id === id), 'Notice');
  visibleClient(ctx, n.clientId);
  const assigneeId = n.assigneeId ?? ctx.me.id;
  const cat = n.source === 'GST' ? 'gst' : n.source === 'Income Tax' ? 'itr' : n.source === 'TDS' ? 'tds' : 'adv';
  const categoryId = ctx.db.categories.some((c) => c.id === cat) ? cat : ctx.db.categories[0]?.id;
  const reviewer = ctx.db.clients.find((c) => c.id === n.clientId)?.relationshipManagerId;
  const finalAssignee = canAssignTo(ctx.db, ctx.me, assigneeId) ? assigneeId : ctx.me.id;
  const withReview = !!reviewer && reviewer !== finalAssignee && reviewerCandidates(ctx.db).some((u) => u.id === reviewer);
  const t = createTask(ctx, {
    title: `Reply to ${n.form} notice`,
    description: `${n.subject}\nReference: ${n.reference}`,
    clientId: n.clientId,
    categoryId,
    assigneeId: finalAssignee,
    reviewerId: withReview ? reviewer : undefined,
    requiresReview: withReview,
    priority: 'high',
    startDate: today(),
    dueDate: n.dueOn < today() ? today() : n.dueOn,
    estimateHours: 4,
    checklist: ['Download notice & annexures', 'Collect supporting documents', 'Draft reply', 'Partner review', 'Submit reply on portal'],
  });
  Object.assign(n, { taskId: t.id, status: 'in_progress' });
  return t;
}

// ----------------------------------------------------------------- billing

export function createInvoice(ctx: Ctx, clientId: string, taskIds: string[]) {
  assert(canAccessBilling(ctx.me), 'You don’t have billing access.');
  const { db } = ctx;
  found(db.clients.find((c) => c.id === clientId), 'Client');
  const tasks = db.tasks.filter((t) => taskIds.includes(t.id) && t.clientId === clientId && !t.invoiceId && t.status === 'completed');
  if (!tasks.length) fail('Select at least one completed, unbilled task for this client.');
  const date = new Date();
  const y = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  const fy = `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
  const seq = db.invoices.filter((i) => i.number.includes(`/${fy}/`)).length + 1;
  const inv: Invoice = {
    id: ctx.newId('inv'),
    number: `${db.firm.invoicePrefix || 'INV'}/${fy}/${String(seq).padStart(4, '0')}`,
    clientId,
    date: date.toISOString().slice(0, 10),
    dueDate: new Date(date.getTime() + 15 * 86400000).toISOString().slice(0, 10),
    gstRate: db.firm.defaultGstRate ?? 18,
    items: tasks.map((t) => ({ taskId: t.id, description: t.title, amount: t.fee ?? 0 })),
  };
  db.invoices.push(inv);
  for (const t of tasks) t.invoiceId = inv.id;
  return inv;
}

export function recordPayment(ctx: Ctx, input: Omit<Payment, 'id'>) {
  assert(canAccessBilling(ctx.me), 'You don’t have billing access.');
  const p = pick<Payment, 'clientId' | 'invoiceId' | 'date' | 'amount' | 'mode' | 'kind' | 'reference'>(input, ['clientId', 'invoiceId', 'date', 'amount', 'mode', 'kind', 'reference'] as const);
  found(ctx.db.clients.find((c) => c.id === p.clientId), 'Client');
  if (!(Number(p.amount) > 0)) fail('Enter an amount greater than zero.');
  if (p.invoiceId && !ctx.db.invoices.some((i) => i.id === p.invoiceId && i.clientId === p.clientId)) fail('That invoice belongs to another client.');
  ctx.db.payments.push({ mode: 'NEFT', kind: 'receipt', reference: '—', date: today(), ...p, amount: Number(p.amount), clientId: p.clientId!, id: ctx.newId('pay') } as Payment);
  return true;
}

export function setTaskFee(ctx: Ctx, taskId: string, fee: number) {
  assert(canAccessBilling(ctx.me), 'You don’t have billing access.');
  const t = task(ctx, taskId);
  if (t.invoiceId) fail('This task is already invoiced.');
  t.fee = Math.max(0, Math.round(Number(fee) || 0));
}

// ------------------------------------------------- DSC & document register

export function saveDsc(ctx: Ctx, input: Omit<Dsc, 'id' | 'lastMovedAt'>, id?: string) {
  const p = pick<Dsc, 'clientId' | 'holder' | 'type' | 'provider' | 'tokenSerial' | 'issuedOn' | 'expiresOn' | 'custody'>(input, ['clientId', 'holder', 'type', 'provider', 'tokenSerial', 'issuedOn', 'expiresOn', 'custody'] as const);
  if (!p.holder?.trim()) fail('Holder name is required.');
  if (p.clientId) visibleClient(ctx, p.clientId);
  if (id) {
    const d = found(ctx.db.dscs.find((x) => x.id === id), 'DSC');
    visibleClient(ctx, d.clientId);
    Object.assign(d, p);
  } else {
    if (!p.clientId) fail('Choose a client.');
    ctx.db.dscs.push({ type: 'Signing', provider: '', tokenSerial: '', issuedOn: today(), expiresOn: today(), custody: 'firm', ...p, clientId: p.clientId, holder: p.holder.trim(), id: ctx.newId('dsc'), lastMovedAt: today() } as Dsc);
  }
  return true;
}

export function moveDsc(ctx: Ctx, id: string) {
  const x = found(ctx.db.dscs.find((y) => y.id === id), 'DSC');
  visibleClient(ctx, x.clientId);
  x.custody = x.custody === 'firm' ? 'client' : 'firm';
  x.lastMovedAt = today();
  return true;
}

export function addDocMovement(ctx: Ctx, input: Omit<DocMovement, 'id' | 'handledBy' | 'returned'>) {
  const p = pick<DocMovement, 'clientId' | 'document' | 'direction' | 'date' | 'mode' | 'person' | 'expectedReturn' | 'remarks'>(input, ['clientId', 'document', 'direction', 'date', 'mode', 'person', 'expectedReturn', 'remarks'] as const);
  visibleClient(ctx, p.clientId ?? '');
  if (!p.document?.trim()) fail('Describe the document.');
  if (!p.person?.trim()) fail('Enter who handed over or received it.');
  if (p.direction !== 'in' && p.direction !== 'out') fail('Choose in or out.');
  ctx.db.docMovements.unshift({ mode: 'By hand', date: today(), ...p, document: p.document.trim(), person: p.person.trim(), id: ctx.newId('doc'), handledBy: ctx.me.id, returned: p.direction === 'out' } as DocMovement);
  return true;
}

export function markDocReturned(ctx: Ctx, id: string) {
  const m = found(ctx.db.docMovements.find((x) => x.id === id), 'Register entry');
  visibleClient(ctx, m.clientId);
  if (m.direction !== 'in' || m.returned) fail('This entry is already closed.');
  m.returned = true;
  ctx.db.docMovements.unshift({ ...m, id: ctx.newId('doc'), direction: 'out', date: today(), handledBy: ctx.me.id, expectedReturn: undefined, returned: true });
  return true;
}

// ------------------------------------------------------- WhatsApp & drive

/** The firm number to send from; undefined means the server's default number. */
function sendingNumber(ctx: Ctx, numberId?: string) {
  if (!numberId) return undefined;
  const n = found(ctx.db.waNumbers.find((x) => x.id === numberId), 'WhatsApp number');
  if (n.status !== 'connected') fail(`${n.label || n.displayNumber} is disconnected. Reconnect it under WhatsApp → Numbers to send from it.`);
  return n.id;
}

export function sendChat(ctx: Ctx, clientId: string, body: string, numberId?: string) {
  assert(canUseWhatsApp(ctx.me), 'You don’t have WhatsApp access.');
  const client = visibleClient(ctx, clientId);
  if (client.exitDate) fail(`${client.name} has left the firm — messaging is switched off.`);
  if (!body.trim()) return;
  const from = sendingNumber(ctx, numberId);
  ctx.db.chats.push({ id: ctx.newId('wa'), clientId, direction: 'out', body: body.trim(), at: now(), status: 'sent', authorId: ctx.me.id, ...(from ? { numberId: from } : {}) });
  return true;
}

export function sendBroadcast(ctx: Ctx, input: { title: string; body: string; kind: Broadcast['kind']; clientIds: string[]; numberId?: string }) {
  assert(canUseWhatsApp(ctx.me), 'You don’t have WhatsApp access.');
  if (!input.body?.trim()) fail('Write a message to send.');
  const recipients = ctx.db.clients.filter((c) => input.clientIds.includes(c.id) && !c.exitDate && canViewClient(ctx.db, ctx.me, c));
  if (!recipients.length) fail('Choose at least one active client.');
  const from = sendingNumber(ctx, input.numberId);
  const at = now();
  ctx.db.broadcasts.unshift({ id: ctx.newId('bc'), title: input.title?.trim() || 'Broadcast', body: input.body, kind: input.kind, sentAt: at, recipients: recipients.length, sentBy: ctx.me.id });
  recipients.forEach((c) => ctx.db.chats.push({ id: ctx.newId('wa'), clientId: c.id, direction: 'out', body: input.body, at, status: 'sent', authorId: ctx.me.id, ...(from ? { numberId: from } : {}) }));
  return recipients.length;
}

/** Hands a conversation (one client on one number) to a team member, or back to the unassigned pool. */
export function assignWhatsAppThread(ctx: Ctx, clientId: string, numberId: string | undefined, assigneeId: string | undefined) {
  assert(canUseWhatsApp(ctx.me), 'You don’t have WhatsApp access.');
  const client = visibleClient(ctx, clientId);
  if (numberId) found(ctx.db.waNumbers.find((x) => x.id === numberId), 'WhatsApp number');
  if (assigneeId) {
    const u = activeUser(ctx, assigneeId, 'Team member');
    if (!canUseWhatsApp(u)) fail(`${u.name} doesn’t have WhatsApp access.`);
  }
  let t = ctx.db.waThreads.find((x) => x.clientId === clientId && (x.numberId ?? '') === (numberId ?? ''));
  if (!t) {
    t = { id: ctx.newId('wat'), clientId, ...(numberId ? { numberId } : {}), updatedAt: now() };
    ctx.db.waThreads.push(t);
  }
  t.assigneeId = assigneeId || undefined;
  t.updatedAt = now();
  if (assigneeId) notify(ctx, assigneeId, { type: 'assigned', title: `WhatsApp chat with ${client.name} assigned to you`, body: `${ctx.me.name} handed you this conversation`, clientId });
  return true;
}

const cleanFolder = (f: string) =>
  (f || 'General')
    .split('/')
    .map((s) => s.trim().replace(/[^\w .()&-]/g, ''))
    .filter((s) => s && s !== '.' && s !== '..')
    .join('/')
    .slice(0, 120) || 'General';

export function addDriveFiles(ctx: Ctx, clientId: string, folder: string, files: { name: string; sizeKb: number; fileId?: string }[]) {
  visibleClient(ctx, clientId);
  const dir = cleanFolder(folder);
  for (const f of files)
    ctx.db.drive.push({ id: ctx.newId('file'), clientId, folder: dir, name: f.name.slice(0, 200), sizeKb: Math.max(1, Math.round(f.sizeKb)), uploadedBy: ctx.me.id, uploadedAt: now(), fileId: f.fileId });
  return files.length;
}

export function deleteDriveFile(ctx: Ctx, id: string) {
  assert(permissionsOf(ctx.me).deleteRecords, 'You don’t have permission to delete files.');
  const f = found(ctx.db.drive.find((x) => x.id === id), 'File');
  visibleClient(ctx, f.clientId);
  ctx.db.drive = ctx.db.drive.filter((x) => x.id !== id);
  return true;
}

// ----------------------------------------------------------------- masters

export function saveService(ctx: Ctx, input: Omit<Service, 'id'>, id?: string) {
  assert(canManageMasters(ctx.me), 'You don’t have permission to manage masters.');
  const p = pick<Service, 'groupId' | 'name' | 'frequency' | 'defaultFee'>(input, ['groupId', 'name', 'frequency', 'defaultFee'] as const);
  if (!p.name?.trim()) fail('Service name is required.');
  if (p.groupId) found(ctx.db.categories.find((c) => c.id === p.groupId), 'Group');
  if (id) Object.assign(found(ctx.db.services.find((x) => x.id === id), 'Service'), p);
  else ctx.db.services.push({ frequency: 'Monthly', defaultFee: 0, ...p, groupId: p.groupId ?? fail('Choose a group.'), name: p.name.trim(), id: ctx.newId('svc') });
  return true;
}

export function deleteService(ctx: Ctx, id: string) {
  assert(canManageMasters(ctx.me), 'You don’t have permission to manage masters.');
  if (ctx.db.tasks.some((t) => t.serviceId === id && t.status !== 'completed')) fail('This service has open tasks. Complete or move them first.');
  ctx.db.services = ctx.db.services.filter((x) => x.id !== id);
  return true;
}

export function saveReferrer(ctx: Ctx, input: Omit<Referrer, 'id'>, id?: string) {
  assert(canManageMasters(ctx.me), 'You don’t have permission to manage masters.');
  const p = pick<Referrer, 'name' | 'firmName' | 'mobile' | 'email' | 'address'>(input, ['name', 'firmName', 'mobile', 'email', 'address'] as const);
  if (!p.name?.trim()) fail('Name is required.');
  if (id) Object.assign(found(ctx.db.referrers.find((x) => x.id === id), 'Referrer'), p);
  else ctx.db.referrers.push({ firmName: '', mobile: '', email: '', address: '', ...p, name: p.name.trim(), id: ctx.newId('ref') });
  return true;
}

export function deleteReferrer(ctx: Ctx, id: string) {
  assert(canManageMasters(ctx.me), 'You don’t have permission to manage masters.');
  ctx.db.referrers = ctx.db.referrers.filter((x) => x.id !== id);
  ctx.db.clients.forEach((c) => c.referredById === id && (c.referredById = undefined));
  return true;
}

/** Every command, keyed by the name used in the API (`POST /api/commands/:name`). */
export const commands = {
  createTask,
  updateTask,
  transitionTask,
  setFilingStage,
  toggleChecklistItem,
  addChecklistItem,
  removeChecklistItem,
  addComment,
  addAttachment,
  removeAttachment,
  bulkReassign,
  deleteTask,
  createClient,
  updateClient,
  setClientExit,
  requestDocument,
  setDocumentStatus,
  inviteMember,
  updateMember,
  deleteMember,
  updateFirm,
  addCategory,
  markNotificationRead,
  markAllNotificationsRead,
  saveTemplate,
  generateFromTemplate,
  saveNote,
  deleteNote,
  saveReminder,
  toggleReminder,
  deleteReminder,
  trackPortalOpen,
  savePortal,
  updateNotice,
  addNotice,
  fetchNotices,
  noticeToTask,
  createInvoice,
  recordPayment,
  setTaskFee,
  saveDsc,
  moveDsc,
  addDocMovement,
  markDocReturned,
  sendChat,
  sendBroadcast,
  assignWhatsAppThread,
  addDriveFiles,
  deleteDriveFile,
  saveService,
  deleteService,
  saveReferrer,
  deleteReferrer,
} as const;

export type Commands = typeof commands;
export type CommandName = keyof Commands;
export type CommandArgs<N extends CommandName> = Commands[N] extends (ctx: Ctx, ...args: infer A) => unknown ? A : never;
export type CommandResult<N extends CommandName> = ReturnType<Commands[N]>;
