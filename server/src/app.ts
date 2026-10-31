import crypto from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { commands, type CommandName } from '@/domain/commands';
import type { ProposedId } from '@/domain/context';
import { classifyError, execute } from '@/domain/execute';
import { parseCommandArgs, ArgsError } from '@/domain/schemas';
import { canAccessFile, scopeDatabase } from '@/domain/scope';
import { checkGstin, lookupGstin } from '@/lib/gstin';
import { canManageFirm, canManageTeam, canViewClient, canWorkOnTask } from '@/lib/permissions';
import type { ChatMessage, Database, User } from '@/types';
import { authenticate, createInvite, createPasswordReset, registerAuthRoutes, revokeSessions } from './auth';
import type { Config } from './config';
import { makeCipher, newId } from './crypto';
import type { Db } from './db';
import { Events } from './events';
import { FirmNotFound, FirmStore } from './firmStore';
import { makeMailer, type Mailer } from './mail';
import { localStorage, type Storage } from './storage';
import { registerPlatformRoutes } from './platform';
import { makeWhatsApp, type WhatsApp } from './whatsapp';

export interface App {
  config: Config;
  db: Db;
  firms: FirmStore;
  events: Events;
  storage: Storage;
  mailer: Mailer;
  whatsapp: WhatsApp;
  log: FastifyInstance['log'];
  audit(firmId: string | undefined, userId: string | undefined, action: string, detail?: unknown, ip?: string): Promise<void>;
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Replaces JSON nulls with undefined (the browser sends cleared fields as null). */
function denull(v: unknown): unknown {
  if (v === null) return undefined;
  if (Array.isArray(v)) return v.map(denull);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, denull(x)]));
  return v;
}

