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

export async function connectPostgres(url: string): Promise<Db> {
  const pool = new pg.Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX ?? 10) });
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
      listener ??= await pool.connect();
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
