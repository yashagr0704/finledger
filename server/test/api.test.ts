import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runJobsOnce } from '../src/jobs';
import { setup, taskInput, type Harness } from './helpers';

let h: Harness;
beforeAll(async () => {
  h = await setup();
  expect((await h.login('admin', 'rohan@mehtaiyer.demo')).status).toBe(200);
  expect((await h.login('priya', 'priya@mehtaiyer.demo')).status).toBe(200);
  expect((await h.login('vikram', 'vikram@mehtaiyer.demo')).status).toBe(200);
});
afterAll(() => h.close());

describe('authentication', () => {
  it('rejects wrong passwords and unknown emails with the same message', async () => {
    const a = await h.login('x', 'priya@mehtaiyer.demo', 'wrong-pass');
    const b = await h.login('x', 'nobody@nowhere.test', 'wrong-pass');
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.json.message).toBe(b.json.message);
  });

  it('requires a session for data', async () => {
    expect((await h.call(null, 'GET', '/api/bootstrap')).status).toBe(401);
  });

  it('blocks state-changing requests without the CSRF header', async () => {
    const r = await h.call('admin', 'POST', '/api/commands/markAllNotificationsRead', { args: [] }, { csrf: false });
    expect(r.status).toBe(403);
  });

  it('does not let invited (not yet accepted) users sign in', async () => {
    expect((await h.login('isha', 'isha@mehtaiyer.demo', 'anything1')).status).toBe(401);
  });
});

describe('data scoping', () => {
  it('sends an employee only their slice of the firm', async () => {
    const admin = await h.boot('admin');
    const priya = await h.boot('priya');
    expect(priya.db.tasks.length).toBeLessThan(admin.db.tasks.length);
    expect(priya.db.invoices).toEqual([]);
    expect(priya.db.payments).toEqual([]);
    expect(priya.db.tasks.every((t: any) => t.fee === undefined)).toBe(true);
    expect(priya.db.notes.every((n: any) => n.userId === 'u_priya')).toBe(true);
    expect(priya.db.notifications.every((n: any) => n.userId === 'u_priya')).toBe(true);
    expect(priya.db.users.filter((u: any) => u.id !== 'u_priya').some((u: any) => u.aadhaar || u.pan)).toBe(false);
  });

  it('never sends portal passwords in bulk, only through the audited endpoint', async () => {
    const admin = await h.boot('admin');
    const logins = admin.db.clients.flatMap((c: any) => c.portalLogins ?? []);
    expect(logins.length).toBeGreaterThan(0);
    expect(logins.every((l: any) => l.password === '' && l.hasPassword)).toBe(true);
    const r = await h.call('admin', 'GET', '/api/clients/c_sunrise/logins/0');
    expect(r.json.password).toBe('Demo@2026');
    const { rows } = await h.db.query<{ n: string }>("SELECT count(*) AS n FROM audit_log WHERE action = 'portal_password_viewed'");
    expect(Number(rows[0].n)).toBe(1);
  });

  it('stores portal passwords encrypted at rest', async () => {
    const { rows } = await h.db.query<{ data: any }>("SELECT data FROM records WHERE collection = 'clients' AND id = 'c_sunrise'");
    expect(rows[0].data.portalLogins[0].password).toMatch(/^enc:v1:/);
  });
});

