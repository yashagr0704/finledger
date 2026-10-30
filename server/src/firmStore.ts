import { DB_VERSION } from '@/data/seed';
import type { Client, Database, Firm, User, WhatsAppNumber } from '@/types';
import type { Cipher } from './crypto';
import type { Db, Sql } from './db';
import type { Events } from './events';

/** Database collections stored as rows in `records` (users live in their own table). */
export const COLLECTIONS = [
  'clients', 'categories', 'tasks', 'comments', 'activities', 'notifications', 'documents', 'reviews', 'templates', 'services', 'referrers',
  'notes', 'reminders', 'portals', 'notices', 'invoices', 'payments', 'dscs', 'docMovements', 'chats', 'broadcasts', 'drive',
  'waNumbers', 'waThreads',
] as const;
type Collection = (typeof COLLECTIONS)[number];

/** Collections where the app adds new items at the front (newest first). */
const PREPEND = new Set<Collection>(['activities', 'notifications', 'notes', 'notices', 'docMovements', 'broadcasts']);

/** Old activity and read notifications are archived from the working set after this many days. */
const HISTORY_DAYS = 365;

interface Loaded {
  version: number;
  db: Database;
  /** Serialized rows as last persisted, for change detection. */
  snapshot: Map<string, Map<string, string>>;
}

export class FirmNotFound extends Error {}

/**
 * Loads, caches and saves a firm's data. All writes go through `mutate`, which
 * locks the firm row, re-runs the change on the latest data and stores only
 * the rows that changed.
 */
export class FirmStore {
  private cache = new Map<string, Loaded>();

  constructor(
    private db: Db,
    private cipher: Cipher,
    private events: Events,
  ) {}

  async get(firmId: string): Promise<{ db: Database; version: number }> {
    const { rows } = await this.db.query<{ version: string }>('SELECT version FROM firms WHERE id = $1', [firmId]);
    if (!rows[0]) throw new FirmNotFound();
    const version = Number(rows[0].version);
    let c = this.cache.get(firmId);
    if (!c || c.version !== version) {
      c = await this.load(this.db, firmId);
      this.cache.set(firmId, c);
    }
    return { db: c.db, version: c.version };
  }

  /**
   * Applies `fn` to the latest firm data inside a transaction. `fn` returns
   * the next database (it must not mutate its input). Nothing is written and
   * the version doesn't change when `fn` produces no differences.
   */
  async mutate<R>(firmId: string, fn: (db: Database, q: Sql) => { db: Database; result: R } | Promise<{ db: Database; result: R }>): Promise<{ result: R; version: number; changed: boolean }> {
    let fresh: Loaded | undefined;
    const out = await this.db.tx(async (q) => {
      const { rows } = await q.query<{ version: string }>('SELECT version FROM firms WHERE id = $1 FOR UPDATE', [firmId]);
      if (!rows[0]) throw new FirmNotFound();
      const version = Number(rows[0].version);
      let current = this.cache.get(firmId);
      if (!current || current.version !== version) current = await this.load(q, firmId);
      const { db: next, result } = await fn(current.db, q);
      const snapshot = await this.persist(q, firmId, current, next);
      if (!snapshot) {
        fresh = current;
        return { result, version, changed: false };
      }
      const nextVersion = version + 1;
      await q.query('UPDATE firms SET version = $2, data = $3 WHERE id = $1', [firmId, nextVersion, JSON.stringify(next.firm)]);
      fresh = { version: nextVersion, db: next, snapshot };
      return { result, version: nextVersion, changed: true };
    });
    // Only publish to the cache and listeners after the commit succeeded.
    if (fresh) this.cache.set(firmId, fresh);
    if (out.changed) await this.events.publish(firmId, out.version);
    return out;
  }

