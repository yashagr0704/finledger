import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup, type Harness } from './helpers';

const APP_SECRET = 'test-app-secret';
let h: Harness;
beforeAll(async () => {
  h = await setup({ whatsapp: { token: 'test-token', phoneId: '1000', verifyToken: 'verify-me', appSecret: APP_SECRET } });
});
afterAll(() => h.close());

const post = (body: unknown, sign: string | null = APP_SECRET) => {
  const payload = JSON.stringify(body);
  const sig = sign ? 'sha256=' + crypto.createHmac('sha256', sign).update(payload).digest('hex') : undefined;
  return h.fastify.inject({ method: 'POST', url: '/api/webhooks/whatsapp', headers: { 'content-type': 'application/json', ...(sig ? { 'x-hub-signature-256': sig } : {}) }, payload });
};
const incoming = (from: string, id: string, text: string, name?: string) => ({
  entry: [{ changes: [{ value: { contacts: name ? [{ wa_id: from, profile: { name } }] : [], messages: [{ from, id, timestamp: '1793210000', type: 'text', text: { body: text } }] } }] }],
});
// Read straight from the store: bootstrap would look up the business number at Meta.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = async (): Promise<any> => (await h.app.firms.get('firm_demo')).db;

describe('WhatsApp webhook', () => {
  it('answers Meta’s verification handshake only with the right token', async () => {
    const ok = await h.fastify.inject({ method: 'GET', url: '/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42' });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe('42');
    expect((await h.fastify.inject({ method: 'GET', url: '/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42' })).statusCode).toBe(403);
  });

  it('rejects unsigned and wrongly signed calls', async () => {
    expect((await post(incoming('919999900001', 'wamid.x1', 'hi'), null)).statusCode).toBe(401);
    expect((await post(incoming('919999900001', 'wamid.x1', 'hi'), 'not-the-secret')).statusCode).toBe(401);
    expect((await db()).chats.some((c: { externalId?: string }) => c.externalId === 'wamid.x1')).toBe(false);
  });

  it('files a message from a known client under that client, once', async () => {
    const client = (await db()).clients.find((c: { phone: string }) => c.phone.replace(/\D/g, '').length >= 10);
    const from = `91${client.phone.replace(/\D/g, '').slice(-10)}`;
    expect((await post(incoming(from, 'wamid.k1', 'Documents sent'))).statusCode).toBe(200);
    expect((await post(incoming(from, 'wamid.k1', 'Documents sent'))).statusCode).toBe(200); // Meta retries
    const msgs = (await db()).chats.filter((c: { externalId?: string }) => c.externalId === 'wamid.k1');
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ clientId: client.id, direction: 'in', body: 'Documents sent', at: new Date(1793210000 * 1000).toISOString() });
  });

  it('adds an unknown sender as an onboarding client so the chat shows up', async () => {
    expect((await post(incoming('447700900123', 'wamid.u1', 'Hello, I need help with ITR', 'Asha Verma'))).statusCode).toBe(200);
    const d = await db();
    const client = d.clients.find((c: { phone: string }) => c.phone === '+447700900123');
    expect(client).toMatchObject({ name: 'Asha Verma', contactName: 'Asha Verma', status: 'onboarding', entityType: 'Individual', code: 'WA-0123' });
    expect(d.chats.find((c: { externalId?: string }) => c.externalId === 'wamid.u1')).toMatchObject({ clientId: client.id, body: 'Hello, I need help with ITR' });

    // A second message from the same number goes to the same client.
    await post(incoming('447700900123', 'wamid.u2', 'Are you there?'));
    const again = await db();
    expect(again.clients.filter((c: { phone: string }) => c.phone === '+447700900123')).toHaveLength(1);
    expect(again.chats.find((c: { externalId?: string }) => c.externalId === 'wamid.u2').clientId).toBe(client.id);
  });

  it('updates delivery status of sent messages', async () => {
    const d = await db();
    const clientId = d.clients[0].id;
    await h.app.firms.mutate('firm_demo', (current) => ({
      db: { ...current, chats: [...current.chats, { id: 'wa_status_test', clientId, direction: 'out' as const, body: 'Filed', at: new Date().toISOString(), status: 'sent' as const, externalId: 'wamid.out1' }] },
      result: null,
    }));
    await post({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.out1', status: 'read' }] } }] }] });
    expect((await db()).chats.find((c: { id: string }) => c.id === 'wa_status_test').status).toBe('read');
  });
});