describe('commands', () => {
  it('lets an employee create a task for themselves but not for others', async () => {
    expect((await h.cmd('priya', 'createTask', [taskInput({ assigneeId: 'u_arjun' })])).status).toBe(403);
    const ok = await h.cmd('priya', 'createTask', [taskInput({ title: 'My own to-do' })]);
    expect(ok.status).toBe(200);
    const b = await h.boot('priya');
    expect(b.db.tasks.some((t: any) => t.title === 'My own to-do')).toBe(true);
  });

  it('validates argument shapes before running', async () => {
    const r = await h.cmd('admin', 'createTask', [{ title: 42 }]);
    expect(r.status).toBe(400);
    expect(r.json.code).toBe('invalid_args');
  });

  it('rejects unknown commands', async () => {
    expect((await h.cmd('admin', 'constructor', [])).status).toBe(404);
  });

  it('enforces the review workflow on the server', async () => {
    // LF-1132 is in review with Vikram as reviewer; Priya (the assignee) cannot approve it.
    expect((await h.cmd('priya', 'transitionTask', ['LF-1132', 'completed'])).status).toBe(403);
    expect((await h.cmd('vikram', 'transitionTask', ['LF-1132', 'changes_requested'])).status).toBe(400); // explanation required
    expect((await h.cmd('vikram', 'transitionTask', ['LF-1132', 'changes_requested', 'Please attach the revised computation.'])).status).toBe(200);
    const t = (await h.boot('priya')).db.tasks.find((x: any) => x.id === 'LF-1132');
    expect(t.status).toBe('changes_requested');
  });

  it('cannot overwrite protected fields through patches', async () => {
    await h.cmd('admin', 'updateClient', ['c_meera', { id: 'hijacked', city: 'Madurai' }]);
    const c = (await h.boot('admin')).db.clients.find((x: any) => x.id === 'c_meera');
    expect(c).toBeTruthy();
    expect(c.city).toBe('Madurai');
  });

  it('clears a field when the browser sends null', async () => {
    expect((await h.cmd('admin', 'updateClient', ['c_meera', { notes: 'temp' }])).status).toBe(200);
    expect((await h.cmd('admin', 'updateClient', ['c_meera', { notes: null }])).status).toBe(200);
    expect((await h.boot('admin')).db.clients.find((x: any) => x.id === 'c_meera').notes).toBeUndefined();
  });

  it('keeps saved portal passwords when a client is edited without them', async () => {
    const admin = await h.boot('admin');
    const c = admin.db.clients.find((x: any) => x.id === 'c_sunrise');
    expect((await h.cmd('admin', 'updateClient', ['c_sunrise', { portalLogins: c.portalLogins }])).status).toBe(200);
    expect((await h.call('admin', 'GET', '/api/clients/c_sunrise/logins/0')).json.password).toBe('Demo@2026');
  });

  it('reuses well-formed proposed ids and reports when it had to change them', async () => {
    const seq = (await h.boot('admin')).db.taskSeq;
    const mine = `LF-${seq + 1}`;
    const a = await h.cmd('admin', 'createTask', [taskInput({ assigneeId: 'u_rohan', title: 'Id test' })], [{ p: 'task', id: mine }]);
    expect(a.json.idsChanged).toBe(false);
    const b = await h.cmd('admin', 'createTask', [taskInput({ assigneeId: 'u_rohan', title: 'Id clash' })], [{ p: 'task', id: mine }]);
    expect(b.json.idsChanged).toBe(true);
  });

  it('keeps billing to permitted users', async () => {
    const pay = { clientId: 'c_meera', date: '2026-10-27', amount: 100, mode: 'UPI', kind: 'receipt', reference: 'x' };
    expect((await h.cmd('priya', 'recordPayment', [pay])).status).toBe(403);
    expect((await h.cmd('admin', 'recordPayment', [pay])).status).toBe(200);
  });

  it('applies permission switches immediately', async () => {
    expect((await h.cmd('admin', 'updateMember', ['u_priya', { permissions: { billing: true } }])).status).toBe(200);
    expect((await h.boot('priya')).db.invoices.length).toBeGreaterThan(0);
    await h.cmd('admin', 'updateMember', ['u_priya', { permissions: { billing: false } }]);
    expect((await h.boot('priya')).db.invoices).toEqual([]);
  });

  it('records an audit trail of commands', async () => {
    const { rows } = await h.db.query<{ n: string }>("SELECT count(*) AS n FROM audit_log WHERE action LIKE 'command:%'");
    expect(Number(rows[0].n)).toBeGreaterThan(5);
  });
});

describe('team lifecycle', () => {
  it('invites, accepts, and signs in a new member', async () => {
    const r = await h.cmd('admin', 'inviteMember', [{ name: 'New Joiner', email: 'joiner@example.com', role: 'employee', title: 'Associate', managerId: 'u_vikram' }]);
    expect(r.status).toBe(200);
    const token = new URL(r.json.meta.inviteUrl).searchParams.get('token')!;
    expect((await h.call(null, 'GET', `/api/auth/invite/${token}`)).json.email).toBe('joiner@example.com');
    expect((await h.call('joiner', 'POST', '/api/auth/accept-invite', { token, password: 'short' })).status).toBe(400);
    expect((await h.call('joiner', 'POST', '/api/auth/accept-invite', { token, password: 'joinerpass1' })).status).toBe(200);
    const b = await h.boot('joiner');
    expect(b.db.users.find((u: any) => u.email === 'joiner@example.com').status).toBe('active');
    expect((await h.call(null, 'POST', '/api/auth/accept-invite', { token, password: 'joinerpass1' })).status).toBe(404);
  });

  it('signs a deactivated member out everywhere', async () => {
    const id = (await h.boot('joiner')).meId;
    expect((await h.cmd('admin', 'updateMember', [id, { status: 'deactivated' }])).status).toBe(200);
    expect((await h.call('joiner', 'GET', '/api/bootstrap')).status).toBe(401);
    expect((await h.login('joiner2', 'joiner@example.com', 'joinerpass1')).status).toBe(403);
  });

  it('lets a user change their password', async () => {
    expect((await h.call('vikram', 'POST', '/api/auth/password', { current: 'wrong', next: 'newpassword1' })).status).toBe(400);
    expect((await h.call('vikram', 'POST', '/api/auth/password', { current: 'demo1234', next: 'newpassword1' })).status).toBe(200);
    expect((await h.login('v2', 'vikram@mehtaiyer.demo', 'newpassword1')).status).toBe(200);
  });
});

