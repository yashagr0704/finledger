import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { setup, type Harness } from './helpers';

/**
 * Firms connecting their own WhatsApp numbers. Meta's Graph API is replaced by a fake that
 * accepts the token "good-token-0123456789abcdef" for any phone number ID and records every call.
 */
const graphCalls: { method: string; url: string; auth?: string; body?: string }[] = [];
const realFetch = globalThis.fetch;
let sent = 0;
vi.stubGlobal('fetch', async (input: string | URL, init: RequestInit = {}) => {
  const url = String(input);
  if (!url.startsWith('https://graph.facebook.com/')) return realFetch(input, init);
  const auth = new Headers(init.headers).get('authorization') ?? undefined;
  graphCalls.push({ method: init.method ?? 'GET', url, auth, body: init.body as string | undefined });
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (auth !== 'Bearer good-token-0123456789abcdef') return json(401, { error: { message: 'Invalid OAuth access token.', code: 190 } });
  if (url.includes('/subscribed_apps')) return json(200, { success: true });
  if (url.endsWith('/messages')) return json(200, { messages: [{ id: `wamid.out.${++sent}` }] });
  const phoneId = new URL(url).pathname.split('/').pop();
  return json(200, { display_phone_number: `+91 90000 ${phoneId!.slice(-5)}`, verified_name: `Desk ${phoneId!.slice(-2)}`, id: phoneId });
});

const SECRET_A = 'a'.repeat(32);
const SECRET_B = 'b'.repeat(32);
const number = (phoneNumberId: string, appSecret: string, over: Record<string, string> = {}) => ({ label: '', phoneNumberId, wabaId: '777000111', token: 'good-token-0123456789abcdef', appSecret, ...over });

let h: Harness;
beforeAll(async () => {
  h = await setup();
  expect((await h.login('admin', 'rohan@mehtaiyer.demo')).status).toBe(200);
  expect((await h.login('vikram', 'vikram@mehtaiyer.demo')).status).toBe(200);
  expect((await h.login('priya', 'priya@mehtaiyer.demo')).status).toBe(200);
  expect((await h.call('other', 'POST', '/api/auth/register', { firmName: 'Other & Co', name: 'Olga', email: 'olga@other.example', password: 'otherpass1' })).status).toBe(200);
});
afterAll(() => (vi.unstubAllGlobals(), h.close()));

const firmDb = async (firmId = 'firm_demo') => (await h.app.firms.get(firmId)).db;
const otherFirmId = async () => (await h.db.query<{ id: string }>("SELECT id FROM firms WHERE id <> 'firm_demo'")).rows[0].id;
const webhook = (body: unknown, secret: string) => {
  const payload = JSON.stringify(body);
  const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return h.fastify.inject({ method: 'POST', url: '/api/webhooks/whatsapp', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig }, payload });
};
const inbound = (phoneNumberId: string, from: string, id: string, text: string) => ({
  object: 'whatsapp_business_account',
  entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId }, contacts: [{ wa_id: from, profile: { name: 'Caller' } }], messages: [{ from, id, timestamp: '1793210000', type: 'text', text: { body: text } }] } }] }],
});
const waitFor = async <T>(fn: () => Promise<T | undefined>) => {
  for (let i = 0; i < 50; i++) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timed out');
};