export async function buildApp(config: Config, db: Db) {
  const f = Fastify({ logger: { level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info') }, bodyLimit: 2 * 1024 * 1024, trustProxy: true });
  const events = new Events(db);
  await events.start();
  const app: App = {
    config,
    db,
    events,
    firms: new FirmStore(db, makeCipher(config.appSecret), events),
    storage: localStorage(config.storageDir),
    mailer: makeMailer(config),
    whatsapp: makeWhatsApp(config),
    log: f.log,
    async audit(firmId, userId, action, detail, ip) {
      await db.query('INSERT INTO audit_log (firm_id, user_id, action, detail, ip) VALUES ($1, $2, $3, $4, $5)', [firmId ?? null, userId ?? null, action, detail ? JSON.stringify(detail) : null, ip ?? null]).catch(() => {});
    },
  };

  await f.register(cookie);
  await f.register(rateLimit, { max: 600, timeWindow: '1 minute' });
  await f.register(multipart, { limits: { fileSize: config.fileMaxMb * 1024 * 1024, files: 1 } });

  // ---------------------------------------------------- security & CORS
  f.addHook('onRequest', async (req, reply) => {
    if (config.corsOrigin && req.headers.origin === config.corsOrigin) {
      reply.header('access-control-allow-origin', config.corsOrigin);
      reply.header('access-control-allow-credentials', 'true');
      reply.header('vary', 'origin');
      if (req.method === 'OPTIONS') {
        reply.header('access-control-allow-headers', 'content-type, x-ledgerflow');
        reply.header('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE');
        return reply.code(204).send();
      }
    }
    // CSRF: state-changing API calls must carry a custom header (forms and
    // cross-site requests can't add one without passing CORS).
    if (req.url.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !req.url.startsWith('/api/webhooks/') && req.headers['x-ledgerflow'] !== '1')
      return reply.code(403).send({ message: 'Missing request header.' });
  });
  f.addHook('onSend', async (_req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'same-origin');
    reply.header('x-frame-options', 'DENY');
    if (String(reply.getHeader('content-type') ?? '').startsWith('text/html'))
      reply.header(
        'content-security-policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      );
    return payload;
  });

  f.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ message: err.message });
    if (err instanceof ArgsError) return reply.code(400).send({ message: err.message, code: 'invalid_args' });
    if (err instanceof FirmNotFound) return reply.code(404).send({ message: 'Firm not found.' });
    const pgCode = (err as { code?: string }).code;
    if (pgCode === '23505') return reply.code(409).send({ message: 'That email or record already exists.', code: 'conflict' });
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode && statusCode < 500) return reply.code(statusCode).send({ message: (err as Error).message });
    const { kind, message } = classifyError(err);
    if (kind === 'permission') return reply.code(403).send({ message, code: 'forbidden' });
    if (kind === 'validation') return reply.code(400).send({ message, code: 'invalid' });
    if (kind === 'not_found') return reply.code(404).send({ message, code: 'not_found' });
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ message: 'Something went wrong on the server.' });
  });

  registerAuthRoutes(f, app);
  registerPlatformRoutes(f, app);

  const requireAuth = async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await authenticate(app, req);
    if (!auth) return reply.code(401).send({ message: 'Not signed in.' });
    req.auth = auth;
  };
  /** Current firm data plus the signed-in user. */
  const context = async (req: FastifyRequest) => {
    const { db: data, version } = await app.firms.get(req.auth!.firmId);
    const me = data.users.find((u) => u.id === req.auth!.userId);
    if (!me || me.status !== 'active') throw new HttpError(401, 'Not signed in.');
    return { data, version, me };
  };

  f.get('/api/health', async () => ({ ok: true, db: db.kind }));

  // -------------------------------------------------------------- bootstrap
  f.get('/api/bootstrap', { preHandler: requireAuth }, async (req) => {
    const { data, version, me } = await context(req);
    return {
      db: scopeDatabase(data, me),
      meId: me.id,
      version,
      caps: {
        // Live when the server has a default number or the firm has connected one of its own.
        whatsapp: app.whatsapp.mode === 'meta' || data.waNumbers.some((n) => n.status === 'connected') ? 'meta' : 'simulated',
        whatsappNumber: await app.whatsapp.displayNumber(),
        whatsappDefault: app.whatsapp.mode === 'meta',
        email: app.mailer.enabled,
        gstLookup: config.gstApi ? 'provider' : 'demo',
        noticeFetch: data.firm.isDemo ? 'demo' : 'manual',
        storage: app.storage.kind,
      },
    };
  });

  // --------------------------------------------------------------- commands
  f.post('/api/commands/:name', { preHandler: requireAuth }, async (req) => {
    const name = (req.params as { name: string }).name as CommandName;
    if (!Object.prototype.hasOwnProperty.call(commands, name)) throw new HttpError(404, 'Unknown command.');
    const body = (req.body ?? {}) as { args?: unknown; ids?: unknown };
    const args = parseCommandArgs(name, denull(body.args));
    const ids = sanitizeIds(body.ids);
    const { firmId, userId } = req.auth!;
    await verifyFileRefs(app, firmId, userId, name, args);

    const out = await app.firms.mutate(firmId, async (current, q) => {
      const r = execute(current, userId, name, args as never, { proposedIds: ids });
      await q.query('INSERT INTO audit_log (firm_id, user_id, action, detail, ip) VALUES ($1, $2, $3, $4, $5)', [firmId, userId, `command:${name}`, JSON.stringify(auditDetail(name, args)), req.ip]);
      return { db: r.db, result: { value: r.result as unknown, used: r.ids, before: current, after: r.db } };
    });

    const meta: { inviteUrl?: string; emailed?: boolean } = {};
    const { value, used, before, after } = out.result;
    if (name === 'inviteMember' && value) {
      const inv = await createInvite(app, (value as User).id, firmId);
      meta.inviteUrl = inv.url;
      meta.emailed = inv.emailed;
    }
    if (name === 'updateMember' && (args[1] as { status?: string })?.status === 'deactivated') await revokeSessions(app, args[0] as string);
    if (name === 'sendChat' || name === 'sendBroadcast') {
      const known = new Set(before.chats.map((c) => c.id));
      void dispatchWhatsApp(app, firmId, after, after.chats.filter((c) => !known.has(c.id) && c.direction === 'out'));
    }
    return { ok: true, version: out.version, idsChanged: idsDiffer(ids, used), meta: Object.keys(meta).length ? meta : undefined };
  });

  // ------------------------------------------------------------------ files
  f.post('/api/files', { preHandler: requireAuth }, async (req, reply) => {
    const { taskId, clientId } = req.query as { taskId?: string; clientId?: string };
    const { data, me } = await context(req);
    if (taskId) {
      const t = data.tasks.find((x) => x.id === taskId);
      if (!t || !canWorkOnTask(data, me, t)) throw new HttpError(403, 'You cannot add files to this task.');
    } else if (clientId) {
      const c = data.clients.find((x) => x.id === clientId);
      if (!c || !canViewClient(data, me, c)) throw new HttpError(403, 'You cannot add files for this client.');
    } else throw new HttpError(400, 'Say which task or client the file belongs to.');
    const part = await req.file();
    if (!part) throw new HttpError(400, 'No file received.');
    const id = newId('fil');
    const key = `${req.auth!.firmId}/${id}`;
    const size = await app.storage.put(key, part.file);
    if (part.file.truncated) {
      await app.storage.remove(key);
      return reply.code(413).send({ message: `Files must be smaller than ${config.fileMaxMb} MB.` });
    }
    const filename = part.filename.replace(/[\\/\0]/g, '_').slice(0, 200) || 'file';
    await db.query('INSERT INTO files (id, firm_id, name, size_bytes, mime, storage_key, uploaded_by, task_id, client_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
      id, req.auth!.firmId, filename, size, part.mimetype, key, me.id, taskId ?? null, clientId ?? null,
    ]);
    return { fileId: id, name: filename, sizeKb: Math.max(1, Math.round(size / 1024)) };
  });

  f.get('/api/files/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { rows } = await db.query<{ name: string; storage_key: string; uploaded_by: string; size_bytes: string }>('SELECT name, storage_key, uploaded_by, size_bytes FROM files WHERE id = $1 AND firm_id = $2', [id, req.auth!.firmId]);
    const file = rows[0];
    if (!file) throw new HttpError(404, 'File not found.');
    const { data, me } = await context(req);
    if (file.uploaded_by !== me.id && !canAccessFile(data, me, id)) throw new HttpError(404, 'File not found.');
    reply.header('content-type', 'application/octet-stream');
    reply.header('content-length', file.size_bytes);
    reply.header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    reply.header('cache-control', 'private, no-store');
    return reply.send(app.storage.get(file.storage_key));
  });

  // ------------------------------------------------- secrets & integrations
  /**
   * One saved login of one client. `ref` is the login id (or, for older records, its position);
   * when the caller says which portal it expects, a mismatch is refused rather than guessed.
   */
  const clientLogin = async (req: FastifyRequest, ref: string, expectedPortalId?: string) => {
    const { id } = req.params as { id: string };
    const { data, me } = await context(req);
    const c = data.clients.find((x) => x.id === id);
    if (!c || !canViewClient(data, me, c)) throw new HttpError(404, 'Client not found.');
    const logins = c.portalLogins ?? [];
    const login = /^\d+$/.test(ref) ? logins[Number(ref)] : logins.find((l) => l.id === ref);
    if (!login) throw new HttpError(404, 'Login not found.');
    if (expectedPortalId && login.portalId !== expectedPortalId) throw new HttpError(409, 'This login belongs to a different portal. Refresh and try again.');
    return { data, me, client: c, login };
  };

  f.get('/api/clients/:id/logins/:ref', { preHandler: requireAuth }, async (req, reply) => {
    const { ref } = req.params as { ref: string };
    const { me, client, login } = await clientLogin(req, ref, (req.query as { portalId?: string }).portalId);
    await app.audit(req.auth!.firmId, me.id, 'portal_password_viewed', { clientId: client.id, portalId: login.portalId }, req.ip);
    reply.header('cache-control', 'private, no-store');
    return { password: login.password };
  });

  // Hands one client's credentials for one portal to the browser that is about to sign in.
  f.post('/api/clients/:id/logins/:ref/launch', { preHandler: requireAuth, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { ref } = req.params as { ref: string };
    const portalId = String((req.body as { portalId?: unknown } | undefined)?.portalId ?? '');
    if (!portalId) throw new HttpError(400, 'Say which portal to sign in to.');
    const { data, me, client, login } = await clientLogin(req, ref, portalId);
    if (client.exitDate) throw new HttpError(403, 'This client has left the firm. Re-activate them to use their portal logins.');
    if (!data.portals.some((p) => p.id === portalId)) throw new HttpError(404, 'Portal not found.');
    if (!login.password) throw new HttpError(409, 'No password is saved for this login. Add one under Edit client → Login Details.');
    await app.audit(req.auth!.firmId, me.id, 'portal_login_launched', { clientId: client.id, portalId, loginId: login.id }, req.ip);
    reply.header('cache-control', 'private, no-store');
    return { clientId: client.id, portalId, username: login.username, password: login.password, extra: login.extra };
  });

  f.get('/api/gstin/:gstin', { preHandler: requireAuth }, async (req) => {
    const gstin = (req.params as { gstin: string }).gstin.toUpperCase();
    const chk = checkGstin(gstin);
    if (!chk.ok) throw new HttpError(400, chk.error);
    let record: unknown = null;
    let source: 'demo' | 'provider' = 'demo';
    if (config.gstApi) {
      source = 'provider';
      record = await fetchGstProvider(config.gstApi, gstin).catch((e) => (req.log.warn({ err: e }, 'GST provider lookup failed'), null));
    } else record = lookupGstin(gstin) ?? null;
    return { record, pan: chk.pan, state: chk.state, checksumOk: chk.checksumOk, source };
  });

  f.post('/api/users/:id/invite-link', { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    const { data, me } = await context(req);
    if (!canManageTeam(me)) throw new HttpError(403, 'Only firm admins can send invitations.');
    const u = data.users.find((x) => x.id === id);
    if (!u || u.status === 'deactivated') throw new HttpError(404, 'Member not found.');
    const inv = await createInvite(app, u.id, req.auth!.firmId);
    await app.audit(req.auth!.firmId, me.id, 'invite_link_created', { userId: u.id }, req.ip);
    return { inviteUrl: inv.url, emailed: inv.emailed };
  });

  // For a member who forgot their password when email isn't set up: the admin shares the link.
  f.post('/api/users/:id/reset-link', { preHandler: requireAuth, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const { id } = req.params as { id: string };
    const { data, me } = await context(req);
    if (!canManageTeam(me)) throw new HttpError(403, 'Only firm admins can reset passwords.');
    const u = data.users.find((x) => x.id === id);
    if (!u) throw new HttpError(404, 'Member not found.');
    if (u.status !== 'active') throw new HttpError(400, u.status === 'invited' ? 'This member hasn’t joined yet. Resend their invite instead.' : 'Restore this member before resetting their password.');
    const r = await createPasswordReset(app, u.id);
    await app.audit(req.auth!.firmId, me.id, 'password_reset_link_created', { userId: u.id }, req.ip);
    return { resetUrl: r.url, emailed: r.emailed };
  });

  // ---------------------------------------------------------- live updates
  f.get('/api/events', { preHandler: requireAuth }, async (req, reply) => {
    const { version } = await app.firms.get(req.auth!.firmId);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      ...(config.corsOrigin ? { 'access-control-allow-origin': config.corsOrigin, 'access-control-allow-credentials': 'true' } : {}),
    });
    const send = (v: number) => res.write(`event: version\ndata: ${v}\n\n`);
    send(version);
    const off = app.events.subscribe(req.auth!.firmId, send);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.raw.on('close', () => {
      off();
      clearInterval(ping);
    });
  });

  // ------------------------------------------------------ WhatsApp webhook
  await f.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
      (req as FastifyRequest & { rawBody?: Buffer }).rawBody = body as Buffer;
      try {
        done(null, JSON.parse((body as Buffer).toString('utf8') || '{}'));
      } catch (e) {
        done(e as Error, undefined);
      }
    });
    scope.get('/api/webhooks/whatsapp', async (req, reply) => {
      const q = req.query as Record<string, string>;
      if (q['hub.mode'] === 'subscribe' && config.whatsapp?.verifyToken && q['hub.verify_token'] === config.whatsapp.verifyToken) return reply.type('text/plain').send(q['hub.challenge']);
      return reply.code(403).send({ message: 'Verification failed.' });
    });
    scope.post('/api/webhooks/whatsapp', async (req, reply) => {
      const raw = (req as FastifyRequest & { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
      const sig = String(req.headers['x-hub-signature-256'] ?? '');
      const changes = ((req.body as WaWebhook)?.entry ?? []).flatMap((e) => e.changes ?? []).map((c) => c.value ?? {});
      const phoneIds = [...new Set(changes.map((v) => v.metadata?.phone_number_id).filter((x): x is string => !!x))];
      const { rows: routes } = phoneIds.length
        ? await db.query<{ phone_number_id: string; firm_id: string; number_id: string }>('SELECT phone_number_id, firm_id, number_id FROM whatsapp_numbers WHERE phone_number_id = ANY($1)', [phoneIds])
        : { rows: [] };

      // The endpoint is public, so only Meta-signed calls are accepted. A call is signed with the
      // secret of the Meta app it comes from: ours (WHATSAPP_APP_SECRET) or the app a firm used to
      // connect its own number. A firm's secret only vouches for that firm's numbers.
      const signers: { secret: string; phoneIds?: Set<string> }[] = [];
      if (config.whatsapp?.appSecret) signers.push({ secret: config.whatsapp.appSecret });
      for (const r of routes) {
        const n = (await app.firms.get(r.firm_id)).db.waNumbers.find((x) => x.id === r.number_id && x.status === 'connected');
        if (n?.appSecret) signers.push({ secret: n.appSecret, phoneIds: new Set([r.phone_number_id]) });
      }
      if (!signers.length) {
        req.log.warn('WhatsApp webhook call refused: no app secret is configured for it.');
        return reply.code(503).send({ message: 'WhatsApp webhook is not configured.' });
      }
      const signer = signers.find((s) => validSignature(s.secret, raw, sig));
      if (!signer) return reply.code(401).send({ message: 'Bad signature.' });

      // Route each change to the firm and number it belongs to.
      const byFirm = new Map<string, WaDelivery[]>();
      const legacyFirm = !signer.phoneIds && config.whatsapp ? (config.whatsapp.firmId ?? (await onlyFirmId(app))) : undefined;
      for (const value of changes) {
        const pid = value.metadata?.phone_number_id;
        const route = routes.find((r) => r.phone_number_id === pid);
        let dest: { firmId: string; numberId?: string } | undefined;
        if (route && (!signer.phoneIds || signer.phoneIds.has(route.phone_number_id))) dest = { firmId: route.firm_id, numberId: route.number_id };
        else if (!route && legacyFirm && (!pid || pid === config.whatsapp?.phoneId)) dest = { firmId: legacyFirm };
        if (!dest) continue;
        byFirm.set(dest.firmId, [...(byFirm.get(dest.firmId) ?? []), { value, numberId: dest.numberId }]);
      }
      for (const [firmId, items] of byFirm) await applyWhatsAppWebhook(app, firmId, items);
      return { ok: true };
    });
  });

  // ------------------------------------------------- WhatsApp numbers (admin)
  /** What a firm admin pastes into their own Meta app so its webhooks reach us. */
  f.get('/api/whatsapp/setup', { preHandler: requireAuth }, async (req) => {
    const { me } = await context(req);
    if (!canManageFirm(me)) throw new HttpError(403, 'Only firm admins can connect WhatsApp numbers.');
    return { callbackUrl: `${config.publicUrl}/api/webhooks/whatsapp`, verifyToken: config.whatsapp?.verifyToken ?? null };
  });

  f.post('/api/whatsapp/numbers', { preHandler: requireAuth, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const { data, me } = await context(req);
    if (!canManageFirm(me)) throw new HttpError(403, 'Only firm admins can connect WhatsApp numbers.');
    const b = (req.body ?? {}) as Record<string, unknown>;
    const str = (k: string) => (typeof b[k] === 'string' ? (b[k] as string).trim() : '');
    const phoneNumberId = str('phoneNumberId');
    const wabaId = str('wabaId');
    const token = str('token');
    const appSecret = str('appSecret');
    const label = str('label').slice(0, 60);
    if (!/^\d{5,30}$/.test(phoneNumberId)) throw new HttpError(400, 'Enter the Phone Number ID (digits only) from Meta → WhatsApp → API Setup.');
    if (!/^\d{5,30}$/.test(wabaId)) throw new HttpError(400, 'Enter the WhatsApp Business Account ID (digits only).');
    if (token.length < 20 || token.length > 2000 || /\s/.test(token)) throw new HttpError(400, 'Paste the full access token.');
    if (!/^[0-9a-f]{32}$/i.test(appSecret)) throw new HttpError(400, 'Paste the App secret (32 characters) from your Meta app’s Settings → Basic.');
    const prev = data.waNumbers.find((n) => n.phoneNumberId === phoneNumberId);
    if (prev?.status === 'connected') throw new HttpError(409, `${prev.label || prev.displayNumber} is already connected.`);

    let info: { displayNumber: string; verifiedName: string };
    try {
      info = await app.whatsapp.lookupNumber(phoneNumberId, token);
    } catch (e) {
      throw new HttpError(400, `Meta did not accept these details: ${(e as Error).message}`);
    }
    try {
      await app.whatsapp.subscribe(wabaId, token);
    } catch (e) {
      throw new HttpError(400, `Couldn’t subscribe to this account’s messages: ${(e as Error).message} Check the WhatsApp Business Account ID and that the token has the whatsapp_business_management permission.`);
    }

    const firmId = req.auth!.firmId;
    const numberId = prev?.id ?? newId('wan');
    await app.firms.mutate(firmId, async (current, q) => {
      // Claim the number for this firm in the same transaction; one firm per number.
      const claimed = await q.query(
        `INSERT INTO whatsapp_numbers (phone_number_id, firm_id, number_id) VALUES ($1, $2, $3)
         ON CONFLICT (phone_number_id) DO UPDATE SET number_id = EXCLUDED.number_id WHERE whatsapp_numbers.firm_id = EXCLUDED.firm_id
         RETURNING firm_id`,
        [phoneNumberId, firmId, numberId],
      );
      if (!claimed.rows.length) throw new HttpError(409, 'This WhatsApp number is already connected to another LedgerFlow account.');
      const next = structuredClone(current);
      const record = {
        id: numberId,
        phoneNumberId,
        wabaId,
        displayNumber: info.displayNumber,
        verifiedName: info.verifiedName,
        label: label || info.verifiedName || info.displayNumber,
        status: 'connected' as const,
        token,
        appSecret,
        connectedAt: new Date().toISOString(),
        connectedBy: me.id,
      };
      next.waNumbers = prev ? next.waNumbers.map((n) => (n.id === numberId ? record : n)) : [...next.waNumbers, record];
      return { db: next, result: null };
    });
    await app.audit(firmId, me.id, 'whatsapp_number_connected', { numberId, phoneNumberId, wabaId }, req.ip);
    return { id: numberId, displayNumber: info.displayNumber, verifiedName: info.verifiedName };
  });

  f.delete('/api/whatsapp/numbers/:id', { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    const { data, me } = await context(req);
    if (!canManageFirm(me)) throw new HttpError(403, 'Only firm admins can remove WhatsApp numbers.');
    const n = data.waNumbers.find((x) => x.id === id);
    if (!n) throw new HttpError(404, 'WhatsApp number not found.');
    if (n.status !== 'connected') return { ok: true };
    // Stop this account's webhooks unless another of the firm's numbers still uses it.
    if (!data.waNumbers.some((x) => x.id !== id && x.status === 'connected' && x.wabaId === n.wabaId))
      await app.whatsapp.unsubscribe(n.wabaId, n.token).catch((e) => req.log.warn({ err: e }, 'Could not unsubscribe WhatsApp account'));
    const firmId = req.auth!.firmId;
    await app.firms.mutate(firmId, async (current, q) => {
      await q.query('DELETE FROM whatsapp_numbers WHERE phone_number_id = $1 AND firm_id = $2', [n.phoneNumberId, firmId]);
      const next = structuredClone(current);
      // History stays; the credentials go.
      next.waNumbers = next.waNumbers.map((x) => (x.id === id ? { ...x, status: 'disconnected' as const, token: '', appSecret: '', disconnectedAt: new Date().toISOString() } : x));
      return { db: next, result: null };
    });
    await app.audit(firmId, me.id, 'whatsapp_number_disconnected', { numberId: id, phoneNumberId: n.phoneNumberId }, req.ip);
    return { ok: true };
  });

  // ---------------------------------------------------- frontend (optional)
  if (config.staticDir) {
    await f.register(fastifyStatic, { root: config.staticDir, wildcard: false, index: false });
    f.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.method !== 'GET') return reply.code(404).send({ message: 'Not found.' });
      return reply.type('text/html').sendFile('index.html');
    });
  }

  return { fastify: f, app };
}

