import type { Db } from './db';

/** Ordered, append-only schema migrations. Never edit one that has shipped. */
const MIGRATIONS: { id: number; name: string; sql: string }[] = [
  {
    id: 1,
    name: 'initial schema',
    sql: `
      CREATE TABLE firms (
        id text PRIMARY KEY,
        data jsonb NOT NULL,
        version bigint NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE users (
        id text PRIMARY KEY,
        firm_id text NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
        email text NOT NULL,
        password_hash text,
        data jsonb NOT NULL,
        seq bigserial,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX users_email_key ON users (lower(email));
      CREATE INDEX users_firm_idx ON users (firm_id);

      -- One row per domain record (task, client, comment, …) of a firm.
      CREATE TABLE records (
        firm_id text NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
        collection text NOT NULL,
        id text NOT NULL,
        data jsonb NOT NULL,
        ts timestamptz,
        seq bigserial,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (firm_id, collection, id)
      );
      CREATE INDEX records_firm_collection_seq_idx ON records (firm_id, collection, seq);
      CREATE INDEX records_ts_idx ON records (firm_id, collection, ts);

      CREATE TABLE sessions (
        id text PRIMARY KEY,
        user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        firm_id text NOT NULL,
        expires_at timestamptz NOT NULL,
        user_agent text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX sessions_user_idx ON sessions (user_id);

      CREATE TABLE invites (
        id text PRIMARY KEY,
        user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        firm_id text NOT NULL,
        expires_at timestamptz NOT NULL,
        used_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE files (
        id text PRIMARY KEY,
        firm_id text NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
        name text NOT NULL,
        size_bytes bigint NOT NULL,
        mime text,
        storage_key text NOT NULL,
        uploaded_by text,
        task_id text,
        client_id text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX files_firm_idx ON files (firm_id);

      CREATE TABLE audit_log (
        id bigserial PRIMARY KEY,
        firm_id text,
        user_id text,
        action text NOT NULL,
        detail jsonb,
        ip text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX audit_firm_idx ON audit_log (firm_id, created_at);
    `,
  },
  {
    id: 2,
    name: 'whatsapp number routing',
    sql: `
      -- Which firm (and which of its numbers) owns each connected Meta phone number ID, so
      -- incoming webhooks reach the right firm. One number can be connected to one firm only.
      CREATE TABLE whatsapp_numbers (
        phone_number_id text PRIMARY KEY,
        firm_id text NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
        number_id text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX whatsapp_numbers_firm_idx ON whatsapp_numbers (firm_id);
    `,
  },
  {
    id: 3,
    name: 'platform superadmins',
    sql: `
      -- Platform operators: they manage firms and firm admins, never a firm's own data.
      -- Separate from firm users, with their own sessions. Created from the CLI (create-superadmin).
      CREATE TABLE platform_admins (
        id text PRIMARY KEY,
        email text NOT NULL,
        name text NOT NULL,
        password_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX platform_admins_email_key ON platform_admins (lower(email));

      CREATE TABLE platform_sessions (
        id text PRIMARY KEY,
        admin_id text NOT NULL REFERENCES platform_admins(id) ON DELETE CASCADE,
        expires_at timestamptz NOT NULL,
        user_agent text,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      -- A suspended firm's users can't sign in and its scheduled jobs don't run.
      ALTER TABLE firms ADD COLUMN suspended_at timestamptz;
    `,
  },
  {
    id: 4,
    name: 'password resets',
    sql: `
      -- One-time "forgot password" links (the id is the SHA-256 of the emailed token).
      CREATE TABLE password_resets (
        id text PRIMARY KEY,
        user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at timestamptz NOT NULL,
        used_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX password_resets_user_idx ON password_resets (user_id);
    `,
  },
];

export async function migrate(db: Db) {
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (id int PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
  const { rows } = await db.query<{ id: number }>('SELECT id FROM schema_migrations');
  const done = new Set(rows.map((r) => Number(r.id)));
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    await db.tx(async (q) => {
      await q.exec(m.sql);
      await q.query('INSERT INTO schema_migrations (id, name) VALUES ($1, $2)', [m.id, m.name]);
    });
  }
}