describe('connecting WhatsApp numbers', () => {
  it('is for firm admins only', async () => {
    expect((await h.call('vikram', 'POST', '/api/whatsapp/numbers', number('100200300401', SECRET_A))).status).toBe(403);
    expect((await h.call('priya', 'GET', '/api/whatsapp/setup')).status).toBe(403);
    const s = await h.call('admin', 'GET', '/api/whatsapp/setup');
    expect(s.json.callbackUrl).toMatch(/\/api\/webhooks\/whatsapp$/);
  });

  it('checks the details with Meta and stores nothing when they are wrong', async () => {
    const bad = await h.call('admin', 'POST', '/api/whatsapp/numbers', number('100200300401', SECRET_A, { token: 'bad-token-xxxxxxxxxxxxxxxx' }));
    expect(bad.status).toBe(400);
    expect(bad.json.message).toContain('Invalid OAuth access token');
    expect((await h.call('admin', 'POST', '/api/whatsapp/numbers', number('12ab', SECRET_A))).status).toBe(400);
    expect((await h.call('admin', 'POST', '/api/whatsapp/numbers', number('100200300401', 'short'))).status).toBe(400);
    expect((await firmDb()).waNumbers).toHaveLength(0);
  });

  it('connects a number, subscribes the account, and never reveals the token', async () => {
    const r = await h.call('admin', 'POST', '/api/whatsapp/numbers', number('100200300401', SECRET_A, { label: 'Front desk' }));
    expect(r.status).toBe(200);
    expect(r.json.displayNumber).toBe('+91 90000 00401');
    expect(graphCalls.some((c) => c.method === 'POST' && c.url.endsWith('/777000111/subscribed_apps'))).toBe(true);

    const boot = (await h.call('admin', 'GET', '/api/bootstrap')).json;
    expect(boot.caps.whatsapp).toBe('meta');
    expect(boot.db.waNumbers).toEqual([expect.objectContaining({ id: r.json.id, label: 'Front desk', status: 'connected', token: '', appSecret: '' })]);
    expect((await h.call('priya', 'GET', '/api/bootstrap')).json.db.waNumbers).toEqual([]); // no WhatsApp access

    const { rows } = await h.db.query<{ data: { token: string; appSecret: string } }>("SELECT data FROM records WHERE collection = 'waNumbers'");
    expect(rows[0].data.token).toMatch(/^enc:v1:/);
    expect(rows[0].data.appSecret).toMatch(/^enc:v1:/);
    expect(JSON.stringify(rows)).not.toContain('good-token');

    expect((await h.call('admin', 'POST', '/api/whatsapp/numbers', number('100200300401', SECRET_A))).status).toBe(409); // already connected
  });

  it('lets each number belong to one firm only', async () => {
    const r = await h.call('other', 'POST', '/api/whatsapp/numbers', number('100200300401', SECRET_B));
    expect(r.status).toBe(409);
    expect((await h.call('other', 'POST', '/api/whatsapp/numbers', number('100200300402', SECRET_B))).status).toBe(200);
  });
});