// ------------------------------------------------------------------ helpers

function sanitizeIds(raw: unknown): ProposedId[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 2000)
    .filter((x): x is ProposedId => !!x && typeof x === 'object' && typeof (x as ProposedId).p === 'string' && typeof (x as ProposedId).id === 'string')
    .map((x) => ({ p: x.p.slice(0, 20), id: x.id.slice(0, 64) }));
}

function idsDiffer(proposed: ProposedId[], used: ProposedId[]) {
  if (!proposed.length) return false;
  return used.some((u, i) => proposed[i] && (proposed[i].p !== u.p || proposed[i].id !== u.id));
}

/** What the audit log keeps about a command: identifiers, never message bodies or secrets. */
function auditDetail(name: CommandName, args: unknown[]) {
  const first = args[0];
  return { target: typeof first === 'string' ? first : undefined, name };
}

/** Uploaded files referenced by a command must belong to this firm, this user and the right task/client. */
async function verifyFileRefs(app: App, firmId: string, userId: string, name: CommandName, args: unknown[]) {
  let refs: { fileId: string; taskId?: string; clientId?: string }[] = [];
  if (name === 'addAttachment') {
    const f = args[1] as { fileId?: string };
    if (f?.fileId) refs = [{ fileId: f.fileId, taskId: args[0] as string }];
  }
  if (name === 'addDriveFiles') refs = ((args[2] as { fileId?: string }[]) ?? []).filter((x) => x.fileId).map((x) => ({ fileId: x.fileId!, clientId: args[0] as string }));
  for (const r of refs) {
    const { rows } = await app.db.query('SELECT 1 FROM files WHERE id = $1 AND firm_id = $2 AND uploaded_by = $3 AND (task_id = $4 OR client_id = $5)', [r.fileId, firmId, userId, r.taskId ?? null, r.clientId ?? null]);
    if (!rows.length) throw new HttpError(400, 'Uploaded file not found. Please upload it again.');
  }
}

