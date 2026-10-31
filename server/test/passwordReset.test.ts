import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup, type Harness } from './helpers';

let h: Harness;
const outbox: { to: string; subject: string; text: string }[] = [];
beforeAll(async () => {
  h = await setup();
  // Capture email instead of sending it.
  h.app.mailer.send = async (to, subject, text) => (outbox.push({ to, subject, text }), true);
  expect((await h.login('admin', 'rohan@mehtaiyer.demo')).status).toBe(200);
});
afterAll(() => h.close());

/** The reset email for `to` (requests send it in the background). */
async function mailFor(to: string) {
  for (let i = 0; i < 50; i++) {
    const m = [...outbox].reverse().find((x) => x.to === to);
    if (m) return m;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`no email to ${to}`);
}
const tokenIn = (text: string) => /reset-password\?token=([\w-]+)/.exec(text)![1];
const forgot = (email: string) => h.call(null, 'POST', '/api/auth/forgot-password', { email });

describe('forgot password', () => {
  it('emails a one-time link that sets a new password, signs in and signs other devices out', async () => {
    expect((await h.login('priya', 'priya@mehtaiyer.demo')).status).toBe(200);
    expect((await forgot('Priya@MehtaIyer.demo')).status).toBe(200);
    const mail = await mailFor('priya@mehtaiyer.demo');
    expect(mail.subject).toMatch(/Reset your/);
    const token = tokenIn(mail.text);

    expect((await h.call(null, 'GET', `/api/auth/reset/${token}`)).json.email).toBe('priya@mehtaiyer.demo');
    expect((await h.call('reset', 'POST', '/api/auth/reset-password', { token, password: 'short' })).status).toBe(400);
    expect((await h.call('reset', 'POST', '/api/auth/reset-password', { token, password: 'priya-new-pass' })).status).toBe(200);
    expect((await h.call('reset', 'GET', '/api/bootstrap')).status).toBe(200); // signed in by the reset
    expect((await h.call('priya', 'GET', '/api/bootstrap')).status).toBe(401); // old session ended
    expect((await h.login('x', 'priya@mehtaiyer.demo', 'demo1234')).status).toBe(401);
    expect((await h.login('x', 'priya@mehtaiyer.demo', 'priya-new-pass')).status).toBe(200);
    // Used once only.
    expect((await h.call('again', 'POST', '/api/auth/reset-password', { token, password: 'another-pass-1' })).status).toBe(404);
  });

  it('answers the same for unknown emails and sends nothing', async () => {
    const before = outbox.length;
    const r = await forgot('nobody@nowhere.example');
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true });
    await new Promise((res) => setTimeout(res, 100));
    expect(outbox.length).toBe(before);
  });

  it('only the newest link works, and expired links do not', async () => {
    await forgot('arjun@mehtaiyer.demo');
    const first = tokenIn((await mailFor('arjun@mehtaiyer.demo')).text);
    outbox.length = 0;
    await forgot('arjun@mehtaiyer.demo');
    const second = tokenIn((await mailFor('arjun@mehtaiyer.demo')).text);
    expect((await h.call(null, 'GET', `/api/auth/reset/${first}`)).status).toBe(404);
    await h.db.query("UPDATE password_resets SET expires_at = now() - interval '1 minute' WHERE used_at IS NULL");
    expect((await h.call(null, 'GET', `/api/auth/reset/${second}`)).status).toBe(404);
  });

  it('does not let deactivated members reset their way back in', async () => {
    await forgot('kavya@mehtaiyer.demo');
    const token = tokenIn((await mailFor('kavya@mehtaiyer.demo')).text);
    await h.db.query(`UPDATE users SET data = jsonb_set(data, '{status}', '"deactivated"') WHERE email = 'kavya@mehtaiyer.demo'`);
    expect((await h.call('k', 'POST', '/api/auth/reset-password', { token, password: 'kavya-new-pass' })).status).toBe(403);
    // And a deactivated member gets no new link.
    outbox.length = 0;
    await forgot('kavya@mehtaiyer.demo');
    await new Promise((res) => setTimeout(res, 100));
    expect(outbox).toHaveLength(0);
  });

  it('lets a firm admin create a reset link for an active member, not for others', async () => {
    const r = await h.call('admin', 'POST', '/api/users/u_neha/reset-link', {});
    expect(r.status).toBe(200);
    expect(r.json.resetUrl).toMatch(/\/reset-password\?token=/);
    expect((await h.call('admin', 'POST', '/api/users/u_isha/reset-link', {})).status).toBe(400); // still invited
    expect((await h.login('vikram', 'vikram@mehtaiyer.demo')).status).toBe(200);
    expect((await h.call('vikram', 'POST', '/api/users/u_neha/reset-link', {})).status).toBe(403); // managers can't
  });
});