describe('the shared inbox', () => {
  it('files incoming messages under the firm and number they were sent to', async () => {
    const a = (await firmDb()).waNumbers[0];
    expect((await webhook(inbound('100200300401', '919999911111', 'wamid.in.a1', 'Hello firm A'), SECRET_A)).statusCode).toBe(200);
    expect((await webhook(inbound('100200300402', '919999922222', 'wamid.in.b1', 'Hello firm B'), SECRET_B)).statusCode).toBe(200);

    const demo = await firmDb();
    expect(demo.chats.find((m) => m.externalId === 'wamid.in.a1')).toMatchObject({ numberId: a.id, direction: 'in', body: 'Hello firm A' });
    expect(demo.chats.some((m) => m.externalId === 'wamid.in.b1')).toBe(false);
    const other = await firmDb(await otherFirmId());
    expect(other.chats.find((m) => m.externalId === 'wamid.in.b1')).toBeTruthy();
    expect(other.chats.some((m) => m.externalId === 'wamid.in.a1')).toBe(false);
  });

  it('refuses messages for a number signed with any other secret', async () => {
    expect((await webhook(inbound('100200300401', '919999911111', 'wamid.forged.1', 'forged'), SECRET_B)).statusCode).toBe(401);
    // Firm B's valid secret can't smuggle a message into firm A's number in the same call.
    const mixed = inbound('100200300402', '919999922222', 'wamid.mixed.b', 'ok for B');
    mixed.entry[0].changes.push(inbound('100200300401', '919999911111', 'wamid.mixed.a', 'smuggled').entry[0].changes[0]);
    expect((await webhook(mixed, SECRET_B)).statusCode).toBe(200);
    expect((await firmDb()).chats.some((m) => m.externalId === 'wamid.mixed.a')).toBe(false);
    expect((await firmDb(await otherFirmId())).chats.some((m) => m.externalId === 'wamid.mixed.b')).toBe(true);
  });

  it('replies from the conversation’s own number and token', async () => {
    const d = await firmDb();
    const a = d.waNumbers[0];
    const clientId = d.chats.find((m) => m.externalId === 'wamid.in.a1')!.clientId;
    expect((await h.cmd('admin', 'sendChat', [clientId, 'Reply from A', a.id])).status).toBe(200);
    const msg = await waitFor(async () => (await firmDb()).chats.find((m) => m.body === 'Reply from A' && m.externalId));
    expect(msg).toMatchObject({ numberId: a.id, status: 'sent' });
    const call = graphCalls.find((c) => c.url.endsWith('/100200300401/messages') && c.body?.includes('Reply from A'));
    expect(call?.auth).toBe('Bearer good-token-0123456789abcdef');
    expect(JSON.parse(call!.body!).to).toBe('919999911111');
  });

  it('assigns conversations to team members with WhatsApp access', async () => {
    const d = await firmDb();
    const a = d.waNumbers[0];
    const clientId = d.chats.find((m) => m.externalId === 'wamid.in.a1')!.clientId;
    expect((await h.cmd('admin', 'assignWhatsAppThread', [clientId, a.id, 'u_priya'])).status).toBe(400); // no WhatsApp permission
    expect((await h.cmd('admin', 'assignWhatsAppThread', [clientId, a.id, 'u_vikram'])).status).toBe(200);
    const after = await firmDb();
    expect(after.waThreads).toEqual([expect.objectContaining({ clientId, numberId: a.id, assigneeId: 'u_vikram' })]);
    expect(after.notifications.some((n) => n.userId === 'u_vikram' && n.clientId === clientId && n.title.includes('assigned to you'))).toBe(true);
    expect((await h.cmd('admin', 'assignWhatsAppThread', [clientId, a.id])).status).toBe(200); // unassign
    expect((await firmDb()).waThreads[0].assigneeId).toBeUndefined();
    expect((await h.cmd('priya', 'assignWhatsAppThread', [clientId, a.id, 'u_vikram'])).status).toBe(403);
  });
});

describe('removing a number', () => {
  it('stops sending and receiving but keeps the history, and can be reconnected', async () => {
    const a = (await firmDb()).waNumbers[0];
    const historyBefore = (await firmDb()).chats.filter((m) => m.numberId === a.id).length;
    expect((await h.call('vikram', 'DELETE', `/api/whatsapp/numbers/${a.id}`)).status).toBe(403);
    expect((await h.call('admin', 'DELETE', `/api/whatsapp/numbers/${a.id}`)).status).toBe(200);
    expect(graphCalls.some((c) => c.method === 'DELETE' && c.url.endsWith('/777000111/subscribed_apps'))).toBe(true);

    const d = await firmDb();
    expect(d.waNumbers[0]).toMatchObject({ status: 'disconnected', token: '', appSecret: '' });
    expect(d.chats.filter((m) => m.numberId === a.id)).toHaveLength(historyBefore);
    expect((await h.db.query("SELECT 1 FROM whatsapp_numbers WHERE phone_number_id = '100200300401'")).rows).toHaveLength(0);

    const clientId = d.chats.find((m) => m.externalId === 'wamid.in.a1')!.clientId;
    expect((await h.cmd('admin', 'sendChat', [clientId, 'after disconnect', a.id])).status).toBe(400);
    expect((await webhook(inbound('100200300401', '919999911111', 'wamid.in.a2', 'still there?'), SECRET_A)).statusCode).not.toBe(200);

    const again = await h.call('admin', 'POST', '/api/whatsapp/numbers', number('100200300401', SECRET_A));
    expect(again.status).toBe(200);
    expect(again.json.id).toBe(a.id); // same inbox, history continues
    expect((await firmDb()).waNumbers).toHaveLength(1);
  });
});
