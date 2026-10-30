import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

export interface Sql {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** Runs a multi-statement script (no parameters). */
  exec(script: string): Promise<void>;
}

export interface Db extends Sql {
  kind: 'postgres' | 'pglite';
  tx<T>(fn: (q: Sql) => Promise<T>): Promise<T>;
  /** Cross-instance notifications (Postgres LISTEN/NOTIFY). No-op on PGlite. */
  listen(channel: string, cb: (payload: string) => void): Promise<void>;
  notify(channel: string, payload: string): Promise<void>;
  close(): Promise<void>;
}

/** Amazon's RDS root certificates (public), used to verify RDS/Aurora servers. */
const RDS_CA_FILE = path.resolve('server/certs/rds-global-bundle.pem');

/**
 * Connection options for `url`. AWS RDS/Aurora certificates are signed by Amazon's own CA,
 * which Node doesn't trust out of the box, so those hosts (or any host, when
 * DATABASE_CA_FILE is set) are verified against that CA with full hostname checks.
 * Other URLs are passed through unchanged, so `?sslmode=…` keeps its usual meaning.
 */
export function postgresOptions(url: string, env: NodeJS.ProcessEnv = process.env): pg.PoolConfig {
  const max = Number(env.PG_POOL_MAX ?? 10);
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { connectionString: url, max };
  }
  const caFile = env.DATABASE_CA_FILE || (/\.rds\.amazonaws\.com$/i.test(u.hostname) ? RDS_CA_FILE : undefined);
  if (!caFile || u.searchParams.has('sslrootcert') || u.searchParams.get('sslmode') === 'disable') return { connectionString: url, max };
  // Settings parsed from the URL override `ssl`, so drop the URL's SSL switches and set it here.
  for (const k of ['sslmode', 'ssl', 'uselibpqcompat']) u.searchParams.delete(k);
  return { connectionString: u.toString(), max, ssl: { ca: fs.readFileSync(caFile, 'utf8'), rejectUnauthorized: true } };
}

export async function connectPostgres(url: string): Promise<Db> {
  const pool = new pg.Pool(postgresOptions(url));
  // An idle connection dropped by the server (failover, restart, timeout) must not crash the
  // process; the pool replaces it on the next query.
  pool.on('error', (err) => console.error('PostgreSQL connection error (will reconnect):', err.message));
  let listener: pg.PoolClient | undefined;
  return {
    kind: 'postgres',
    query: (text, params) => pool.query(text, params as unknown[]) as never,
    exec: async (script) => void (await pool.query(script)),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn({ query: (t, p) => client.query(t, p as unknown[]) as never, exec: async (script) => void (await client.query(script)) });
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    async listen(channel, cb) {
      if (!listener) {
        listener = await pool.connect();
        // A checked-out client's errors don't reach pool.on('error'); without this a dropped
        // LISTEN connection would crash the process.
        listener.on('error', (err) => console.error('PostgreSQL LISTEN connection error:', err.message));
      }
      listener.on('notification', (m) => m.channel === channel && cb(m.payload ?? ''));
      await listener.query(`LISTEN ${channel}`);
    },
    async notify(channel, payload) {
      await pool.query('SELECT pg_notify($1, $2)', [channel, payload]);
    },
    async close() {
      listener?.release();
      await pool.end();
    },
  };
}

/** Embedded Postgres (WASM) for local development and tests — no install needed. */
export async function connectPglite(dir?: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = dir ? new PGlite(dir) : new PGlite();
  await db.waitReady;
  return {
    kind: 'pglite',
    query: (text, params) => db.query(text, params) as never,
    exec: async (script) => void (await db.exec(script)),
    tx: (fn) => db.transaction((t) => fn({ query: (text, params) => t.query(text, params) as never, exec: async (script) => void (await t.exec(script)) })),
    listen: async () => {},
    notify: async () => {},
    close: () => db.close(),
  };
}
