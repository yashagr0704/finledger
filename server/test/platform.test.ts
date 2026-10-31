import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { upsertPlatformAdmin } from '../src/platform';
import { setup, taskInput, type Harness } from './helpers';

let h: Harness;
beforeAll(async () => {
  h = await setup();
  await upsertPlatformAdmin(h.db, { email: 'ops@platform.test', name: 'Ops', password: 'ops-pass-123' });
  expect((await h.call('sa', 'POST', '/api/platform/login', { email: 'ops@platform.test', password: 'ops-pass-123' })).status).toBe(200);
  expect((await h.login('rohan', 'rohan@mehtaiyer.demo')).status).toBe(200);
});
afterAll(() => h.close());

type Firm = { id: string; name: string; suspendedAt: string | null; members: number; admins: { id: string; email: string; status: string }[] };
const firms = async (): Promise<Firm[]> => (await h.call('sa', 'GET', '/api/platform/firms')).json.firms;
const firm = async (name: string) => (await firms()).find((f) => f.name === name)!;
const adminId = async (email: string) => (await firms()).flatMap((f) => f.admins).find((a) => a.email === email)!.id;

describe('separation from firms', () => {
  it('superadmin and firm sessions do not open each other’s doors', async () => {
    expect((await h.call('rohan', 'GET', '/api/platform/firms')).status).toBe(401);
    expect((await h.call('sa', 'GET', '/api/bootstrap')).status).toBe(401);
    // A firm user's password is not a superadmin login, and vice versa.
    expect((await h.call('x', 'POST', '/api/platform/login', { email: 'rohan@mehtaiyer.demo', password: 'demo1234' })).status).toBe(401);
    expect((await h.login('x', 'ops@platform.test', 'ops-pass-123')).status).toBe(401);
  });

  it('lists firms with their admins only — no employees and nothing from inside the firm', async () => {
    const demo = await firm('Mehta Iyer & Associates');
    expect(demo.admins.map((a) => a.email)).toEqual(['rohan@mehtaiyer.demo']);
    expect(demo.members).toBeGreaterThan(1);
    const json = JSON.stringify(await firms());
    for (const leak of ['priya@mehtaiyer.demo', 'clients', 'tasks', 'portalLogins', '$2']) expect(json).not.toContain(leak);
  });

  it('cannot manage a firm’s employees, only its admins', async () => {
    const { rows } = await h.db.query<{ id: string }>("SELECT id FROM users WHERE email = 'priya@mehtaiyer.demo'");
    const priya = rows[0].id;
    expect((await h.call('sa', 'PATCH', `/api/platform/admins/${priya}`, { status: 'deactivated' })).status).toBe(404);
    expect((await h.call('sa', 'POST', `/api/platform/admins/${priya}/password`, { password: 'new-pass-123' })).status).toBe(404);
    expect((await h.call('sa', 'DELETE', `/api/platform/admins/${priya}`)).status).toBe(404);
  });
});

describe('firms', () => {
  it('creates a firm with its first admin, who can sign in', async () => {
    const r = await h.call('sa', 'POST', '/api/platform/firms', { firmName: 'Shah & Co', adminName: 'Asha Shah', email: 'asha@shah.test', password: 'asha-pass-1' });
    expect(r.status).toBe(200);
    expect((await h.login('asha', 'asha@shah.test', 'asha-pass-1')).status).toBe(200);
    expect((await h.boot('asha')).db.firm.name).toBe('Shah & Co');
    expect((await h.call('sa', 'POST', '/api/platform/firms', { firmName: 'Dup', adminName: 'D', email: 'asha@shah.test', password: 'whatever-1' })).status).toBe(400);
    // A firm admin can't create firms.
    expect((await h.call('asha', 'POST', '/api/platform/firms', { firmName: 'Mine', adminName: 'M', email: 'm@shah.test', password: 'whatever-1' })).status).toBe(401);
  });

  it('suspends a firm (signing everyone out) and reactivates it', async () => {
    const shah = await firm('Shah & Co');
    expect((await h.call('sa', 'PATCH', `/api/platform/firms/${shah.id}`, { suspended: true })).status).toBe(200);
    expect((await h.call('asha', 'GET', '/api/bootstrap')).status).toBe(401);
    const blocked = await h.login('asha', 'asha@shah.test', 'asha-pass-1');
    expect(blocked.status).toBe(403);
    expect(blocked.json.message).toMatch(/suspended/);
    expect((await firm('Shah & Co')).suspendedAt).not.toBeNull();
    expect((await h.call('sa', 'PATCH', `/api/platform/firms/${shah.id}`, { suspended: false })).status).toBe(200);
    expect((await h.login('asha', 'asha@shah.test', 'asha-pass-1')).status).toBe(200);
  });

  it('deletes a firm only when its name is repeated', async () => {
    const shah = await firm('Shah & Co');
    expect((await h.call('sa', 'DELETE', `/api/platform/firms/${shah.id}`, { confirmName: 'Shah' })).status).toBe(400);
    expect((await h.call('sa', 'DELETE', `/api/platform/firms/${shah.id}`, { confirmName: 'Shah & Co' })).status).toBe(200);
    expect((await firms()).some((f) => f.id === shah.id)).toBe(false);
    expect((await h.login('y', 'asha@shah.test', 'asha-pass-1')).status).toBe(401);
    const { rows } = await h.db.query('SELECT 1 FROM records WHERE firm_id = $1', [shah.id]);
    expect(rows).toHaveLength(0);
  });
});

