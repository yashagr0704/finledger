import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { removeMember } from '@/domain/commands';
import { fail, found } from '@/domain/context';
import type { User } from '@/types';
import type { App } from './app';
import { revokeSessions } from './auth';
import { newId, randomToken, sha256 } from './crypto';
import type { Db } from './db';
import { checkPassword, hashPassword, newFirmDatabase, validatePassword } from './newFirm';

/**
 * Platform superadmins run the service: they create, suspend and delete firms and manage each
 * firm's admins (add, deactivate, delete, reset password). They are not members of any firm and
 * never see a firm's own data (clients, tasks, employees…) — inside a firm, its admins decide.
 * Separate accounts, cookie and sessions from firm users; all routes live under /api/platform.
 */
const COOKIE = 'lf_platform';
const COOKIE_PATH = '/api/platform';
const SESSION_HOURS = 12;
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword(randomToken()));
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface PlatformAdmin {
  id: string;
  email: string;
  name: string;
}
declare module 'fastify' {
  interface FastifyRequest {
    platformAdmin?: PlatformAdmin;
  }
}

/** Creates a superadmin, or resets the password (and name) of an existing one. Used by the CLI. */
export async function upsertPlatformAdmin(db: Db, input: { email: string; name: string; password: string }) {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL.test(email)) throw new Error('Enter a valid email address.');
  const pwErr = validatePassword(input.password);
  if (pwErr) throw new Error(pwErr);
  const hash = await hashPassword(input.password);
  const { rows } = await db.query<{ id: string }>('UPDATE platform_admins SET password_hash = $2, name = $3 WHERE lower(email) = $1 RETURNING id', [email, hash, input.name.trim() || email]);
  if (rows[0]) {
    await db.query('DELETE FROM platform_sessions WHERE admin_id = $1', [rows[0].id]);
    return { id: rows[0].id, created: false };
  }
  const id = newId('pa');
  await db.query('INSERT INTO platform_admins (id, email, name, password_hash) VALUES ($1, $2, $3, $4)', [id, email, input.name.trim() || email, hash]);
  return { id, created: true };
}

