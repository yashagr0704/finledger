import { brand } from '@/config/brand';
import { PermissionError } from '@/lib/permissions';
import { uid } from '@/lib/utils';
import type { Activity, AppNotification, Database, User } from '@/types';

/**
 * Everything a command needs. `db` is a private draft: commands mutate it
 * freely, and if they throw, the draft is thrown away.
 */
export interface Ctx {
  db: Database;
  me: User;
  newId(prefix: string): string;
  newTaskId(): string;
}

/** Bad input or a rule violation the user can fix. Maps to HTTP 400. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** A referenced record doesn't exist (or isn't visible). Maps to HTTP 404. */
export class NotFoundError extends Error {
  constructor(what = 'Record') {
    super(`${what} not found.`);
    this.name = 'NotFoundError';
  }
}

export { PermissionError };

export function fail(message: string): never {
  throw new ValidationError(message);
}

export function found<T>(value: T | undefined | null, what?: string): T {
  if (value === undefined || value === null) throw new NotFoundError(what);
  return value;
}

/** Copies only allowed keys, so a request can't overwrite ids or ownership fields. */
export function pick<T extends object, K extends keyof T>(obj: Partial<T> | undefined, keys: readonly K[]): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const k of keys) if (k in obj) out[k] = obj[k] as T[K];
  return out;
}

export function log(ctx: Ctx, a: Omit<Activity, 'id' | 'createdAt' | 'actorId'>) {
  ctx.db.activities.unshift({ id: ctx.newId('act'), createdAt: new Date().toISOString(), actorId: ctx.me.id, ...a });
}

export function notify(ctx: Ctx, userId: string | undefined, n: Omit<AppNotification, 'id' | 'createdAt' | 'read' | 'userId'>) {
  if (!userId || userId === ctx.me.id) return;
  ctx.db.notifications.unshift({ id: ctx.newId('ntf'), userId, createdAt: new Date().toISOString(), read: false, ...n });
}

export function maxTaskNumber(db: Database) {
  return db.tasks.reduce((m, t) => Math.max(m, Number(t.id.split('-')[1]) || 0), Math.max(1000, db.taskSeq ?? 0));
}

export const formatTaskId = (n: number) => `${brand.taskPrefix}-${n}`;

const ID_RE = /^[a-z]+_[a-z0-9]{6,40}$/;
const TASK_ID_RE = new RegExp(`^${brand.taskPrefix}-\\d{4,9}$`);

export interface ProposedId {
  p: string;
  id: string;
}

/**
 * Builds the id generators for a command run.
 *
 * In the browser, ids are generated and recorded so the same ids can be sent
 * to the server. On the server, proposed ids are reused only when they are
 * well-formed and unused — otherwise fresh ones are generated.
 */
export function idFactory(db: Database, proposed?: ProposedId[]) {
  const used: ProposedId[] = [];
  const queue = [...(proposed ?? [])];
  let existing: Set<string> | null = null;
  const allIds = () => {
    if (!existing) {
      existing = new Set();
      for (const v of Object.values(db)) if (Array.isArray(v)) for (const r of v as { id?: string }[]) if (r?.id) existing.add(r.id);
    }
    return existing;
  };
  const take = (p: string) => {
    const i = queue.findIndex((q) => q.p === p);
    return i >= 0 ? queue.splice(i, 1)[0].id : undefined;
  };
  return {
    used,
    newId(prefix: string) {
      let id = take(prefix);
      if (!id || !ID_RE.test(id) || !id.startsWith(`${prefix}_`) || allIds().has(id)) id = uid(prefix);
      if (proposed) allIds().add(id);
      used.push({ p: prefix, id });
      return id;
    },
    newTaskId() {
      const next = maxTaskNumber(db) + 1;
      let id = take('task');
      const n = id ? Number(id.split('-')[1]) : NaN;
      // Accept a proposed number only if it is unused and close to the sequence.
      if (!id || !TASK_ID_RE.test(id) || !(n >= next && n <= next + 100) || db.tasks.some((t) => t.id === id)) id = formatTaskId(next);
      used.push({ p: 'task', id });
      return id;
    },
  };
}