  /** Inserts a brand-new firm with all its data. */
  async create(db: Database, firmId: string, credentials: Record<string, string | undefined> = {}) {
    await this.db.tx(async (q) => {
      await q.query('INSERT INTO firms (id, data, version) VALUES ($1, $2, 1)', [firmId, JSON.stringify(db.firm)]);
      const empty: Loaded = { version: 0, db: { ...db, users: [], ...Object.fromEntries(COLLECTIONS.map((c) => [c, []])) } as Database, snapshot: new Map() };
      await this.persist(q, firmId, empty, db);
      for (const [userId, hash] of Object.entries(credentials)) if (hash) await q.query('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, hash]);
    });
    this.cache.delete(firmId);
  }

  invalidate(firmId: string) {
    this.cache.delete(firmId);
  }

  // ------------------------------------------------------------------ load

  private async load(q: Sql, firmId: string): Promise<Loaded> {
    const firm = await q.query<{ data: Firm; version: string; created_at: string }>('SELECT data, version, created_at FROM firms WHERE id = $1', [firmId]);
    if (!firm.rows[0]) throw new FirmNotFound();
    const users = await q.query<{ data: User }>('SELECT data FROM users WHERE firm_id = $1 ORDER BY seq', [firmId]);
    const recs = await q.query<{ collection: Collection; data: Record<string, unknown> }>(
      `SELECT collection, data FROM records
        WHERE firm_id = $1
          AND (collection NOT IN ('activities', 'notifications')
               OR ts IS NULL OR ts > now() - make_interval(days => $2)
               OR (collection = 'notifications' AND (data->>'read') = 'false'))
        ORDER BY seq`,
      [firmId, HISTORY_DAYS],
    );
    const db = {
      version: DB_VERSION,
      seededAt: new Date(firm.rows[0].created_at).toISOString(),
      firm: firm.rows[0].data,
      users: users.rows.map((r) => r.data),
      ...Object.fromEntries(COLLECTIONS.map((c) => [c, [] as unknown[]])),
    } as unknown as Database;
    for (const r of recs.rows) (db[r.collection] as unknown[]).push(r.data);
    for (const c of PREPEND) (db[c] as unknown[]).reverse();
    db.clients = db.clients.map((c) => this.decryptClient(c));
    db.waNumbers = db.waNumbers.map((n) => ({ ...n, token: safeDecrypt(this.cipher, n.token), appSecret: safeDecrypt(this.cipher, n.appSecret) }));
    return { version: Number(firm.rows[0].version), db, snapshot: this.snapshotOf(db) };
  }

  private snapshotOf(db: Database) {
    const snap = new Map<string, Map<string, string>>();
    snap.set('users', new Map(db.users.map((u) => [u.id, JSON.stringify(u)])));
    for (const c of COLLECTIONS) snap.set(c, new Map((db[c] as { id: string }[]).map((r) => [r.id, JSON.stringify(r)])));
    return snap;
  }

  // --------------------------------------------------------------- persist

  /** Writes changed rows. Returns the new snapshot, or null if nothing changed. */
  private async persist(q: Sql, firmId: string, prev: Loaded, next: Database): Promise<Map<string, Map<string, string>> | null> {
    const snapshot = this.snapshotOf(next);
    let changed = JSON.stringify(prev.db.firm) !== JSON.stringify(next.firm);

    // Users
    {
      const before = prev.snapshot.get('users') ?? new Map();
      const after = snapshot.get('users')!;
      const upserts = next.users.filter((u) => before.get(u.id) !== after.get(u.id));
      const deletes = [...before.keys()].filter((id) => !after.has(id));
      if (upserts.length || deletes.length) changed = true;
      for (const u of upserts) {
        await q.query(
          `INSERT INTO users (id, firm_id, email, data) VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, data = EXCLUDED.data, updated_at = now()
           WHERE users.firm_id = EXCLUDED.firm_id`,
          [u.id, firmId, u.email.toLowerCase(), JSON.stringify(u)],
        );
      }
      if (deletes.length) await q.query('DELETE FROM users WHERE firm_id = $1 AND id = ANY($2)', [firmId, deletes]);
    }

    for (const c of COLLECTIONS) {
      const before = prev.snapshot.get(c) ?? new Map<string, string>();
      const after = snapshot.get(c)!;
      const rows = next[c] as { id: string }[];
      let upserts = rows.filter((r) => before.get(r.id) !== after.get(r.id));
      const deletes = [...before.keys()].filter((id) => !after.has(id));
      if (!upserts.length && !deletes.length) continue;
      changed = true;
      // New rows get increasing `seq`; for newest-first collections insert them oldest-first.
      if (PREPEND.has(c)) upserts = [...upserts].reverse();
      if (upserts.length) {
        const payload = upserts.map((r) =>
          c === 'clients'
            ? this.encryptClient(r as unknown as Client)
            : c === 'waNumbers'
              ? { ...r, token: this.cipher.encrypt((r as unknown as WhatsAppNumber).token), appSecret: this.cipher.encrypt((r as unknown as WhatsAppNumber).appSecret) }
              : r,
        );
        await q.query(
          `INSERT INTO records (firm_id, collection, id, data, ts)
           SELECT $1, $2, e->>'id', e, NULLIF(e->>'createdAt', '')::timestamptz
             FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY AS t(e, n)
            ORDER BY n
           ON CONFLICT (firm_id, collection, id) DO UPDATE SET data = EXCLUDED.data, ts = EXCLUDED.ts, updated_at = now()`,
          [firmId, c, JSON.stringify(payload)],
        );
      }
      if (deletes.length) await q.query('DELETE FROM records WHERE firm_id = $1 AND collection = $2 AND id = ANY($3)', [firmId, c, deletes]);
    }
    return changed ? snapshot : null;
  }

  private encryptClient(c: Client): Client {
    if (!c.portalLogins?.length) return c;
    return { ...c, portalLogins: c.portalLogins.map((l) => ({ id: l.id, portalId: l.portalId, username: l.username, password: this.cipher.encrypt(l.password), extra: l.extra })) };
  }

  private decryptClient(c: Client): Client {
    if (!c.portalLogins?.length) return c;
    return { ...c, portalLogins: c.portalLogins.map((l) => ({ ...l, password: safeDecrypt(this.cipher, l.password) })) };
  }
}

function safeDecrypt(cipher: Cipher, v: string) {
  try {
    return cipher.decrypt(v);
  } catch {
    return '';
  }
}
