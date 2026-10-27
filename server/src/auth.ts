import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { App } from './app';
import { randomToken, sha256 } from './crypto';
import { checkPassword, hashPassword, newFirmDatabase, validatePassword } from './newFirm';

export const SESSION_COOKIE = 'lf_session';
const SESSION_DAYS = 30;
const INVITE_DAYS = 7;
// Compared against when an email doesn't exist, so timing doesn't reveal accounts.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword(randomToken()));

export interface AuthInfo {
  userId: string;
  firmId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthInfo;
  }
}

export async function createSession(app: App, reply: FastifyReply, req: FastifyRequest, userId: string, firmId: string) {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000);
  await app.db.query('INSERT INTO sessions (id, user_id, firm_id, expires_at, user_agent) VALUES ($1, $2, $3, $4, $5)', [sha256(token), userId, firmId, expires, String(req.headers['user-agent'] ?? '').slice(0, 300)]);
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    secure: app.config.cookieSecure,
    sameSite: app.config.corsOrigin ? 'none' : 'lax',
    expires,
  });
}

/** Resolves the session cookie. Only active users in an existing firm get through. */
export async function authenticate(app: App, req: FastifyRequest): Promise<AuthInfo | undefined> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return undefined;
  const { rows } = await app.db.query<{ user_id: string; firm_id: string; status: string }>(
    `SELECT s.user_id, s.firm_id, u.data->>'status' AS status
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expires_at > now()`,
    [sha256(token)],
  );
  const r = rows[0];
  if (!r || r.status !== 'active') return undefined;
  return { userId: r.user_id, firmId: r.firm_id };
}