describe('firm admins', () => {
  it('adds an admin to an existing firm', async () => {
    const demo = await firm('Mehta Iyer & Associates');
    expect((await h.call('sa', 'POST', `/api/platform/firms/${demo.id}/admins`, { name: 'Dev Admin', email: 'dev@mehtaiyer.demo', password: 'dev-pass-12' })).status).toBe(200);
    expect((await h.login('dev', 'dev@mehtaiyer.demo', 'dev-pass-12')).status).toBe(200);
    expect((await h.boot('dev')).db.users.find((u: { email: string }) => u.email === 'dev@mehtaiyer.demo').role).toBe('admin');
  });

  it('deactivates a firm admin (signing them out) and reactivates them', async () => {
    const id = await adminId('dev@mehtaiyer.demo');
    expect((await h.call('sa', 'PATCH', `/api/platform/admins/${id}`, { status: 'deactivated' })).status).toBe(200);
    expect((await h.call('dev', 'GET', '/api/bootstrap')).status).toBe(401);
    expect((await h.login('dev', 'dev@mehtaiyer.demo', 'dev-pass-12')).status).toBe(403);
    expect((await h.call('sa', 'PATCH', `/api/platform/admins/${id}`, { status: 'active' })).status).toBe(200);
    expect((await h.login('dev', 'dev@mehtaiyer.demo', 'dev-pass-12')).status).toBe(200);
  });

  it('resets a firm admin’s password and signs them out', async () => {
    const id = await adminId('dev@mehtaiyer.demo');
    expect((await h.call('sa', 'POST', `/api/platform/admins/${id}/password`, { password: 'short' })).status).toBe(400);
    expect((await h.call('sa', 'POST', `/api/platform/admins/${id}/password`, { password: 'fresh-pass-1' })).status).toBe(200);
    expect((await h.call('dev', 'GET', '/api/bootstrap')).status).toBe(401);
    expect((await h.login('dev', 'dev@mehtaiyer.demo', 'fresh-pass-1')).status).toBe(200);
  });

  it('deletes a firm admin, but not while tasks are assigned to them', async () => {
    const id = await adminId('dev@mehtaiyer.demo');
    expect((await h.cmd('dev', 'createTask', [taskInput({ assigneeId: id, title: 'Dev’s task' })])).status).toBe(200);
    const refused = await h.call('sa', 'DELETE', `/api/platform/admins/${id}`);
    expect(refused.status).toBe(400);
    expect(refused.json.message).toMatch(/tasks/);
    const demo = await firm('Mehta Iyer & Associates');
    await h.call('sa', 'POST', `/api/platform/firms/${demo.id}/admins`, { name: 'Temp', email: 'temp@mehtaiyer.demo', password: 'temp-pass-1' });
    const temp = await adminId('temp@mehtaiyer.demo');
    expect((await h.call('sa', 'DELETE', `/api/platform/admins/${temp}`)).status).toBe(200);
    expect((await firms()).flatMap((f) => f.admins).some((a) => a.id === temp)).toBe(false);
  });

  it('audits superadmin actions', async () => {
    const { rows } = await h.db.query<{ action: string }>("SELECT DISTINCT action FROM audit_log WHERE action LIKE 'platform_%'");
    expect(rows.map((r) => r.action)).toEqual(
      expect.arrayContaining(['platform_login', 'platform_firm_created', 'platform_firm_suspended', 'platform_firm_reactivated', 'platform_firm_deleted', 'platform_admin_added', 'platform_admin_deactivated', 'platform_admin_password_reset', 'platform_admin_deleted']),
    );
  });
});
