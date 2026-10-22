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

  inviteMember = (input: { name: string; email: string; role: Role; title: string; managerId?: string }) =>
    this.run(() => {
      assert(canManageTeam(this.me), 'Only firm admins can invite team members.');
      const { db } = this.state;
      const email = input.email.trim().toLowerCase();
      if (db.users.some((u) => u.email.toLowerCase() === email)) throw new Error('Someone with this email is already on the team.');
      const user: User = {
        id: uid('usr'),
        name: input.name.trim(),
        email,
        phone: '',
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

  updateMember = (userId: string, patch: Partial<Pick<User, 'role' | 'status' | 'title' | 'managerId' | 'capacityHours'>>) =>
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
        this.log(d, { type: 'member_updated', userId, meta: Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, String(v ?? '')])) });
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