/** Sends new outgoing chat messages and records the delivery result. */
async function dispatchWhatsApp(app: App, firmId: string, db: Database, chats: ChatMessage[]) {
  if (!chats.length) return;
  const results = new Map<string, { status: ChatMessage['status']; externalId?: string; error?: string }>();
  for (const c of chats) {
    const phone = db.clients.find((x) => x.id === c.clientId)?.phone ?? '';
    // Each message goes out through the number it belongs to; unset means the server's default.
    const n = c.numberId ? db.waNumbers.find((x) => x.id === c.numberId) : undefined;
    if (c.numberId && n?.status !== 'connected') {
      results.set(c.id, { status: 'failed', error: 'This WhatsApp number is disconnected.' });
      continue;
    }
    const creds = n ? { phoneId: n.phoneNumberId, token: n.token } : app.whatsapp.defaultCreds;
    const r = await app.whatsapp.send(phone, c.body, creds);
    results.set(c.id, r.ok ? { status: creds ? 'sent' : 'delivered', externalId: r.externalId } : { status: 'failed', error: (r.error ?? 'Not delivered').slice(0, 300) });
    if (!r.ok) app.log.warn({ chatId: c.id, error: r.error }, 'WhatsApp send failed');
  }
  await app.firms
    .mutate(firmId, (current) => {
      const next = structuredClone(current);
      for (const m of next.chats) {
        const r = results.get(m.id);
        if (r) Object.assign(m, r);
      }
      return { db: next, result: null };
    })
    .catch((e) => app.log.error({ err: e }, 'Could not record WhatsApp delivery'));
}

