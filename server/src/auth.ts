import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { brand } from '@/config/brand';
import type { App } from './app';
import { isProd } from './config';
import { randomToken, sha256 } from './crypto';
import { checkPassword, hashPassword, validatePassword } from './newFirm';

export const SESSION_COOKIE = 'lf_session';
const SESSION_DAYS = 30;
const INVITE_DAYS = 7;
const RESET_MINUTES = 60;
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

/** Resolves the session cookie. Only active users in an existing, not suspended firm get through. */
export async function authenticate(app: App, req: FastifyRequest): Promise<AuthInfo | undefined> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return undefined;
  const { rows } = await app.db.query<{ user_id: string; firm_id: string; status: string }>(
    `SELECT s.user_id, s.firm_id, u.data->>'status' AS status
       FROM sessions s JOIN users u ON u.id = s.user_id JOIN firms f ON f.id = u.firm_id
      WHERE s.id = $1 AND s.expires_at > now() AND f.suspended_at IS NULL`,
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

/** A one-time link to choose a new password, emailed when SMTP is configured. Earlier unused links stop working. */
export async function createPasswordReset(app: App, userId: string) {
  const token = randomToken();
  await app.db.query('UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [userId]);
  await app.db.query('INSERT INTO password_resets (id, user_id, expires_at) VALUES ($1, $2, $3)', [sha256(token), userId, new Date(Date.now() + RESET_MINUTES * 60000)]);
  const url = `${app.config.publicUrl}/reset-password?token=${token}`;
  const { rows } = await app.db.query<{ email: string; name: string }>(`SELECT email, data->>'name' AS name FROM users WHERE id = $1`, [userId]);
  let emailed = false;
  if (rows[0]) {
    emailed = await app.mailer
      .send(
        rows[0].email,
        `Reset your ${brand.name} password`,
        `Hello ${rows[0].name},\n\nChoose a new password here (link valid for ${RESET_MINUTES} minutes, and only once):\n${url}\n\nIf you didn't ask for this, ignore this email; your password stays the same.\n`,
      )
      .catch((e) => (app.log.warn({ err: e }, 'password reset email failed'), false));
  }
  return { url, emailed };
}

/** The user a valid, unused reset token belongs to. */
async function resetTarget(app: App, token: string) {
  const { rows } = await app.db.query<{ user_id: string; firm_id: string; name: string; email: string; status: string; suspended: boolean }>(
    `SELECT u.id AS user_id, u.firm_id, u.data->>'name' AS name, u.email, u.data->>'status' AS status, f.suspended_at IS NOT NULL AS suspended
       FROM password_resets r JOIN users u ON u.id = r.user_id JOIN firms f ON f.id = u.firm_id
      WHERE r.id = $1 AND r.used_at IS NULL AND r.expires_at > now()`,
    [sha256(token)],
  );
  return rows[0];
}

export async function revokeSessions(app: App, userId: string) {
  await app.db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

export function registerAuthRoutes(f: FastifyInstance, app: App) {
  const loginLimit = { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } };

  f.post('/api/auth/login', loginLimit, async (req, reply) => {
    const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
    if (typeof email !== 'string' || typeof password !== 'string') return reply.code(400).send({ message: 'Email and password are required.' });
    const { rows } = await app.db.query<{ id: string; firm_id: string; password_hash: string | null; status: string; suspended: boolean }>(
      `SELECT u.id, u.firm_id, u.password_hash, u.data->>'status' AS status, f.suspended_at IS NOT NULL AS suspended
         FROM users u JOIN firms f ON f.id = u.firm_id WHERE lower(u.email) = lower($1)`,
      [email.trim()],
    );
    const u = rows[0];
    const ok = await checkPassword(password, u?.password_hash ?? (await getDummyHash()));
    if (!u || !u.password_hash || !ok) {
      await app.audit(u?.firm_id, u?.id, 'login_failed', { email }, req.ip);
      return reply.code(401).send({ message: 'Email or password is incorrect.' });
    }
    if (u.suspended) return reply.code(403).send({ message: 'Your firm’s account is suspended. Please contact support.' });
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

  // There is no self sign-up: firms are created by platform superadmins (see platform.ts).

  // ---------------------------------------------------- forgot password
  // Always answers the same, so it doesn't reveal which emails have accounts. The link is emailed;
  // without SMTP it is printed in the server log in development, and a firm admin can create one.
  f.post('/api/auth/forgot-password', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (req) => {
    const { email } = (req.body ?? {}) as { email?: unknown };
    if (typeof email === 'string' && email.trim()) {
      const { rows } = await app.db.query<{ id: string; firm_id: string }>(
        `SELECT u.id, u.firm_id FROM users u JOIN firms f ON f.id = u.firm_id
          WHERE lower(u.email) = lower($1) AND u.data->>'status' = 'active' AND u.password_hash IS NOT NULL AND f.suspended_at IS NULL`,
        [email.trim()],
      );
      const u = rows[0];
      await app.audit(u?.firm_id, u?.id, 'password_reset_requested', { email: email.trim().slice(0, 200) }, req.ip);
      // Not awaited: answering faster for real accounts would reveal them.
      if (u)
        void createPasswordReset(app, u.id)
          .then((r) => {
            if (r.emailed) return;
            if (isProd) app.log.warn({ userId: u.id }, 'Password reset requested, but SMTP_URL is not set so no email was sent.');
            else app.log.warn(`Password reset link for ${email.trim()} (development, no SMTP configured): ${r.url}`);
          })
          .catch((e) => app.log.error({ err: e }, 'Could not create password reset'));
    }
    return { ok: true };
  });

  f.get('/api/auth/reset/:token', async (req, reply) => {
    const t = await resetTarget(app, (req.params as { token: string }).token);
    if (!t || t.status !== 'active' || t.suspended) return reply.code(404).send({ message: 'This reset link is invalid or has expired.' });
    return { name: t.name, email: t.email };
  });

  f.post('/api/auth/reset-password', loginLimit, async (req, reply) => {
    const { token, password } = (req.body ?? {}) as { token?: unknown; password?: unknown };
    const pwErr = validatePassword(password);
    if (pwErr) return reply.code(400).send({ message: pwErr });
    const t = typeof token === 'string' ? await resetTarget(app, token) : undefined;
    if (!t) return reply.code(404).send({ message: 'This reset link is invalid or has expired.' });
    if (t.suspended) return reply.code(403).send({ message: 'Your firm’s account is suspended. Please contact support.' });
    if (t.status !== 'active') return reply.code(403).send({ message: 'Your account is not active. Ask your firm admin.' });
    // Claim the link atomically so it works only once.
    const claimed = await app.db.query('UPDATE password_resets SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING id', [sha256(token as string)]);
    if (!claimed.rows.length) return reply.code(404).send({ message: 'This reset link is invalid or has expired.' });
    await app.db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [t.user_id, await hashPassword(password as string)]);
    await app.db.query('UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [t.user_id]);
    await revokeSessions(app, t.user_id);
    await createSession(app, reply, req, t.user_id, t.firm_id);
    await app.audit(t.firm_id, t.user_id, 'password_reset', undefined, req.ip);
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