describe('portals and portal logins', () => {
  const loginsOf = async (who: string, clientId: string) => (await h.boot(who)).db.clients.find((c: any) => c.id === clientId).portalLogins as any[];
  const launch = (who: string, clientId: string, ref: string, body: unknown = { portalId: 'pt_gst' }, opts?: { csrf?: boolean }) =>
    h.call(who, 'POST', `/api/clients/${clientId}/logins/${ref}/launch`, body, opts);

  it('lets users who manage masters add portals, and rejects duplicates and bad addresses', async () => {
    const sez = { name: 'SEZ Online', short: 'SEZ', url: 'https://www.sezonline.gov.in/', loginUrl: 'https://www.sezonline.gov.in/login', description: 'SEZ returns' };
    expect((await h.cmd('admin', 'savePortal', [sez])).status).toBe(200);
    const portal = (await h.boot('admin')).db.portals.find((p: any) => p.name === 'SEZ Online');
    expect(portal).toMatchObject({ url: sez.url, loginUrl: sez.loginUrl, clicks: 0 });
    // Everyone sees it, so it is available in every client's login dropdown.
    expect((await h.boot('priya')).db.portals.some((p: any) => p.id === portal.id)).toBe(true);

    expect((await h.cmd('admin', 'savePortal', [{ ...sez, name: 'sez online', url: 'https://other.example/' }])).status).toBe(400);
    expect((await h.cmd('admin', 'savePortal', [{ ...sez, name: 'SEZ again', url: 'https://sezonline.gov.in', loginUrl: undefined }])).status).toBe(400);
    expect((await h.cmd('admin', 'savePortal', [{ ...sez, name: 'Script', url: 'javascript:alert(1)', loginUrl: undefined }])).status).toBe(400);
    expect((await h.cmd('admin', 'savePortal', [{ ...sez, name: 'Bad login', url: 'https://bad-login.example/', loginUrl: 'not a url' }])).status).toBe(400);
    expect((await h.cmd('priya', 'savePortal', [{ ...sez, name: 'Employee portal', url: 'https://employee.example/', loginUrl: undefined }])).status).toBe(403);
  });

  it('keeps each client’s credentials separate and preserves saved passwords across edits', async () => {
    expect((await h.cmd('admin', 'updateClient', ['c_meera', { portalLogins: [{ portalId: 'pt_gst', username: 'meera_gst', password: 'MeeraGst#1', extra: 'OTP to 98xxxx1234' }] }])).status).toBe(200);
    const [meera] = await loginsOf('admin', 'c_meera');
    expect(meera).toMatchObject({ portalId: 'pt_gst', username: 'meera_gst', password: '', hasPassword: true, extra: 'OTP to 98xxxx1234' });
    expect(meera.id).toMatch(/^pl_/);

    // Same portal, different client: separate credential.
    const sunriseGst = (await loginsOf('admin', 'c_sunrise')).findIndex((l: any) => l.portalId === 'pt_gst');
    expect((await h.call('admin', 'GET', `/api/clients/c_sunrise/logins/${sunriseGst}`)).json.password).toBe('Demo@2026');
    expect((await h.call('admin', 'GET', `/api/clients/c_meera/logins/${meera.id}`)).json.password).toBe('MeeraGst#1');

    // Renaming the login ID with a blank password keeps the saved password.
    expect((await h.cmd('admin', 'updateClient', ['c_meera', { portalLogins: [{ ...meera, username: 'meera_gst_new', password: '' }] }])).status).toBe(200);
    const [renamed] = await loginsOf('admin', 'c_meera');
    expect(renamed).toMatchObject({ id: meera.id, username: 'meera_gst_new', hasPassword: true });
    expect((await h.call('admin', 'GET', `/api/clients/c_meera/logins/${meera.id}`)).json.password).toBe('MeeraGst#1');

    // A saved password never moves to a different portal.
    expect((await h.cmd('admin', 'updateClient', ['c_meera', { portalLogins: [{ ...renamed, portalId: 'pt_it', password: '' }] }])).status).toBe(200);
    expect((await loginsOf('admin', 'c_meera'))[0]).toMatchObject({ portalId: 'pt_it', hasPassword: false });

    // Unknown portals and duplicate rows are refused.
    expect((await h.cmd('admin', 'updateClient', ['c_meera', { portalLogins: [{ portalId: 'pt_nope', username: 'x', password: 'y' }] }])).status).toBe(400);
    const dup = { portalId: 'pt_gst', username: 'twice', password: 'p' };
    expect((await h.cmd('admin', 'updateClient', ['c_meera', { portalLogins: [dup, { ...dup, username: 'TWICE ' }] }])).status).toBe(400);

    const { rows } = await h.db.query<{ data: any }>("SELECT data FROM records WHERE collection = 'clients' AND id = 'c_sunrise'");
    expect(rows[0].data.portalLogins.every((l: any) => l.password.startsWith('enc:v1:'))).toBe(true);
  });

  it('launch returns only the selected client’s login for the selected portal', async () => {
    expect((await h.cmd('admin', 'updateClient', ['c_meera', { status: 'active', portalLogins: [{ portalId: 'pt_gst', username: 'meera_gst', password: 'MeeraGst#2' }] }])).status).toBe(200);
    const [login] = await loginsOf('admin', 'c_meera');

    const ok = await launch('admin', 'c_meera', login.id);
    expect(ok.status).toBe(200);
    expect(ok.json).toEqual({ clientId: 'c_meera', portalId: 'pt_gst', username: 'meera_gst', password: 'MeeraGst#2' });
    const res = await h.fastify.inject({ method: 'POST', url: `/api/clients/c_meera/logins/${login.id}/launch`, headers: { cookie: h.jars.get('admin')!, 'x-ledgerflow': '1', 'content-type': 'application/json' }, payload: '{"portalId":"pt_gst"}' });
    expect(res.headers['cache-control']).toContain('no-store');
    const { rows } = await h.db.query<{ detail: any }>("SELECT detail FROM audit_log WHERE action = 'portal_login_launched'");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(rows.map((r) => r.detail))).not.toContain('MeeraGst');

    // Another client's id, a portal mismatch, or no portal at all: nothing is returned.
    expect((await launch('admin', 'c_sunrise', login.id)).status).toBe(404);
    expect((await launch('admin', 'c_meera', login.id, { portalId: 'pt_it' })).status).toBe(409);
    expect((await launch('admin', 'c_meera', login.id, {})).status).toBe(400);
    expect((await launch('admin', 'c_meera', 'pl_missing')).status).toBe(404);
    expect((await launch('admin', 'c_meera', login.id, { portalId: 'pt_gst' }, { csrf: false })).status).toBe(403);
    expect((await h.call(null, 'POST', `/api/clients/c_meera/logins/${login.id}/launch`, { portalId: 'pt_gst' })).status).toBe(401);
  });

  it('refuses launches the user is not authorised for or that cannot work', async () => {
    const admin = await h.boot('admin');
    const priya = await h.boot('priya');
    const hidden = admin.db.clients.find((c: any) => c.portalLogins?.length && !priya.db.clients.some((p: any) => p.id === c.id));
    expect(hidden).toBeTruthy();
    expect((await launch('priya', hidden.id, '0', { portalId: hidden.portalLogins[0].portalId })).status).toBe(404);

    // No saved password.
    expect((await h.cmd('admin', 'updateClient', ['c_meera', { portalLogins: [{ portalId: 'pt_gst', username: 'nopass', password: '' }] }])).status).toBe(200);
    const [nopass] = await loginsOf('admin', 'c_meera');
    expect((await launch('admin', 'c_meera', nopass.id)).status).toBe(409);

    // Client has left the firm.
    expect((await h.cmd('admin', 'updateClient', ['c_meera', { status: 'inactive', portalLogins: [{ ...nopass, password: 'Exit#1' }] }])).status).toBe(200);
    const r = await launch('admin', 'c_meera', nopass.id);
    expect(r.status).toBe(403);
    expect(r.json.password).toBeUndefined();
    expect((await h.cmd('admin', 'updateClient', ['c_meera', { status: 'active' }])).status).toBe(200);
    expect((await launch('admin', 'c_meera', nopass.id)).json.password).toBe('Exit#1');
  });
});