export function registerPlatformRoutes(f: FastifyInstance, app: App) {
  const db = app.db;
  const loginLimit = { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } };

  const current = async (req: FastifyRequest): Promise<PlatformAdmin | undefined> => {
    const token = req.cookies?.[COOKIE];
    if (!token) return undefined;
    const { rows } = await db.query<PlatformAdmin>(
      'SELECT a.id, a.email, a.name FROM platform_sessions s JOIN platform_admins a ON a.id = s.admin_id WHERE s.id = $1 AND s.expires_at > now()',
      [sha256(token)],
    );
    return rows[0];
  };
  const requirePlatform = async (req: FastifyRequest, reply: FastifyReply) => {
    const admin = await current(req);
    if (!admin) return reply.code(401).send({ message: 'Not signed in.' });
    req.platformAdmin = admin;
  };
  const opts = { preHandler: requirePlatform };
  const audit = (req: FastifyRequest, firmId: string, action: string, detail?: unknown) => app.audit(firmId, req.platformAdmin!.id, `platform_${action}`, detail, req.ip);

  /** A firm admin by user id. Other members of a firm are the firm's business, so they 404 here. */
  const firmAdmin = async (userId: string) => {
    const { rows } = await db.query<{ firm_id: string; has_password: boolean }>(
      `SELECT firm_id, password_hash IS NOT NULL AS has_password FROM users WHERE id = $1 AND data->>'role' = 'admin'`,
      [userId],
    );
    return found(rows[0], 'Firm admin');
  };
  const emailFree = async (email: string) => {
    const taken = await db.query('SELECT 1 FROM users WHERE lower(email) = $1', [email]);
    if (taken.rows.length) fail('An account with this email already exists.');
  };
  const newAdmin = (name: string, email: string): User => ({
    id: newId('usr'),
    name,
    email,
    phone: '',
    role: 'admin',
    title: 'Partner',
    status: 'active',
    joinedAt: new Date().toISOString().slice(0, 10),
    capacityHours: 40,
    avatarHue: Math.floor(Math.random() * 360),
    username: email.split('@')[0],
  });
  const body = (req: FastifyRequest) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    return (k: string) => (typeof b[k] === 'string' ? (b[k] as string).trim() : '');
  };

  // ------------------------------------------------------------ session
  f.post('/api/platform/login', loginLimit, async (req, reply) => {
    const { email, password } = (req.body ?? {}) as { email?: unknown; password?: unknown };
    if (typeof email !== 'string' || typeof password !== 'string') return reply.code(400).send({ message: 'Email and password are required.' });
    const { rows } = await db.query<{ id: string; password_hash: string }>('SELECT id, password_hash FROM platform_admins WHERE lower(email) = lower($1)', [email.trim()]);
    const a = rows[0];
    const ok = await checkPassword(password, a?.password_hash ?? (await getDummyHash()));
    if (!a || !ok) {
      await app.audit(undefined, a?.id, 'platform_login_failed', { email }, req.ip);
      return reply.code(401).send({ message: 'Email or password is incorrect.' });
    }
    const token = randomToken();
    const expires = new Date(Date.now() + SESSION_HOURS * 3600000);
    await db.query('INSERT INTO platform_sessions (id, admin_id, expires_at, user_agent) VALUES ($1, $2, $3, $4)', [sha256(token), a.id, expires, String(req.headers['user-agent'] ?? '').slice(0, 300)]);
    reply.setCookie(COOKIE, token, { path: COOKIE_PATH, httpOnly: true, secure: app.config.cookieSecure, sameSite: app.config.corsOrigin ? 'none' : 'strict', expires });
    await app.audit(undefined, a.id, 'platform_login', undefined, req.ip);
    return { ok: true };
  });

  f.post('/api/platform/logout', async (req, reply) => {
    const token = req.cookies?.[COOKIE];
    if (token) await db.query('DELETE FROM platform_sessions WHERE id = $1', [sha256(token)]);
    reply.clearCookie(COOKIE, { path: COOKIE_PATH });
    return { ok: true };
  });

  f.get('/api/platform/me', opts, async (req) => req.platformAdmin);

  f.post('/api/platform/password', opts, async (req) => {
    const { current: cur, next } = (req.body ?? {}) as { current?: unknown; next?: unknown };
    const pwErr = validatePassword(next);
    if (pwErr) fail(pwErr);
    const { rows } = await db.query<{ password_hash: string }>('SELECT password_hash FROM platform_admins WHERE id = $1', [req.platformAdmin!.id]);
    if (!rows[0] || !(await checkPassword(typeof cur === 'string' ? cur : '', rows[0].password_hash))) fail('Your current password is incorrect.');
    await db.query('UPDATE platform_admins SET password_hash = $2 WHERE id = $1', [req.platformAdmin!.id, await hashPassword(next as string)]);
    await db.query('DELETE FROM platform_sessions WHERE admin_id = $1 AND id <> $2', [req.platformAdmin!.id, sha256(req.cookies?.[COOKIE] ?? '')]);
    return { ok: true };
  });

  // -------------------------------------------------------------- firms
  /** Every firm with its size and its admins — nothing from inside the firm. */
  f.get('/api/platform/firms', opts, async () => {
    const firms = await db.query<{ id: string; name: string; created_at: Date; suspended_at: Date | null; members: number }>(
      `SELECT f.id, f.data->>'name' AS name, f.created_at, f.suspended_at,
              (SELECT count(*)::int FROM users u WHERE u.firm_id = f.id AND u.data->>'status' <> 'deactivated') AS members
         FROM firms f ORDER BY f.created_at`,
    );
    const admins = await db.query<{ id: string; firm_id: string; email: string; name: string; status: User['status']; has_password: boolean; last_login_at: Date | null }>(
      `SELECT u.id, u.firm_id, u.email, u.data->>'name' AS name, u.data->>'status' AS status, u.password_hash IS NOT NULL AS has_password,
              (SELECT max(a.created_at) FROM audit_log a WHERE a.user_id = u.id AND a.action = 'login') AS last_login_at
         FROM users u WHERE u.data->>'role' = 'admin' ORDER BY u.seq`,
    );
    const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
    return {
      firms: firms.rows.map((r) => ({
        id: r.id,
        name: r.name,
        createdAt: iso(r.created_at),
        suspendedAt: iso(r.suspended_at),
        members: Number(r.members),
        admins: admins.rows
          .filter((a) => a.firm_id === r.id)
          .map((a) => ({ id: a.id, email: a.email, name: a.name, status: a.status, hasPassword: a.has_password, lastLoginAt: iso(a.last_login_at) })),
      })),
    };
  });

  // A new firm with its first admin, who can sign in at once.
  f.post('/api/platform/firms', opts, async (req) => {
    const s = body(req);
    const firmName = s('firmName').slice(0, 120);
    const adminName = s('adminName').slice(0, 120);
    const email = s('email').toLowerCase();
    const password = (req.body as { password?: unknown })?.password;
    if (!firmName) fail('Firm name is required.');
    if (!adminName) fail('Admin name is required.');
    if (!EMAIL.test(email)) fail('Enter a valid email address.');
    const pwErr = validatePassword(password);
    if (pwErr) fail(pwErr);
    await emailFree(email);
    const { db: data, firmId, adminId } = newFirmDatabase(firmName, { name: adminName, email });
    await app.firms.create(data, firmId, { [adminId]: await hashPassword(password as string) });
    await audit(req, firmId, 'firm_created', { adminId });
    return { id: firmId };
  });

  // Suspend (no one in the firm can sign in; open sessions end) or reactivate.
  f.patch('/api/platform/firms/:id', opts, async (req) => {
    const { id } = req.params as { id: string };
    const suspended = (req.body as { suspended?: unknown })?.suspended;
    if (typeof suspended !== 'boolean') fail('Say whether the firm is suspended.');
    const { rows } = await db.query('UPDATE firms SET suspended_at = CASE WHEN $2::boolean THEN coalesce(suspended_at, now()) ELSE NULL END WHERE id = $1 RETURNING id', [id, suspended]);
    found(rows[0], 'Firm');
    if (suspended) await db.query('DELETE FROM sessions WHERE firm_id = $1', [id]);
    await audit(req, id, suspended ? 'firm_suspended' : 'firm_reactivated');
    return { ok: true };
  });

  // Deletes a firm and everything in it. The caller must repeat the firm's name.
  f.delete('/api/platform/firms/:id', opts, async (req) => {
    const { id } = req.params as { id: string };
    const { rows } = await db.query<{ name: string }>(`SELECT data->>'name' AS name FROM firms WHERE id = $1`, [id]);
    const firm = found(rows[0], 'Firm');
    if (body(req)('confirmName') !== firm.name) fail('Type the firm’s name exactly to confirm.');
    const { db: data } = await app.firms.get(id);
    // Stop Meta webhooks for numbers the firm connected (best effort).
    for (const n of data.waNumbers.filter((x) => x.status === 'connected'))
      await app.whatsapp.unsubscribe(n.wabaId, n.token).catch((e) => req.log.warn({ err: e }, 'Could not unsubscribe WhatsApp account'));
    const files = await db.query<{ storage_key: string }>('SELECT storage_key FROM files WHERE firm_id = $1', [id]);
    await db.tx(async (q) => {
      await q.query('DELETE FROM sessions WHERE firm_id = $1', [id]);
      await q.query('DELETE FROM invites WHERE firm_id = $1', [id]);
      await q.query('DELETE FROM firms WHERE id = $1', [id]); // users, records, files, whatsapp_numbers cascade
    });
    app.firms.invalidate(id);
    for (const r of files.rows) await app.storage.remove(r.storage_key).catch(() => {});
    await audit(req, id, 'firm_deleted', { name: firm.name });
    return { ok: true };
  });

  // -------------------------------------------------------- firm admins
  f.post('/api/platform/firms/:id/admins', opts, async (req) => {
    const { id: firmId } = req.params as { id: string };
    const s = body(req);
    const name = s('name').slice(0, 120);
    const email = s('email').toLowerCase();
    const password = (req.body as { password?: unknown })?.password;
    if (!name) fail('Name is required.');
    if (!EMAIL.test(email)) fail('Enter a valid email address.');
    const pwErr = validatePassword(password);
    if (pwErr) fail(pwErr);
    await emailFree(email);
    const user = newAdmin(name, email);
    const hash = await hashPassword(password as string);
    await app.firms.mutate(firmId, (cur) => ({ db: { ...cur, users: [...cur.users, user] }, result: null }));
    await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [user.id, hash]);
    await audit(req, firmId, 'admin_added', { userId: user.id });
    return { id: user.id };
  });

  f.patch('/api/platform/admins/:id', opts, async (req) => {
    const { id } = req.params as { id: string };
    const status = (req.body as { status?: unknown })?.status;
    if (status !== 'active' && status !== 'deactivated') fail('Status must be active or deactivated.');
    const target = await firmAdmin(id);
    if (status === 'active' && !target.has_password) fail('This admin has no password yet. Set one first, then activate them.');
    await app.firms.mutate(target.firm_id, (cur) => {
      const next = structuredClone(cur);
      found(next.users.find((u) => u.id === id), 'Firm admin').status = status;
      return { db: next, result: null };
    });
    if (status === 'deactivated') await revokeSessions(app, id);
    await audit(req, target.firm_id, status === 'active' ? 'admin_activated' : 'admin_deactivated', { userId: id });
    return { ok: true };
  });

  f.post('/api/platform/admins/:id/password', { ...opts, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const { id } = req.params as { id: string };
    const password = (req.body as { password?: unknown })?.password;
    const pwErr = validatePassword(password);
    if (pwErr) fail(pwErr);
    const target = await firmAdmin(id);
    await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [id, await hashPassword(password as string)]);
    await revokeSessions(app, id);
    await audit(req, target.firm_id, 'admin_password_reset', { userId: id });
    return { ok: true };
  });

  f.delete('/api/platform/admins/:id', opts, async (req) => {
    const { id } = req.params as { id: string };
    const target = await firmAdmin(id);
    await app.firms.mutate(target.firm_id, (cur) => {
      const next = structuredClone(cur);
      removeMember(next, id);
      return { db: next, result: null };
    });
    await audit(req, target.firm_id, 'admin_deleted', { userId: id });
    return { ok: true };
  });
}
