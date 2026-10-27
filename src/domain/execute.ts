import { PermissionError } from '@/lib/permissions';
import type { Database } from '@/types';
import { commands, type CommandArgs, type CommandName, type CommandResult } from './commands';
import { idFactory, NotFoundError, ValidationError, type Ctx, type ProposedId } from './context';

export interface ExecuteResult<N extends CommandName> {
  db: Database;
  result: CommandResult<N>;
  ids: ProposedId[];
}

/**
 * Runs a command against a copy of `db` as user `meId`. The input database is
 * never modified. Throws PermissionError / ValidationError / NotFoundError.
 */
export function execute<N extends CommandName>(db: Database, meId: string, name: N, args: CommandArgs<N>, opts: { proposedIds?: ProposedId[] } = {}): ExecuteResult<N> {
  const fn = commands[name] as unknown as ((ctx: Ctx, ...a: unknown[]) => CommandResult<N>) | undefined;
  if (typeof fn !== 'function') throw new NotFoundError(`Command “${String(name)}”`);
  const draft = structuredClone(db);
  const me = draft.users.find((u) => u.id === meId);
  if (!me || me.status !== 'active') throw new PermissionError('Your account is not active.');
  const ids = idFactory(draft, opts.proposedIds);
  const ctx: Ctx = { db: draft, me, newId: ids.newId, newTaskId: ids.newTaskId };
  const result = fn(ctx, ...(args as unknown[]));
  return { db: ctx.db, result, ids: ids.used };
}

export type DomainErrorKind = 'permission' | 'validation' | 'not_found' | 'unknown';
export function classifyError(e: unknown): { kind: DomainErrorKind; message: string } {
  if (e instanceof PermissionError) return { kind: 'permission', message: e.message };
  if (e instanceof ValidationError) return { kind: 'validation', message: e.message };
  if (e instanceof NotFoundError) return { kind: 'not_found', message: e.message };
  return { kind: 'unknown', message: e instanceof Error ? e.message : 'Unexpected error' };
}