describe('multi-firm isolation', () => {
  it('keeps firms completely separate', async () => {
    const reg = await h.call('other', 'POST', '/api/auth/register', { firmName: 'Other & Co', name: 'Olga', email: 'olga@other.example', password: 'otherpass1' });
    expect(reg.status).toBe(200);
    const b = await h.boot('other');
    expect(b.db.firm.name).toBe('Other & Co');
    expect(b.db.tasks).toEqual([]);
    expect(b.db.clients).toEqual([]);
    expect(b.db.categories.length).toBeGreaterThan(0);
    expect((await h.cmd('other', 'addComment', ['LF-1133', 'hello'])).status).toBe(404);
    expect((await h.call('other', 'GET', '/api/clients/c_sunrise/logins/0')).status).toBe(404);
    expect((await h.call('other', 'POST', '/api/clients/c_sunrise/logins/0/launch', { portalId: 'pt_gst' })).status).toBe(404);
    expect((await h.cmd('other', 'fetchNotices', [])).status).toBe(400);
    expect((await h.call('dup', 'POST', '/api/auth/register', { firmName: 'Dup', name: 'X', email: 'olga@other.example', password: 'otherpass1' })).status).toBe(409);
  });
});

describe('files', () => {
  it('uploads, attaches and downloads with permission checks', async () => {
    const boundary = '----lf';
    const payload = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="note.txt"\r\nContent-Type: text/plain\r\n\r\nhello ledger\r\n--${boundary}--\r\n`;
    const up = await h.fastify.inject({
      method: 'POST',
      url: '/api/files?taskId=LF-1133',
      headers: { cookie: h.jars.get('priya')!, 'x-ledgerflow': '1', 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    expect(up.statusCode).toBe(200);
    const { fileId } = up.json();
    expect((await h.cmd('priya', 'addAttachment', ['LF-1133', { name: 'note.txt', sizeKb: 1, fileId }])).status).toBe(200);
    expect((await h.cmd('priya', 'addAttachment', ['LF-1134', { name: 'note.txt', sizeKb: 1, fileId }])).status).toBe(400);
    const dl = await h.call('priya', 'GET', `/api/files/${fileId}`);
    expect(dl.body).toBe('hello ledger');
    expect((await h.call('other', 'GET', `/api/files/${fileId}`)).status).toBe(404);
  });
});

describe('scheduled jobs', () => {
  it('creates deadline alerts once and is idempotent', async () => {
    const first = (await runJobsOnce(h.app))['firm_demo'];
    expect(first.dueSoon + first.overdue + first.dscExpiry).toBeGreaterThan(0);
    const v1 = (await h.boot('admin')).version;
    const second = (await runJobsOnce(h.app))['firm_demo'];
    expect(second.dueSoon + second.overdue + second.dscExpiry + second.reminders + second.generated).toBe(0);
    expect((await h.boot('admin')).version).toBe(v1);
  });
});

describe('persistence', () => {
  it('survives a cold reload from the database, preserving order', async () => {
    const warm = await h.boot('admin');
    h.app.firms.invalidate('firm_demo');
    const cold = await h.boot('admin');
    expect(cold.db.tasks.some((t: any) => t.title === 'My own to-do')).toBe(true);
    expect(cold.db.activities.map((a: any) => a.id)).toEqual(warm.db.activities.map((a: any) => a.id));
    expect(cold.db.tasks.map((t: any) => t.id)).toEqual(warm.db.tasks.map((t: any) => t.id));
  });
});

describe('concurrency', () => {
  it('serialises parallel writes without losing any', async () => {
    const before = (await h.boot('admin')).db.comments.filter((c: any) => c.taskId === 'LF-1132').length;
    const results = await Promise.all(Array.from({ length: 15 }, (_, i) => h.cmd(i % 2 ? 'admin' : 'vikram', 'addComment', ['LF-1132', `parallel ${i}`])));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => r.json.version)).size).toBe(15);
    h.app.firms.invalidate('firm_demo');
    const after = (await h.boot('admin')).db.comments.filter((c: any) => c.taskId === 'LF-1132').length;
    expect(after - before).toBe(15);
  });
});