export async function createInvite(app: App, userId: string, firmId: string) {
  const token = randomToken();
  await app.db.query('UPDATE invites SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [userId]);
  await app.db.query('INSERT INTO invites (id, user_id, firm_id, expires_at) VALUES ($1, $2, $3, $4)', [sha256(token), userId, firmId, new Date(Date.now() + INVITE_DAYS * 86400000)]);
  const url = `${app.config.publicUrl}/accept-invite?token=${token}`;
  const { rows } = await app.db.query<{ email: string; name: string; firm: string }>(
    `SELECT u.email, u.data->>'name' AS name, f.data->>'name' AS firm FROM users u JOIN firms f ON f.id = u.firm_id WHERE u.id = $1`,
    [userId],
  );
  let emailed = false;
  if (rows[0]) {
    emailed = await app.mailer
      .send(rows[0].email, `You're invited to ${rows[0].firm} on LedgerFlow`, `Hello ${rows[0].name},\n\nSet your password and sign in here (link valid for ${INVITE_DAYS} days):\n${url}\n`)
      .catch((e) => (app.log.warn({ err: e }, 'invite email failed'), false));
  }
  return { url, emailed };
}

export async function revokeSessions(app: App, userId: string) {
  await app.db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

export function registerAuthRoutes(f: FastifyInstance, app: App) {
  const loginLimit = { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } };

  f.post('/api/auth/login', loginLimit, async (req, reply) => {
    const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
    if (typeof email !== 'string' || typeof password !== 'string') return reply.code(400).send({ message: 'Email and password are required.' });
    const { rows } = await app.db.query<{ id: string; firm_id: string; password_hash: string | null; status: string }>(
      `SELECT id, firm_id, password_hash, data->>'status' AS status FROM users WHERE lower(email) = lower($1)`,
      [email.trim()],
    );
    const u = rows[0];
    const ok = await checkPassword(password, u?.password_hash ?? (await getDummyHash()));
    if (!u || !u.password_hash || !ok) {
      await app.audit(u?.firm_id, u?.id, 'login_failed', { email }, req.ip);
      return reply.code(401).send({ message: 'Email or password is incorrect.' });
    }
    if (u.status !== 'active') return reply.code(403).send({ message: 'Your account is not active. Ask your firm admin.' });
    await createSession(app, reply, req, u.id, u.firm_id);
    await app.audit(u.firm_id, u.id, 'login', undefined, req.ip);
    return { ok: true };
  });

  f.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) await app.db.query('DELETE FROM sessions WHERE id = $1', [sha256(token)]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  f.get('/api/auth/me', async (req, reply) => {
    const auth = await authenticate(app, req);
    if (!auth) return reply.code(401).send({ message: 'Not signed in.' });
    return auth;
  });

  f.post('/api/auth/register', loginLimit, async (req, reply) => {
    if (!app.config.allowSignup) return reply.code(403).send({ message: 'Sign-up is disabled on this server.' });
    const { firmName, name, email, password } = (req.body ?? {}) as Record<string, string>;
    if (!firmName?.trim() || !name?.trim()) return reply.code(400).send({ message: 'Firm name and your name are required.' });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply.code(400).send({ message: 'Enter a valid email address.' });
    const pwErr = validatePassword(password);
    if (pwErr) return reply.code(400).send({ message: pwErr });
    const exists = await app.db.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [email.trim()]);
    if (exists.rows.length) return reply.code(409).send({ message: 'An account with this email already exists.' });
    const { db, firmId, adminId } = newFirmDatabase(firmName, { name, email });
    await app.firms.create(db, firmId, { [adminId]: await hashPassword(password) });
    await createSession(app, reply, req, adminId, firmId);
    await app.audit(firmId, adminId, 'firm_registered', undefined, req.ip);
    return { ok: true };
  });

  f.get('/api/auth/invite/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    const { rows } = await app.db.query<{ name: string; email: string; firm: string }>(
      `SELECT u.data->>'name' AS name, u.email, f.data->>'name' AS firm
         FROM invites i JOIN users u ON u.id = i.user_id JOIN firms f ON f.id = i.firm_id
        WHERE i.id = $1 AND i.used_at IS NULL AND i.expires_at > now()`,
      [sha256(token)],
    );
    if (!rows[0]) return reply.code(404).send({ message: 'This invitation link is invalid or has expired.' });
    return rows[0];
  });

  f.post('/api/auth/accept-invite', loginLimit, async (req, reply) => {
    const { token, password } = (req.body ?? {}) as { token?: string; password?: string };
    const pwErr = validatePassword(password);
    if (pwErr) return reply.code(400).send({ message: pwErr });
    const { rows } = await app.db.query<{ user_id: string; firm_id: string }>('SELECT user_id, firm_id FROM invites WHERE id = $1 AND used_at IS NULL AND expires_at > now()', [sha256(token ?? '')]);
    const inv = rows[0];
    if (!inv) return reply.code(404).send({ message: 'This invitation link is invalid or has expired.' });
    const hash = await hashPassword(password!);
    let blocked = false;
    await app.firms.mutate(inv.firm_id, async (db, q) => {
      const next = structuredClone(db);
      const u = next.users.find((x) => x.id === inv.user_id);
      if (!u || u.status === 'deactivated') {
        blocked = true;
        return { db, result: null };
      }
      u.status = 'active';
      await q.query('UPDATE users SET password_hash = $2 WHERE id = $1', [inv.user_id, hash]);
      await q.query('UPDATE invites SET used_at = now() WHERE id = $1', [sha256(token!)]);
      return { db: next, result: null };
    });
    if (blocked) return reply.code(403).send({ message: 'This account has been deactivated.' });
    await revokeSessions(app, inv.user_id);
    await createSession(app, reply, req, inv.user_id, inv.firm_id);
    await app.audit(inv.firm_id, inv.user_id, 'invite_accepted', undefined, req.ip);
    return { ok: true };
  });

  f.post('/api/auth/password', async (req, reply) => {
    const auth = await authenticate(app, req);
    if (!auth) return reply.code(401).send({ message: 'Not signed in.' });
    const { current, next } = (req.body ?? {}) as { current?: string; next?: string };
    const pwErr = validatePassword(next);
    if (pwErr) return reply.code(400).send({ message: pwErr });
    const { rows } = await app.db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [auth.userId]);
    if (!rows[0]?.password_hash || !(await checkPassword(current ?? '', rows[0].password_hash))) return reply.code(400).send({ message: 'Your current password is incorrect.' });
    await app.db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [auth.userId, await hashPassword(next!)]);
    // Sign out other devices.
    const token = req.cookies?.[SESSION_COOKIE];
    await app.db.query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [auth.userId, sha256(token ?? '')]);
    await app.audit(auth.firmId, auth.userId, 'password_changed', undefined, req.ip);
    return { ok: true };
  });
}