interface WaValue {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  statuses?: { id: string; status: string; errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[] }[];
  messages?: { from: string; id: string; timestamp?: string; text?: { body?: string }; type: string }[];
  contacts?: { wa_id: string; profile?: { name?: string } }[];
}
interface WaWebhook {
  entry?: { changes?: { value?: WaValue }[] }[];
}
/** One webhook change, already routed to a firm; `numberId` unset = the server's default number. */
interface WaDelivery {
  value: WaValue;
  numberId?: string;
}

function validSignature(secret: string, raw: Buffer, sig: string) {
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
  return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

/** The firm webhooks belong to when WHATSAPP_FIRM_ID is not set: the only one, if there is exactly one. */
async function onlyFirmId(app: App) {
  const { rows } = await app.db.query<{ id: string }>('SELECT id FROM firms LIMIT 2');
  return rows.length === 1 ? rows[0].id : undefined;
}

async function applyWhatsAppWebhook(app: App, firmId: string, items: WaDelivery[]) {
  const statuses = items.flatMap((d) => d.value.statuses ?? []);
  const messages = items.flatMap((d) => (d.value.messages ?? []).map((m) => ({ ...m, numberId: d.numberId })));
  const names = new Map(items.flatMap((d) => d.value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name?.trim()]));
  if (!statuses.length && !messages.length) return;
  const digits = (s: string) => s.replace(/\D/g, '').slice(-10);
  await app.firms.mutate(firmId, (current) => {
    const next = structuredClone(current);
    for (const s of statuses) {
      const m = next.chats.find((c) => c.externalId === s.id);
      if (m && ['sent', 'delivered', 'read', 'failed'].includes(s.status)) {
        m.status = s.status as ChatMessage['status'];
        const e = s.errors?.[0];
        if (s.status === 'failed' && e) m.error = `(#${e.code ?? '?'}) ${e.error_data?.details || e.message || e.title || 'Not delivered'}`.slice(0, 300);
      }
    }
    for (const msg of messages) {
      if (next.chats.some((c) => c.externalId === msg.id)) continue;
      const client = next.clients.find((c) => digits(c.phone) === digits(msg.from) || c.contacts?.some((p) => digits(p.phone) === digits(msg.from))) ?? newContactClient(next, msg.from, names.get(msg.from));
      if (!client) continue;
      const sent = Number(msg.timestamp);
      next.chats.push({
        id: newId('wa'),
        clientId: client.id,
        direction: 'in',
        body: msg.text?.body ?? `[${msg.type}]`,
        at: (Number.isFinite(sent) && sent > 0 ? new Date(sent * 1000) : new Date()).toISOString(),
        status: 'read',
        externalId: msg.id,
        ...(msg.numberId ? { numberId: msg.numberId } : {}),
      });
    }
    return { db: next, result: null };
  });
}

