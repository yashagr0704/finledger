import { canViewClient, isAdmin, permissionsOf, visibleClients, visibleTasks } from '@/lib/permissions';
import type { Database, User } from '@/types';
import { maxTaskNumber } from './context';

/**
 * The slice of the firm's data a user may receive. The server sends only this
 * to the browser; everything else stays on the server.
 */
export function scopeDatabase(db: Database, me: User): Database {
  const perms = permissionsOf(me);
  const admin = isAdmin(me);
  const tasks = visibleTasks(db, me);
  const taskIds = new Set(tasks.map((t) => t.id));
  const clients = visibleClients(db, me);
  const clientIds = new Set(clients.map((c) => c.id));
  const byClient = <T extends { clientId: string }>(rows: T[]) => rows.filter((r) => clientIds.has(r.clientId));

  return {
    ...db,
    taskSeq: maxTaskNumber(db),
    users: db.users.map((u) => (admin || u.id === me.id ? u : stripPrivate(u))),
    clients: clients.map((c) => ({
      ...c,
      // Passwords are fetched one at a time through an audited endpoint.
      portalLogins: (c.portalLogins ?? []).map((l) => ({ id: l.id, portalId: l.portalId, username: l.username, password: '', hasPassword: !!l.password, extra: l.extra })),
    })),
    tasks: perms.billing ? tasks : tasks.map((t) => ({ ...t, fee: undefined })),
    comments: db.comments.filter((c) => taskIds.has(c.taskId)),
    activities: db.activities.filter((a) => (a.taskId ? taskIds.has(a.taskId) : a.clientId ? clientIds.has(a.clientId) : admin)),
    notifications: db.notifications.filter((n) => n.userId === me.id),
    documents: byClient(db.documents),
    reviews: db.reviews.filter((r) => taskIds.has(r.taskId)),
    notes: db.notes.filter((n) => n.userId === me.id),
    reminders: db.reminders.filter((r) => r.userId === me.id),
    notices: byClient(db.notices),
    invoices: perms.billing ? db.invoices : [],
    payments: perms.billing ? db.payments : [],
    dscs: byClient(db.dscs),
    docMovements: byClient(db.docMovements),
    chats: perms.whatsapp ? byClient(db.chats) : [],
    broadcasts: perms.whatsapp ? db.broadcasts : [],
    drive: byClient(db.drive),
  };
}

function stripPrivate(u: User): User {
  const { aadhaar: _a, pan: _p, address: _ad, ...rest } = u;
  void _a;
  void _p;
  void _ad;
  return rest;
}

/** Can `me` download the stored file referenced by this attachment / drive entry? */
export function canAccessFile(db: Database, me: User, fileId: string) {
  const task = db.tasks.find((t) => t.attachments.some((a) => a.fileId === fileId));
  if (task) return visibleTasks(db, me).some((t) => t.id === task.id);
  const df = db.drive.find((f) => f.fileId === fileId);
  if (df) {
    const c = db.clients.find((x) => x.id === df.clientId);
    return !!c && canViewClient(db, me, c);
  }
  return false;
}
