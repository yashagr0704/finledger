import { useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { api, ApiError, BACKEND, DEMO_CAPS, type Capabilities } from '@/api/client';
import { localRepository, sessionStore, type DataRepository } from '@/data/repository';
import { emptyDatabase } from '@/data/empty';
import type { CommandArgs, CommandName, CommandResult } from '@/domain/commands';
import type { ProposedId } from '@/domain/context';
import { classifyError, execute } from '@/domain/execute';
import type { Database } from '@/types';

export type { TaskInput, ClientInput, TemplateInput } from '@/domain/commands';

export type SessionStatus = 'loading' | 'signed_out' | 'ready' | 'error';

interface State {
  db: Database;
  currentUserId: string;
  status: SessionStatus;
  caps?: Capabilities;
}

type Listener = () => void;

/**
 * Central application store.
 *
 * Every change runs through the shared domain commands (`src/domain`). In demo
 * mode the result is saved to localStorage. In backend mode the command is
 * applied immediately (optimistic UI) and sent to the server, which re-runs
 * it with authoritative permissions; failures roll back to the server state.
 */
class LedgerStore {
  private state: State;
  private listeners = new Set<Listener>();
  // Backend sync state.
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private serverVersion = 0;
  private refreshWanted = false;
  private events?: EventSource;

  constructor(private repo: DataRepository) {
    if (BACKEND) {
      this.state = { db: emptyDatabase(), currentUserId: '', status: 'loading' };
      void this.boot();
      return;
    }
    const db = repo.load();
    const saved = sessionStore.getUserId();
    const currentUserId = db.users.some((u) => u.id === saved && u.status === 'active') ? saved! : db.users.find((u) => u.role === 'admin')!.id;
    this.state = { db, currentUserId, status: 'ready' };
  }

  getState = () => this.state;

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private set(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  /** Runs a domain command. Returns its result, or undefined after showing an error toast. */
  private exec<N extends CommandName>(name: N, ...args: CommandArgs<N>): CommandResult<N> | undefined {
    try {
      const r = execute(this.state.db, this.state.currentUserId, name, args);
      this.set({ db: r.db });
      if (BACKEND) this.send(name, args, r.ids);
      else this.repo.save(r.db);
      return r.result;
    } catch (e) {
      const { kind, message } = classifyError(e);
      if (kind === 'unknown') console.error(e);
      toast.error(kind === 'permission' ? 'Not allowed' : message, kind === 'permission' ? { description: message } : undefined);
      return undefined;
    }
  }

  // ------------------------------------------------------------ backend sync

  private async boot() {
    try {
      await api.me();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return this.set({ status: 'signed_out' });
      return this.set({ status: 'error' });
    }
    await this.refresh();
  }

  /** Re-reads everything this user may see from the server. */
  refresh = async () => {
    if (this.pending) {
      this.refreshWanted = true;
      return;
    }
    try {
      const b = await api.bootstrap();
      this.serverVersion = b.version;
      this.set({ db: b.db, currentUserId: b.meId, caps: b.caps, status: 'ready' });
      this.listen();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) this.set({ status: 'signed_out', db: emptyDatabase() });
      else if (this.state.status === 'loading') this.set({ status: 'error' });
    }
  };

  private listen() {
    if (typeof EventSource === 'undefined' || this.events) return;
    this.events = new EventSource(api.eventsUrl(), { withCredentials: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    this.events.addEventListener('version', (ev) => {
      const v = Number((ev as MessageEvent).data);
      if (v > this.serverVersion) {
        clearTimeout(timer);
        timer = setTimeout(() => void this.refresh(), 300);
      }
    });
  }

  private send(name: CommandName, args: unknown[], ids: ProposedId[]) {
    this.pending += 1;
    // Trailing undefined arguments are dropped so optional parameters stay optional.
    const trimmed = [...args];
    while (trimmed.length && trimmed[trimmed.length - 1] === undefined) trimmed.pop();
    this.queue = this.queue.then(async () => {
      try {
        const ack = await api.command(name, trimmed, ids);
        this.serverVersion = Math.max(this.serverVersion, ack.version);
        if (ack.idsChanged) this.refreshWanted = true;
        if (ack.meta?.inviteUrl) showInviteLink(ack.meta.inviteUrl, ack.meta.emailed);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'The server rejected this change.';
        toast.error('Change not saved', { description: msg });
        this.refreshWanted = true;
        if (e instanceof ApiError && e.status === 401) this.set({ status: 'signed_out' });
      } finally {
        this.pending -= 1;
        if (!this.pending && this.refreshWanted) {
          this.refreshWanted = false;
          await this.refresh();
        }
      }
    });
  }

  /** Resolves once every queued change has reached the server (immediately in demo mode). */
  settled = () => this.queue;

  signIn = async (email: string, password: string) => {
    await api.login(email, password);
    this.set({ status: 'loading' });
    await this.refresh();
  };

  signOut = async () => {
    try {
      await api.logout();
    } finally {
      this.events?.close();
      this.events = undefined;
      this.set({ status: 'signed_out', db: emptyDatabase(), currentUserId: '' });
    }
  };

  // ------------------------------------------------------------ demo session

  switchUser = (userId: string) => {
    if (BACKEND) return;
    const user = this.state.db.users.find((u) => u.id === userId);
    if (!user || user.status !== 'active') return;
    sessionStore.setUserId(userId);
    this.set({ currentUserId: userId });
  };

  resetDemo = () => {
    if (BACKEND) return;
    const db = this.repo.reset();
    const admin = db.users.find((u) => u.role === 'admin')!;
    sessionStore.setUserId(admin.id);
    this.set({ db, currentUserId: admin.id });
  };

  // ---------------------------------------------------------------- commands
  // Thin wrappers keep the original call sites unchanged.

  createTask = (...a: CommandArgs<'createTask'>) => this.exec('createTask', ...a);
  updateTask = (...a: CommandArgs<'updateTask'>) => this.exec('updateTask', ...a);
  transitionTask = (...a: CommandArgs<'transitionTask'>) => this.exec('transitionTask', ...a);
  setFilingStage = (...a: CommandArgs<'setFilingStage'>) => this.exec('setFilingStage', ...a);
  toggleChecklistItem = (...a: CommandArgs<'toggleChecklistItem'>) => this.exec('toggleChecklistItem', ...a);
  addChecklistItem = (...a: CommandArgs<'addChecklistItem'>) => this.exec('addChecklistItem', ...a);
  removeChecklistItem = (...a: CommandArgs<'removeChecklistItem'>) => this.exec('removeChecklistItem', ...a);
  addComment = (...a: CommandArgs<'addComment'>) => this.exec('addComment', ...a);
  addAttachment = (...a: CommandArgs<'addAttachment'>) => this.exec('addAttachment', ...a);
  removeAttachment = (...a: CommandArgs<'removeAttachment'>) => this.exec('removeAttachment', ...a);
  bulkReassign = (...a: CommandArgs<'bulkReassign'>) => this.exec('bulkReassign', ...a);
  deleteTask = (...a: CommandArgs<'deleteTask'>) => this.exec('deleteTask', ...a);
  createClient = (...a: CommandArgs<'createClient'>) => this.exec('createClient', ...a);
  updateClient = (...a: CommandArgs<'updateClient'>) => this.exec('updateClient', ...a);
  setClientExit = (...a: CommandArgs<'setClientExit'>) => this.exec('setClientExit', ...a);
  requestDocument = (...a: CommandArgs<'requestDocument'>) => this.exec('requestDocument', ...a);
  setDocumentStatus = (...a: CommandArgs<'setDocumentStatus'>) => this.exec('setDocumentStatus', ...a);
  inviteMember = (...a: CommandArgs<'inviteMember'>) => this.exec('inviteMember', ...a);
  updateMember = (...a: CommandArgs<'updateMember'>) => this.exec('updateMember', ...a);
  deleteMember = (...a: CommandArgs<'deleteMember'>) => this.exec('deleteMember', ...a);
  updateFirm = (...a: CommandArgs<'updateFirm'>) => this.exec('updateFirm', ...a);
  addCategory = (...a: CommandArgs<'addCategory'>) => this.exec('addCategory', ...a);
  markNotificationRead = (...a: CommandArgs<'markNotificationRead'>) => this.exec('markNotificationRead', ...a);
  markAllNotificationsRead = () => this.exec('markAllNotificationsRead');
  saveTemplate = (...a: CommandArgs<'saveTemplate'>) => this.exec('saveTemplate', ...a);
  generateFromTemplate = (templateId: string) => this.exec('generateFromTemplate', templateId);
  saveNote = (...a: CommandArgs<'saveNote'>) => this.exec('saveNote', ...a);
  deleteNote = (...a: CommandArgs<'deleteNote'>) => this.exec('deleteNote', ...a);
  saveReminder = (...a: CommandArgs<'saveReminder'>) => this.exec('saveReminder', ...a);
  toggleReminder = (...a: CommandArgs<'toggleReminder'>) => this.exec('toggleReminder', ...a);
  deleteReminder = (...a: CommandArgs<'deleteReminder'>) => this.exec('deleteReminder', ...a);
  trackPortalOpen = (...a: CommandArgs<'trackPortalOpen'>) => this.exec('trackPortalOpen', ...a);
  savePortal = (...a: CommandArgs<'savePortal'>) => this.exec('savePortal', ...a);
  updateNotice = (...a: CommandArgs<'updateNotice'>) => this.exec('updateNotice', ...a);
  addNotice = (...a: CommandArgs<'addNotice'>) => this.exec('addNotice', ...a);
  fetchNotices = () => this.exec('fetchNotices');
  noticeToTask = (...a: CommandArgs<'noticeToTask'>) => this.exec('noticeToTask', ...a);
  createInvoice = (...a: CommandArgs<'createInvoice'>) => this.exec('createInvoice', ...a);
  recordPayment = (...a: CommandArgs<'recordPayment'>) => this.exec('recordPayment', ...a);
  setTaskFee = (...a: CommandArgs<'setTaskFee'>) => this.exec('setTaskFee', ...a);
  saveDsc = (...a: CommandArgs<'saveDsc'>) => this.exec('saveDsc', ...a);
  moveDsc = (...a: CommandArgs<'moveDsc'>) => this.exec('moveDsc', ...a);
  addDocMovement = (...a: CommandArgs<'addDocMovement'>) => this.exec('addDocMovement', ...a);
  markDocReturned = (...a: CommandArgs<'markDocReturned'>) => this.exec('markDocReturned', ...a);
  sendChat = (...a: CommandArgs<'sendChat'>) => this.exec('sendChat', ...a);
  sendBroadcast = (...a: CommandArgs<'sendBroadcast'>) => this.exec('sendBroadcast', ...a);
  addDriveFiles = (...a: CommandArgs<'addDriveFiles'>) => this.exec('addDriveFiles', ...a);
  deleteDriveFile = (...a: CommandArgs<'deleteDriveFile'>) => this.exec('deleteDriveFile', ...a);
  saveService = (...a: CommandArgs<'saveService'>) => this.exec('saveService', ...a);
  deleteService = (...a: CommandArgs<'deleteService'>) => this.exec('deleteService', ...a);
  saveReferrer = (...a: CommandArgs<'saveReferrer'>) => this.exec('saveReferrer', ...a);
  deleteReferrer = (...a: CommandArgs<'deleteReferrer'>) => this.exec('deleteReferrer', ...a);
}

export function showInviteLink(url: string, emailed?: boolean) {
  toast.success(emailed ? 'Invitation emailed' : 'Invitation link ready', {
    description: emailed ? url : 'Share this link with the new member so they can set a password.',
    duration: 15000,
    action: {
      label: 'Copy link',
      onClick: () => void navigator.clipboard?.writeText(url).then(() => toast.success('Link copied')),
    },
  });
}

export const store = new LedgerStore(localRepository);

export function useAppState<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}

export const useDb = () => useAppState((s) => s.db);
export const useSessionStatus = () => useAppState((s) => s.status);
export const useCaps = () => useAppState((s) => s.caps ?? DEMO_CAPS);

export function useCurrentUser() {
  const db = useDb();
  const id = useAppState((s) => s.currentUserId);
  return db.users.find((u) => u.id === id)!;
}