/**
 * Someone not on the client list wrote in: add them as an onboarding client so the
 * conversation shows up, with the first admin as relationship manager. Staff can rename,
 * fill in details, or merge them later.
 */
function newContactClient(db: Database, from: string, profileName?: string) {
  const rm = db.users.find((u) => u.role === 'admin' && u.status === 'active');
  if (!rm) return undefined;
  const phone = `+${from.replace(/\D/g, '')}`;
  let code = `WA-${from.slice(-4)}`;
  for (let n = 2; db.clients.some((c) => c.code === code); n++) code = `WA-${from.slice(-4)}-${n}`;
  const name = profileName || phone;
  const client: Database['clients'][number] = {
    id: newId('cl'),
    code,
    name,
    entityType: 'Individual',
    industry: '',
    contactName: name,
    email: '',
    phone,
    city: '',
    relationshipManagerId: rm.id,
    teamIds: [],
    status: 'onboarding',
    since: new Date().toISOString().slice(0, 10),
    notes: 'Added automatically from an incoming WhatsApp message.',
  };
  db.clients.push(client);
  return client;
}

/**
 * GST lookup through a configured provider. Providers differ; this maps the
 * common GSTN field names (lgnm, tradeNam, ctb, rgdt, sts, pradr). Adjust for
 * your provider's response shape.
 */
async function fetchGstProvider(api: { url: string; key?: string }, gstin: string) {
  const res = await fetch(`${api.url}/${gstin}`, { headers: api.key ? { authorization: `Bearer ${api.key}` } : {} });
  if (!res.ok) throw new Error(`GST provider returned ${res.status}`);
  const raw = (await res.json()) as Record<string, unknown>;
  const d = (raw.data ?? raw) as Record<string, unknown>;
  const addr = ((d.pradr as Record<string, unknown>)?.addr ?? {}) as Record<string, string>;
  return {
    gstin,
    legalName: String(d.lgnm ?? d.legalName ?? ''),
    tradeName: String(d.tradeNam ?? d.tradeName ?? ''),
    entityType: String(d.ctb ?? d.constitution ?? ''),
    registeredOn: String(d.rgdt ?? d.registrationDate ?? ''),
    status: String(d.sts ?? d.status ?? ''),
    taxpayerType: String(d.dty ?? d.taxpayerType ?? ''),
    address: [addr.bno, addr.bnm, addr.st, addr.loc].filter(Boolean).join(', '),
    city: String(addr.dst ?? addr.city ?? ''),
    natureOfBusiness: Array.isArray(d.nba) ? (d.nba as string[]).join(', ') : '',
  };
}
