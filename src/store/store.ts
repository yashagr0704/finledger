import { useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { brand } from '@/config/brand';
import { localRepository, sessionStore, type DataRepository } from '@/data/repository';
import { formatDate } from '@/lib/dates';
import { STATUS_LONG_LABEL } from '@/lib/constants';
import {
  assert,
  canAssignTo,
  canBulkReassign,
  canCreateClient,
  canCreateTask,
  canDeleteTask,
  canEditClient,
  canEditTask,
  canManageDocuments,
  canManageFirm,
  canManageTeam,
  canManageTemplates,
  canAccessBilling,
  canManageMasters,
  canUseWhatsApp,
  permissionsOf,
  canViewTask,
  canWorkOnTask,
  PermissionError,
  taskableClients,
} from '@/lib/permissions';
import { upcomingPeriods } from '@/lib/periods';
import { uid } from '@/lib/utils';
import { canTransition } from '@/lib/workflow';
import type {
  Activity,
  AppNotification,
  Broadcast,
  DocMovement,
  Dsc,
  Invoice,
  Note,
  Notice,
  Payment,
  Portal,
  Referrer,
  Reminder,
  Service,
  Client,
  Database,
  DocumentRequest,
  FilingStage,
  Firm,
  Role,
  Task,
  TaskStatus,
  TaskTemplate,
  User,
} from '@/types';

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

interface State {
  db: Database;
  currentUserId: string;
}

type Listener = () => void;

/**
 * Central application store. All mutations go through these actions, which
 * check permissions, record activity, emit (simulated, in-app) notifications
 * and persist through the repository.
 */
class LedgerStore {
  private state: State;
  private listeners = new Set<Listener>();

  constructor(private repo: DataRepository) {
    const db = repo.load();
    const saved = sessionStore.getUserId();
    const currentUserId = db.users.some((u) => u.id === saved && u.status === 'active') ? saved! : db.users.find((u) => u.role === 'admin')!.id;
    this.state = { db, currentUserId };
  }

  getState = () => this.state;

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private emit() {
    this.listeners.forEach((l) => l());
  }

  get me(): User {
    return this.state.db.users.find((u) => u.id === this.state.currentUserId)!;
  }

  private commit(mutate: (db: Database) => void) {
    const next = structuredClone(this.state.db);
    mutate(next);
    this.state = { ...this.state, db: next };
    this.repo.save(next);
    this.emit();
  }

  /** Runs an action, converting permission and validation errors into toasts. */
  private run<T>(fn: () => T): T | undefined {
    try {
      return fn();
    } catch (e) {
      if (e instanceof PermissionError) {
        toast.error('Not allowed', { description: e.message });
        return undefined;
      }
      if (e instanceof Error) {
        toast.error(e.message);
        return undefined;
      }
      throw e;
    }
  }

  private log(db: Database, a: Omit<Activity, 'id' | 'createdAt' | 'actorId'>) {
    db.activities.unshift({ id: uid('act'), createdAt: new Date().toISOString(), actorId: this.me.id, ...a });
  }

  private notify(db: Database, userId: string | undefined, n: Omit<AppNotification, 'id' | 'createdAt' | 'read' | 'userId'>) {
    if (!userId || userId === this.me.id) return;
    db.notifications.unshift({ id: uid('ntf'), userId, createdAt: new Date().toISOString(), read: false, ...n });
  }

  private nextTaskId(db: Database) {
    const max = db.tasks.reduce((m, t) => Math.max(m, Number(t.id.split('-')[1]) || 0), 1000);
    return `${brand.taskPrefix}-${max + 1}`;
  }

  // ---------------------------------------------------------------- session

  switchUser = (userId: string) => {
    const user = this.state.db.users.find((u) => u.id === userId);
    if (!user || user.status !== 'active') return;
    sessionStore.setUserId(userId);
    this.state = { ...this.state, currentUserId: userId };
    this.emit();
  };

  resetDemo = () => {
    const db = this.repo.reset();
    const admin = db.users.find((u) => u.role === 'admin')!;
    sessionStore.setUserId(admin.id);
    this.state = { db, currentUserId: admin.id };
    this.emit();
  };

  // ------------------------------------------------------------------ tasks

  createTask = (input: TaskInput) =>
    this.run(() => {
      const { db } = this.state;
      assert(canCreateTask(this.me), 'Only admins and managers can create tasks.');
      assert(taskableClients(db, this.me).some((c) => c.id === input.clientId), 'You cannot create tasks for this client.');
      assert(canAssignTo(db, this.me, input.assigneeId), 'You cannot assign work to this person.');
      const now = new Date().toISOString();
      const id = this.nextTaskId(db);
      const category = db.categories.find((c) => c.id === input.categoryId);
      const task: Task = {
        id,
        title: input.title.trim(),
        description: input.description.trim(),
        clientId: input.clientId,
        categoryId: input.categoryId,
        assigneeId: input.assigneeId,
        reviewerId: input.requiresReview ? input.reviewerId : undefined,
        priority: input.priority,
        status: 'not_started',
        startDate: input.startDate,
        dueDate: input.dueDate,
        estimateHours: input.estimateHours,
        checklist: input.checklist.filter(Boolean).map((label, i) => ({ id: `${id}_ck${i}`, label, done: false })),
        attachments: [],
        requiresReview: input.requiresReview,
        filingStage: category?.isFiling ? 'preparation' : undefined,
        serviceId: input.serviceId,
        fee: input.fee ?? db.services.find((s) => s.id === input.serviceId)?.defaultFee,
        createdBy: this.me.id,
        createdAt: now,
        updatedAt: now,
        updatedBy: this.me.id,
      };
      this.commit((d) => {
        d.tasks.push(task);
        this.log(d, { type: 'task_created', taskId: id, clientId: task.clientId });
        this.notify(d, task.assigneeId, { type: 'assigned', title: 'New task assigned', body: `${task.title} · due ${formatDate(task.dueDate, 'd MMM')}`, taskId: id, clientId: task.clientId });
      });
      return task;
    });

  updateTask = (id: string, patch: Partial<TaskInput>) =>
    this.run(() => {
      const { db } = this.state;
      const task = db.tasks.find((t) => t.id === id);
      assert(!!task, 'Task not found.');
      assert(canEditTask(db, this.me, task), 'You cannot edit this task.');
      if (patch.assigneeId && patch.assigneeId !== task.assigneeId) assert(canAssignTo(db, this.me, patch.assigneeId), 'You cannot assign work to this person.');
      this.commit((d) => {
        const t = d.tasks.find((x) => x.id === id)!;
        const prev = { ...t };
        if (patch.title !== undefined) t.title = patch.title.trim();
        if (patch.description !== undefined) t.description = patch.description.trim();
        if (patch.clientId !== undefined) t.clientId = patch.clientId;
        if (patch.categoryId !== undefined) t.categoryId = patch.categoryId;
        if (patch.serviceId !== undefined) t.serviceId = patch.serviceId || undefined;
        if (patch.priority !== undefined) t.priority = patch.priority;
        if (patch.startDate !== undefined) t.startDate = patch.startDate;
        if (patch.estimateHours !== undefined) t.estimateHours = patch.estimateHours;
        if (patch.requiresReview !== undefined) t.requiresReview = patch.requiresReview;
        if (patch.reviewerId !== undefined || patch.requiresReview !== undefined) t.reviewerId = t.requiresReview ? (patch.reviewerId ?? t.reviewerId) : undefined;
        if (patch.assigneeId && patch.assigneeId !== prev.assigneeId) {
          t.assigneeId = patch.assigneeId;
          this.log(d, { type: 'reassigned', taskId: id, clientId: t.clientId, meta: { from: prev.assigneeId, to: t.assigneeId } });
          this.notify(d, t.assigneeId, { type: 'assigned', title: 'Task reassigned to you', body: `${t.title} · due ${formatDate(t.dueDate, 'd MMM')}`, taskId: id, clientId: t.clientId });
        }
        if (patch.dueDate && patch.dueDate !== prev.dueDate) {
          t.dueDate = patch.dueDate;
          this.log(d, { type: 'due_changed', taskId: id, clientId: t.clientId, meta: { from: prev.dueDate, to: t.dueDate } });
          this.notify(d, t.assigneeId, { type: 'due_changed', title: 'Deadline changed', body: `${t.title} is now due ${formatDate(t.dueDate, 'd MMM yyyy')}`, taskId: id, clientId: t.clientId });
        }
        const otherChange = (['title', 'description', 'priority', 'categoryId', 'estimateHours', 'reviewerId', 'requiresReview', 'clientId', 'startDate'] as const).some(
          (k) => String(prev[k] ?? '') !== String(t[k] ?? ''),
        );
        if (otherChange) this.log(d, { type: 'task_updated', taskId: id, clientId: t.clientId });
        t.updatedAt = new Date().toISOString();
        t.updatedBy = this.me.id;
      });
      return true;
    });

  transitionTask = (id: string, to: TaskStatus, note?: string) =>
    this.run(() => {
      const { db } = this.state;
      const task = db.tasks.find((t) => t.id === id);
      assert(!!task, 'Task not found.');
      const tr = canTransition(db, this.me, task, to);
      assert(!!tr, `You can’t move this task to ${STATUS_LONG_LABEL[to]}.`);
      if (tr.requiresNote) {
        if (!note?.trim()) throw new Error('An explanation is required when returning work.');
      }
      const from = task.status;
      this.commit((d) => {
        const t = d.tasks.find((x) => x.id === id)!;
        const now = new Date().toISOString();
        t.status = to;
        t.updatedAt = now;
        t.updatedBy = this.me.id;
        if (to === 'in_review') {
          t.submittedAt = now;
          if (t.filingStage === 'preparation') t.filingStage = 'review';
          this.notify(d, t.reviewerId, { type: 'submitted', title: 'Submitted for review', body: `${this.me.name} submitted ${t.title}`, taskId: id, clientId: t.clientId });
        }
        if (from === 'in_review' && (to === 'completed' || to === 'changes_requested')) {
          const decision = to === 'completed' ? 'approved' : 'returned';
          d.reviews.push({ id: uid('rev'), taskId: id, reviewerId: this.me.id, submittedAt: t.submittedAt ?? now, decidedAt: now, decision, note: note?.trim() });
          this.log(d, { type: decision === 'approved' ? 'review_approved' : 'review_returned', taskId: id, clientId: t.clientId, meta: note ? { note: note.trim() } : undefined });
          if (decision === 'approved') {
            if (t.filingStage === 'review' || t.filingStage === 'preparation') t.filingStage = 'ready_to_file';
            this.notify(d, t.assigneeId, { type: 'approved', title: 'Review approved', body: `${this.me.name} approved ${t.title}`, taskId: id, clientId: t.clientId });
          } else {
            d.comments.push({ id: uid('cmt'), taskId: id, authorId: this.me.id, body: note!.trim(), createdAt: now });
            this.notify(d, t.assigneeId, { type: 'changes_requested', title: 'Changes requested', body: `${this.me.name}: “${note!.trim().slice(0, 80)}”`, taskId: id, clientId: t.clientId });
          }
        } else {
          this.log(d, { type: 'status_changed', taskId: id, clientId: t.clientId, meta: { from, to } });
        }
        if (to === 'completed') t.completedAt = now;
        if (from === 'completed') t.completedAt = undefined;
      });
      return true;
    });

  setFilingStage = (id: string, stage: FilingStage, reference?: string) =>
    this.run(() => {
      const { db } = this.state;
      const task = db.tasks.find((t) => t.id === id);
      assert(!!task, 'Task not found.');
      assert(canWorkOnTask(db, this.me, task), 'You cannot update this filing.');
      if ((stage === 'filed' || stage === 'ready_to_file') && task.requiresReview && task.status !== 'completed')
        throw new Error('Internal review must be approved before the filing can be marked Ready to File or Filed.');
      this.commit((d) => {
        const t = d.tasks.find((x) => x.id === id)!;
        const prev = t.filingStage;
        t.filingStage = stage;
        if (reference !== undefined) t.filingReference = reference.trim() || undefined;
        t.updatedAt = new Date().toISOString();
        t.updatedBy = this.me.id;
        this.log(d, { type: 'filing_updated', taskId: id, clientId: t.clientId, meta: { from: prev ?? '', to: stage } });
      });
      return true;
    });

  toggleChecklistItem = (taskId: string, itemId: string) =>
    this.run(() => {
      const { db } = this.state;
      const task = db.tasks.find((t) => t.id === taskId);
      assert(!!task && canWorkOnTask(db, this.me, task), 'You cannot update this checklist.');
      this.commit((d) => {
        const t = d.tasks.find((x) => x.id === taskId)!;
        const item = t.checklist.find((c) => c.id === itemId);
        if (item) item.done = !item.done;
        t.updatedAt = new Date().toISOString();
        t.updatedBy = this.me.id;
      });
    });

  addChecklistItem = (taskId: string, label: string) =>
    this.run(() => {
      const { db } = this.state;
      const task = db.tasks.find((t) => t.id === taskId);
      assert(!!task && canWorkOnTask(db, this.me, task), 'You cannot update this checklist.');
      if (!label.trim()) return;
      this.commit((d) => {
        const t = d.tasks.find((x) => x.id === taskId)!;
        t.checklist.push({ id: uid('ck'), label: label.trim(), done: false });
        t.updatedAt = new Date().toISOString();
        t.updatedBy = this.me.id;
        this.log(d, { type: 'checklist_updated', taskId, clientId: t.clientId, meta: { name: label.trim() } });
      });
    });

  removeChecklistItem = (taskId: string, itemId: string) =>
    this.run(() => {
      const { db } = this.state;
      const task = db.tasks.find((t) => t.id === taskId);
      assert(!!task && canWorkOnTask(db, this.me, task), 'You cannot update this checklist.');
      this.commit((d) => {
        const t = d.tasks.find((x) => x.id === taskId)!;
        t.checklist = t.checklist.filter((c) => c.id !== itemId);
      });
    });

  addComment = (taskId: string, body: string) =>
    this.run(() => {
      const { db } = this.state;
      const task = db.tasks.find((t) => t.id === taskId);
      assert(!!task && canViewTask(db, this.me, task), 'You cannot comment on this task.');
      if (!body.trim()) throw new Error('Comment cannot be empty.');
      this.commit((d) => {
        const t = d.tasks.find((x) => x.id === taskId)!;
        d.comments.push({ id: uid('cmt'), taskId, authorId: this.me.id, body: body.trim(), createdAt: new Date().toISOString() });
        this.log(d, { type: 'commented', taskId, clientId: t.clientId });
        const preview = `${this.me.name}: “${body.trim().slice(0, 80)}”`;
        for (const target of new Set([t.assigneeId, t.reviewerId])) this.notify(d, target, { type: 'comment', title: 'New comment', body: preview, taskId, clientId: t.clientId });
      });
      return true;
    });

  addAttachment = (taskId: string, file: { name: string; sizeKb: number }) =>
    this.run(() => {
      const { db } = this.state;
      const task = db.tasks.find((t) => t.id === taskId);
      assert(!!task && canWorkOnTask(db, this.me, task), 'You cannot add files to this task.');
      this.commit((d) => {
        const t = d.tasks.find((x) => x.id === taskId)!;
        const now = new Date().toISOString();
        t.attachments.push({ id: uid('att'), name: file.name, sizeKb: Math.max(1, Math.round(file.sizeKb)), uploadedBy: this.me.id, uploadedAt: now });
        t.updatedAt = now;
        t.updatedBy = this.me.id;
        this.log(d, { type: 'attachment_added', taskId, clientId: t.clientId, meta: { name: file.name } });
        for (const target of new Set([t.assigneeId, t.reviewerId])) this.notify(d, target, { type: 'document', title: 'Document uploaded', body: `${this.me.name} added ${file.name} to ${t.title}`, taskId, clientId: t.clientId });
      });
      return true;
    });

  removeAttachment = (taskId: string, attachmentId: string) =>
    this.run(() => {
      const { db } = this.state;
      const task = db.tasks.find((t) => t.id === taskId);
      assert(!!task && canWorkOnTask(db, this.me, task), 'You cannot remove files from this task.');
      this.commit((d) => {
        const t = d.tasks.find((x) => x.id === taskId)!;
        t.attachments = t.attachments.filter((a) => a.id !== attachmentId);
      });
    });

  bulkReassign = (ids: string[], assigneeId: string) =>
    this.run(() => {
      const { db } = this.state;
      assert(canBulkReassign(this.me), 'Only admins and managers can reassign tasks.');
      assert(canAssignTo(db, this.me, assigneeId), 'You cannot assign work to this person.');
      const editable = ids.filter((id) => {
        const t = db.tasks.find((x) => x.id === id);
        return t && canEditTask(db, this.me, t) && t.assigneeId !== assigneeId;
      });
      this.commit((d) => {
        for (const id of editable) {
          const t = d.tasks.find((x) => x.id === id)!;
          const from = t.assigneeId;
          t.assigneeId = assigneeId;
          t.updatedAt = new Date().toISOString();
          t.updatedBy = this.me.id;
          this.log(d, { type: 'reassigned', taskId: id, clientId: t.clientId, meta: { from, to: assigneeId } });
        }
        if (editable.length) this.notify(d, assigneeId, { type: 'assigned', title: `${editable.length} tasks reassigned to you`, body: `${this.me.name} moved work to your queue`, taskId: editable[0] });
      });
      return editable.length;
    });

  deleteTask = (id: string) =>
    this.run(() => {
      assert(canDeleteTask(this.me), 'Only firm admins can delete tasks.');
      this.commit((d) => {
        d.tasks = d.tasks.filter((t) => t.id !== id);
        d.comments = d.comments.filter((c) => c.taskId !== id);
        d.notifications = d.notifications.filter((n) => n.taskId !== id);
        d.documents = d.documents.map((doc) => (doc.taskId === id ? { ...doc, taskId: undefined } : doc));
      });
      return true;
    });

  // ---------------------------------------------------------------- clients

  createClient = (input: ClientInput) =>
    this.run(() => {
      assert(canCreateClient(this.me), 'Only firm admins can add clients.');
      const { db } = this.state;
      const code = input.code.trim().toUpperCase();
      if (db.clients.some((c) => c.code === code)) throw new Error(`Client code ${code} is already in use.`);
      const client: Client = { ...input, code, id: uid('cl'), since: new Date().toISOString().slice(0, 10) };
      this.commit((d) => {
        d.clients.push(client);
        this.log(d, { type: 'client_created', clientId: client.id });
      });
      return client;
    });

  updateClient = (id: string, patch: Partial<ClientInput>) =>
    this.run(() => {
      const { db } = this.state;
      const client = db.clients.find((c) => c.id === id);
      assert(!!client && canEditClient(this.me, client), 'You cannot edit this client.');
      if (patch.code && db.clients.some((c) => c.id !== id && c.code === patch.code!.trim().toUpperCase())) throw new Error('That client code is already in use.');
      this.commit((d) => {
        const c = d.clients.find((x) => x.id === id)!;
        Object.assign(c, patch, patch.code ? { code: patch.code.trim().toUpperCase() } : {});
        this.log(d, { type: 'client_updated', clientId: id });
      });
      return true;
    });

  requestDocument = (input: { clientId: string; taskId?: string; name: string; dueDate?: string }) =>
    this.run(() => {
      const { db } = this.state;
      const client = db.clients.find((c) => c.id === input.clientId);
      assert(!!client && canManageDocuments(db, this.me, client), 'You cannot request documents for this client.');
      if (!input.name.trim()) throw new Error('Document name is required.');
      const doc: DocumentRequest = { id: uid('doc'), clientId: input.clientId, taskId: input.taskId, name: input.name.trim(), dueDate: input.dueDate, status: 'pending', requestedAt: new Date().toISOString() };
      this.commit((d) => {
        d.documents.push(doc);
        this.log(d, { type: 'document_requested', clientId: doc.clientId, taskId: doc.taskId, meta: { name: doc.name } });
      });
      return doc;
    });

  setDocumentStatus = (docId: string, status: DocumentRequest['status']) =>
    this.run(() => {
      const { db } = this.state;
      const doc = db.documents.find((x) => x.id === docId);
      const client = doc && db.clients.find((c) => c.id === doc.clientId);
      assert(!!doc && !!client && canManageDocuments(db, this.me, client), 'You cannot update this document request.');
      this.commit((d) => {
        const x = d.documents.find((y) => y.id === docId)!;
        x.status = status;
        x.receivedAt = status === 'received' ? new Date().toISOString() : undefined;
        if (status === 'received') {
          this.log(d, { type: 'document_received', clientId: x.clientId, taskId: x.taskId, meta: { name: x.name } });
          const t = x.taskId ? d.tasks.find((tt) => tt.id === x.taskId) : undefined;
          if (t) this.notify(d, t.assigneeId, { type: 'document', title: 'Document received', body: `${x.name} received from ${client.name}`, taskId: t.id, clientId: x.clientId });
        }
      });
      return true;
    });

  // ------------------------------------------------------------------- team

  inviteMember = (input: { name: string; email: string; role: Role; title: string; managerId?: string } & Partial<Pick<User, 'phone' | 'address' | 'aadhaar' | 'pan' | 'username' | 'permissions'>>) =>
    this.run(() => {
      assert(canManageTeam(this.me), 'Only firm admins can invite team members.');
      const { db } = this.state;
      const email = input.email.trim().toLowerCase();
      if (db.users.some((u) => u.email.toLowerCase() === email)) throw new Error('Someone with this email is already on the team.');
      const user: User = {
        id: uid('usr'),
        name: input.name.trim(),
        email,
        phone: input.phone ?? '',
        address: input.address,
        aadhaar: input.aadhaar,
        pan: input.pan,
        username: input.username || email.split('@')[0],
        permissions: input.permissions,
        role: input.role,
        title: input.title.trim() || (input.role === 'employee' ? 'Associate' : 'Manager'),
        managerId: input.role === 'employee' ? input.managerId : undefined,
        status: 'invited',
        joinedAt: new Date().toISOString().slice(0, 10),
        capacityHours: 45,
        avatarHue: Math.floor(Math.random() * 360),
      };
      this.commit((d) => {
        d.users.push(user);
        this.log(d, { type: 'member_invited', userId: user.id });
      });
      return user;
    });

  updateMember = (userId: string, patch: Partial<Pick<User, 'role' | 'status' | 'title' | 'managerId' | 'capacityHours' | 'name' | 'email' | 'phone' | 'address' | 'aadhaar' | 'pan' | 'username' | 'permissions'>>) =>
    this.run(() => {
      assert(canManageTeam(this.me), 'Only firm admins can manage team members.');
      const { db } = this.state;
      const user = db.users.find((u) => u.id === userId);
      assert(!!user, 'Member not found.');
      if (userId === this.me.id && (patch.role && patch.role !== 'admin' || patch.status === 'deactivated')) throw new Error('You cannot remove your own admin access.');
      const admins = db.users.filter((u) => u.role === 'admin' && u.status === 'active');
      if (user.role === 'admin' && admins.length === 1 && ((patch.role && patch.role !== 'admin') || patch.status === 'deactivated')) throw new Error('The firm must keep at least one active admin.');
      if (patch.status === 'deactivated') {
        const open = db.tasks.filter((t) => t.assigneeId === userId && t.status !== 'completed').length;
        if (open) throw new Error(`Reassign ${open} open task${open > 1 ? 's' : ''} before deactivating this member.`);
      }
      this.commit((d) => {
        const u = d.users.find((x) => x.id === userId)!;
        Object.assign(u, patch);
        if (u.role !== 'employee') u.managerId = undefined;
        this.log(d, { type: 'member_updated', userId, meta: Object.fromEntries(Object.entries(patch).filter(([k]) => k === 'role' || k === 'status').map(([k, v]) => [k, String(v ?? '')])) });
      });
      return true;
    });

  updateFirm = (patch: Partial<Firm>) =>
    this.run(() => {
      assert(canManageFirm(this.me), 'Only firm admins can change firm settings.');
      this.commit((d) => Object.assign(d.firm, patch));
      return true;
    });

  addCategory = (name: string, isFiling: boolean) =>
    this.run(() => {
      assert(canManageFirm(this.me), 'Only firm admins can manage categories.');
      const { db } = this.state;
      if (!name.trim()) throw new Error('Category name is required.');
      if (db.categories.some((c) => c.name.toLowerCase() === name.trim().toLowerCase())) throw new Error('That category already exists.');
      this.commit((d) => {
        d.categories.push({ id: uid('cat'), name: name.trim(), isFiling, colorSlot: d.categories.length % 8 });
      });
      return true;
    });

  // ------------------------------------------------------------ notifications

  markNotificationRead = (id: string, read = true) => {
    this.commit((d) => {
      const n = d.notifications.find((x) => x.id === id && x.userId === this.me.id);
      if (n) n.read = read;
    });
  };

  markAllNotificationsRead = () => {
    this.commit((d) => {
      d.notifications.forEach((n) => {
        if (n.userId === this.me.id) n.read = true;
      });
    });
  };

  // -------------------------------------------------------------- templates

  saveTemplate = (input: TemplateInput, id?: string) =>
    this.run(() => {
      assert(canManageTemplates(this.me), 'Only firm admins can manage templates.');
      let saved!: TaskTemplate;
      this.commit((d) => {
        if (id) {
          const t = d.templates.find((x) => x.id === id)!;
          Object.assign(t, input);
          saved = t;
        } else {
          saved = { ...input, id: uid('tpl'), createdAt: new Date().toISOString() };
          d.templates.push(saved);
        }
      });
      return saved;
    });

  /**
   * Simulated recurring generation: creates tasks for the next due period of
   * a template for every applicable client that doesn't already have one.
   * There is no background scheduler in the demo — this runs on demand.
   */
  generateFromTemplate = (templateId: string) =>
    this.run(() => {
      assert(canManageTemplates(this.me), 'Only firm admins can generate recurring tasks.');
      const { db } = this.state;
      const tpl = db.templates.find((t) => t.id === templateId);
      assert(!!tpl, 'Template not found.');
      const [period] = upcomingPeriods(tpl, new Date(), 1);
      if (!period) throw new Error('No upcoming period for this schedule.');
      const targets = db.clients.filter(
        (c) =>
          c.status !== 'inactive' &&
          tpl.entityTypes.includes(c.entityType) &&
          !db.tasks.some((t) => t.clientId === c.id && t.recurrence?.templateId === tpl.id && t.recurrence.periodLabel === period.label),
      );
      let created = 0;
      this.commit((d) => {
        for (const c of targets) {
          const id = this.nextTaskId(d);
          const assigneeId =
            tpl.assignmentRule === 'relationship_manager' ? c.relationshipManagerId : tpl.assignmentRule === 'fixed' && tpl.defaultAssigneeId ? tpl.defaultAssigneeId : this.me.id;
          const now = new Date().toISOString();
          const category = d.categories.find((x) => x.id === tpl.categoryId);
          d.tasks.push({
            id,
            title: `${tpl.name} — ${period.label}`,
            description: tpl.description,
            clientId: c.id,
            categoryId: tpl.categoryId,
            assigneeId,
            reviewerId: tpl.requiresReview ? tpl.reviewerId : undefined,
            priority: tpl.priority,
            status: 'not_started',
            startDate: now.slice(0, 10),
            dueDate: period.dueDate,
            estimateHours: tpl.estimateHours,
            checklist: tpl.checklist.map((label, i) => ({ id: `${id}_ck${i}`, label, done: false })),
            attachments: [],
            requiresReview: tpl.requiresReview && !!tpl.reviewerId,
            filingStage: category?.isFiling ? 'preparation' : undefined,
            recurrence: { templateId: tpl.id, frequency: tpl.frequency, periodLabel: period.label },
            createdBy: this.me.id,
            createdAt: now,
            updatedAt: now,
            updatedBy: this.me.id,
          });
          this.log(d, { type: 'task_created', taskId: id, clientId: c.id, meta: { template: tpl.name } });
          this.notify(d, assigneeId, { type: 'assigned', title: 'New recurring task', body: `${tpl.name} — ${period.label} · ${c.name}`, taskId: id, clientId: c.id });
          created += 1;
        }
        const t = d.templates.find((x) => x.id === templateId)!;
        t.lastGeneratedAt = new Date().toISOString();
      });
      return { created, period };
    });

  // ------------------------------------------------- design-brief modules (demo)

  private mine<T extends { userId: string }>(item: T | undefined) {
    assert(!!item && item.userId === this.me.id, 'You can only change your own notes and reminders.');
  }

  saveNote = (input: Omit<Note, 'id' | 'userId' | 'updatedAt'>, id?: string) =>
    this.run(() => {
      if (!input.title.trim() && !input.body.trim()) throw new Error('Write a title or some text for the note.');
      if (id) this.mine(this.state.db.notes.find((n) => n.id === id));
      this.commit((d) => {
        const now = new Date().toISOString();
        if (id) Object.assign(d.notes.find((n) => n.id === id)!, input, { updatedAt: now });
        else d.notes.unshift({ ...input, id: uid('note'), userId: this.me.id, updatedAt: now });
      });
      return true;
    });

  deleteNote = (id: string) =>
    this.run(() => {
      this.mine(this.state.db.notes.find((n) => n.id === id));
      this.commit((d) => void (d.notes = d.notes.filter((n) => n.id !== id)));
      return true;
    });

  saveReminder = (input: Omit<Reminder, 'id' | 'userId' | 'done'>) =>
    this.run(() => {
      if (!input.title.trim()) throw new Error('Reminder title is required.');
      this.commit((d) => void d.reminders.push({ ...input, id: uid('rem'), userId: this.me.id, done: false }));
      return true;
    });

  toggleReminder = (id: string) =>
    this.run(() => {
      this.mine(this.state.db.reminders.find((r) => r.id === id));
      this.commit((d) => {
        const r = d.reminders.find((x) => x.id === id)!;
        r.done = !r.done;
      });
    });

  deleteReminder = (id: string) =>
    this.run(() => {
      this.mine(this.state.db.reminders.find((r) => r.id === id));
      this.commit((d) => void (d.reminders = d.reminders.filter((r) => r.id !== id)));
    });

  trackPortalOpen = (id: string) => this.commit((d) => void (d.portals.find((p) => p.id === id)!.clicks += 1));

  savePortal = (input: Omit<Portal, 'id' | 'clicks' | 'hue'>) =>
    this.run(() => {
      assert(canManageMasters(this.me), 'Only users who manage masters can add portals.');
      if (!/^https?:\/\//.test(input.url)) throw new Error('Enter a full website address starting with https://');
      this.commit((d) => void d.portals.push({ ...input, id: uid('portal'), clicks: 0, hue: Math.floor(Math.random() * 360) }));
      return true;
    });

  updateNotice = (id: string, patch: Partial<Pick<Notice, 'status' | 'assigneeId'>>) =>
    this.run(() => {
      this.commit((d) => Object.assign(d.notices.find((n) => n.id === id)!, patch));
      return true;
    });

  /** Simulated portal sync: adds sample notices so the demo shows the flow. */
  fetchNotices = () =>
    this.run(() => {
      const pool: Omit<Notice, 'id' | 'fetchedAt' | 'issuedOn' | 'dueOn' | 'reference'>[] = [
        { clientId: 'c_nimbus', source: 'GST', form: 'GSTR-3A', subject: 'Notice for non-filing of GSTR-3B (Sep 2026)', status: 'new' },
        { clientId: 'c_horizon', source: 'Income Tax', form: '143(2)', subject: 'Notice for scrutiny assessment — AY 2025-26', status: 'new' },
        { clientId: 'c_arora', source: 'TDS', form: 'TRACES Intimation', subject: 'Late filing fee u/s 234E — Q2 FY 2026-27', status: 'new', amount: 4200 },
        { clientId: 'c_coastal', source: 'GST', form: 'DRC-01', subject: 'Summary of show cause notice — ITC on hotel renovation', status: 'new', amount: 215000 },
      ];
      const existing = new Set(this.state.db.notices.map((n) => n.clientId + n.form));
      const fresh = pool.filter((n) => !existing.has(n.clientId + n.form)).slice(0, 2);
      this.commit((d) => {
        const now = new Date();
        fresh.forEach((n) =>
          d.notices.unshift({
            ...n,
            id: uid('notice'),
            reference: `ZD${Math.floor(10000000 + Math.random() * 89999999)}`,
            issuedOn: now.toISOString().slice(0, 10),
            dueOn: new Date(now.getTime() + 15 * 86400000).toISOString().slice(0, 10),
            fetchedAt: now.toISOString(),
          }),
        );
      });
      return fresh.length;
    });

  noticeToTask = (id: string) =>
    this.run(() => {
      const n = this.state.db.notices.find((x) => x.id === id);
      assert(!!n, 'Notice not found.');
      const assigneeId = n.assigneeId ?? this.me.id;
      const cat = n.source === 'GST' ? 'gst' : n.source === 'Income Tax' ? 'itr' : n.source === 'TDS' ? 'tds' : 'adv';
      const reviewer = this.state.db.clients.find((c) => c.id === n.clientId)?.relationshipManagerId;
      const t = this.createTask({
        title: `Reply to ${n.form} notice`,
        description: `${n.subject}\nReference: ${n.reference}`,
        clientId: n.clientId,
        categoryId: cat,
        assigneeId: canAssignTo(this.state.db, this.me, assigneeId) ? assigneeId : this.me.id,
        reviewerId: reviewer !== assigneeId ? reviewer : undefined,
        requiresReview: !!reviewer && reviewer !== assigneeId,
        priority: 'high',
        startDate: new Date().toISOString().slice(0, 10),
        dueDate: n.dueOn,
        estimateHours: 4,
        checklist: ['Download notice & annexures', 'Collect supporting documents', 'Draft reply', 'Partner review', 'Submit reply on portal'],
      });
      if (t) this.commit((d) => Object.assign(d.notices.find((x) => x.id === id)!, { taskId: t.id, status: 'in_progress' }));
      return t;
    });

  createInvoice = (clientId: string, taskIds: string[]) =>
    this.run(() => {
      assert(canAccessBilling(this.me), 'You don’t have billing access.');
      const { db } = this.state;
      const tasks = db.tasks.filter((t) => taskIds.includes(t.id) && t.clientId === clientId && !t.invoiceId);
      if (!tasks.length) throw new Error('Select at least one unbilled task for this client.');
      const date = new Date();
      const y = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
      const inv: Invoice = {
        id: uid('inv'),
        number: `${db.firm.invoicePrefix ?? 'INV'}/${y}-${String((y + 1) % 100).padStart(2, '0')}/${String(db.invoices.length + 1).padStart(4, '0')}`,
        clientId,
        date: date.toISOString().slice(0, 10),
        dueDate: new Date(date.getTime() + 15 * 86400000).toISOString().slice(0, 10),
        gstRate: db.firm.defaultGstRate ?? 18,
        items: tasks.map((t) => ({ taskId: t.id, description: t.title, amount: t.fee ?? 0 })),
      };
      this.commit((d) => {
        d.invoices.push(inv);
        d.tasks.forEach((t) => {
          if (tasks.some((x) => x.id === t.id)) t.invoiceId = inv.id;
        });
      });
      return inv;
    });

  recordPayment = (input: Omit<Payment, 'id'>) =>
    this.run(() => {
      assert(canAccessBilling(this.me), 'You don’t have billing access.');
      if (!(input.amount > 0)) throw new Error('Enter an amount greater than zero.');
      this.commit((d) => void d.payments.push({ ...input, id: uid('pay') }));
      return true;
    });

  setTaskFee = (taskId: string, fee: number) =>
    this.run(() => {
      assert(canAccessBilling(this.me), 'You don’t have billing access.');
      this.commit((d) => void (d.tasks.find((t) => t.id === taskId)!.fee = Math.max(0, Math.round(fee))));
    });

  saveDsc = (input: Omit<Dsc, 'id' | 'lastMovedAt'>, id?: string) =>
    this.run(() => {
      if (!input.holder.trim()) throw new Error('Holder name is required.');
      this.commit((d) => {
        if (id) Object.assign(d.dscs.find((x) => x.id === id)!, input);
        else d.dscs.push({ ...input, id: uid('dsc'), lastMovedAt: new Date().toISOString().slice(0, 10) });
      });
      return true;
    });

  moveDsc = (id: string) =>
    this.run(() => {
      this.commit((d) => {
        const x = d.dscs.find((y) => y.id === id)!;
        x.custody = x.custody === 'firm' ? 'client' : 'firm';
        x.lastMovedAt = new Date().toISOString().slice(0, 10);
      });
      return true;
    });

  addDocMovement = (input: Omit<DocMovement, 'id' | 'handledBy' | 'returned'>) =>
    this.run(() => {
      if (!input.document.trim()) throw new Error('Describe the document.');
      if (!input.person.trim()) throw new Error('Enter who handed over or received it.');
      this.commit((d) => void d.docMovements.unshift({ ...input, id: uid('doc'), handledBy: this.me.id, returned: input.direction === 'out' }));
      return true;
    });

  markDocReturned = (id: string) =>
    this.run(() => {
      this.commit((d) => {
        const m = d.docMovements.find((x) => x.id === id)!;
        m.returned = true;
        d.docMovements.unshift({ ...m, id: uid('doc'), direction: 'out', date: new Date().toISOString().slice(0, 10), handledBy: this.me.id, expectedReturn: undefined, returned: true });
      });
      return true;
    });

  sendChat = (clientId: string, body: string) =>
    this.run(() => {
      assert(canUseWhatsApp(this.me), 'You don’t have WhatsApp access.');
      const client = this.state.db.clients.find((c) => c.id === clientId);
      if (client?.exitDate) throw new Error(`${client.name} has left the firm — messaging is switched off.`);
      if (!body.trim()) return;
      const id = uid('wa');
      this.commit((d) => void d.chats.push({ id, clientId, direction: 'out', body: body.trim(), at: new Date().toISOString(), status: 'sent', authorId: this.me.id }));
      setTimeout(() => this.commit((d) => void (d.chats.find((m) => m.id === id) && (d.chats.find((m) => m.id === id)!.status = 'delivered'))), 1200);
      return true;
    });

  sendBroadcast = (input: { title: string; body: string; kind: Broadcast['kind']; clientIds: string[] }) =>
    this.run(() => {
      assert(canUseWhatsApp(this.me), 'You don’t have WhatsApp access.');
      if (!input.body.trim()) throw new Error('Write a message to send.');
      const recipients = this.state.db.clients.filter((c) => input.clientIds.includes(c.id) && !c.exitDate);
      if (!recipients.length) throw new Error('Choose at least one active client.');
      this.commit((d) => {
        const at = new Date().toISOString();
        d.broadcasts.unshift({ id: uid('bc'), title: input.title, body: input.body, kind: input.kind, sentAt: at, recipients: recipients.length, sentBy: this.me.id });
        recipients.forEach((c) => d.chats.push({ id: uid('wa'), clientId: c.id, direction: 'out', body: input.body, at, status: 'sent', authorId: this.me.id }));
      });
      return recipients.length;
    });

  addDriveFiles = (clientId: string, folder: string, files: { name: string; sizeKb: number }[]) =>
    this.run(() => {
      this.commit((d) =>
        files.forEach((f) =>
          d.drive.push({ id: uid('file'), clientId, folder, name: f.name, sizeKb: Math.max(1, Math.round(f.sizeKb)), uploadedBy: this.me.id, uploadedAt: new Date().toISOString() }),
        ),
      );
      return files.length;
    });

  deleteDriveFile = (id: string) =>
    this.run(() => {
      assert(permissionsOf(this.me).deleteRecords, 'You don’t have permission to delete files.');
      this.commit((d) => void (d.drive = d.drive.filter((f) => f.id !== id)));
      return true;
    });

  saveService = (input: Omit<Service, 'id'>, id?: string) =>
    this.run(() => {
      assert(canManageMasters(this.me), 'You don’t have permission to manage masters.');
      if (!input.name.trim()) throw new Error('Service name is required.');
      this.commit((d) => {
        if (id) Object.assign(d.services.find((x) => x.id === id)!, input);
        else d.services.push({ ...input, id: uid('svc') });
      });
      return true;
    });

  deleteService = (id: string) =>
    this.run(() => {
      assert(canManageMasters(this.me), 'You don’t have permission to manage masters.');
      if (this.state.db.tasks.some((t) => t.serviceId === id && t.status !== 'completed')) throw new Error('This service has open tasks. Complete or move them first.');
      this.commit((d) => void (d.services = d.services.filter((x) => x.id !== id)));
      return true;
    });

  saveReferrer = (input: Omit<Referrer, 'id'>, id?: string) =>
    this.run(() => {
      assert(canManageMasters(this.me), 'You don’t have permission to manage masters.');
      if (!input.name.trim()) throw new Error('Name is required.');
      this.commit((d) => {
        if (id) Object.assign(d.referrers.find((x) => x.id === id)!, input);
        else d.referrers.push({ ...input, id: uid('ref') });
      });
      return true;
    });

  deleteReferrer = (id: string) =>
    this.run(() => {
      assert(canManageMasters(this.me), 'You don’t have permission to manage masters.');
      this.commit((d) => {
        d.referrers = d.referrers.filter((x) => x.id !== id);
        d.clients.forEach((c) => c.referredById === id && (c.referredById = undefined));
      });
      return true;
    });

  setClientExit = (clientId: string, exitDate: string | undefined) =>
    this.run(() => {
      const c = this.state.db.clients.find((x) => x.id === clientId);
      assert(!!c && canEditClient(this.me, c), 'You cannot edit this client.');
      this.commit((d) => {
        const x = d.clients.find((y) => y.id === clientId)!;
        x.exitDate = exitDate;
        x.status = exitDate ? 'inactive' : 'active';
        this.log(d, { type: 'client_updated', clientId, meta: { name: exitDate ? 'exit' : 'rejoin' } });
      });
      return true;
    });

  deleteMember = (userId: string) =>
    this.run(() => {
      assert(canManageTeam(this.me), 'Only firm admins can delete team members.');
      if (userId === this.me.id) throw new Error('You cannot delete yourself.');
      const { db } = this.state;
      if (db.tasks.some((t) => t.assigneeId === userId || t.reviewerId === userId)) throw new Error('This person has tasks in the system. Deactivate them instead, or reassign their work first.');
      this.commit((d) => void (d.users = d.users.filter((u) => u.id !== userId)));
      return true;
    });
}

export const store = new LedgerStore(localRepository);

export function useAppState<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}

export const useDb = () => useAppState((s) => s.db);

export function useCurrentUser() {
  const db = useDb();
  const id = useAppState((s) => s.currentUserId);
  return db.users.find((u) => u.id === id)!;
}
