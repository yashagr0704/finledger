import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { buildApp } from '../src/app';
import { loadConfig, type Config } from '../src/config';
import { connectPglite, connectPostgres } from '../src/db';
import { migrate } from '../src/migrations';
import { seedDemoFirm } from '../src/newFirm';

export const PASSWORD = 'demo1234';

/** A fresh in-memory database with the demo firm, plus a small HTTP client with per-user cookie jars. */
export async function setup(overrides: Partial<Config> = {}) {
  // TEST_DATABASE_URL runs the suite against a real PostgreSQL server (its public schema is wiped).
  const url = process.env.TEST_DATABASE_URL;
  const db = url ? await connectPostgres(url) : await connectPglite();
  if (url) await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(db);
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-files-'));
  const config = loadConfig({ appSecret: 'test-secret-test-secret-test-secret-123', storageDir, staticDir: undefined, jobsEnabled: false, allowSignup: true, cookieSecure: false, ...overrides });
  const { fastify, app } = await buildApp(config, db);
  await seedDemoFirm(app.firms, PASSWORD);

  const jars = new Map<string, string>();
  async function call(who: string | null, method: string, url: string, body?: unknown, opts: { csrf?: boolean } = {}) {
    const res = await fastify.inject({
      method: method as 'GET',
      url,
      headers: {
        ...(who && jars.get(who) ? { cookie: jars.get(who)! } : {}),
        ...(opts.csrf === false ? {} : { 'x-ledgerflow': '1' }),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      payload: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers['set-cookie'];
    if (who && set) jars.set(who, (Array.isArray(set) ? set : [set]).map((c) => c.split(';')[0]).join('; '));
    let json: any = undefined;
    try {
      json = res.json();
    } catch {
      /* not JSON */
    }
    return { status: res.statusCode, json, body: res.body };
  }
  const login = (who: string, email: string, password = PASSWORD) => call(who, 'POST', '/api/auth/login', { email, password });
  const cmd = (who: string, name: string, args: unknown[], ids: unknown[] = []) => call(who, 'POST', `/api/commands/${name}`, { args, ids });
  const boot = async (who: string) => (await call(who, 'GET', '/api/bootstrap')).json;

  return { db, app, fastify, call, login, cmd, boot, jars, close: async () => (await fastify.close(), await db.close()) };
}
export type Harness = Awaited<ReturnType<typeof setup>>;

export const taskInput = (over: Record<string, unknown> = {}) => ({
  title: 'Test task',
  description: '',
  clientId: 'c_meera',
  categoryId: 'itr',
  assigneeId: 'u_priya',
  priority: 'medium',
  startDate: '2026-10-27',
  dueDate: '2026-11-05',
  estimateHours: 2,
  requiresReview: false,
  checklist: ['one'],
  ...over,
});
