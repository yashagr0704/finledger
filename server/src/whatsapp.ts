import type { Config } from './config';

export interface SendResult {
  ok: boolean;
  externalId?: string;
  error?: string;
}

/**
 * WhatsApp delivery. With WHATSAPP_TOKEN + WHATSAPP_PHONE_ID it uses the Meta
 * Cloud API; otherwise messages are simulated (marked delivered, not sent).
 *
 * Note: Meta only allows free-form text within 24 hours of the client's last
 * message. Broadcasts and first contact need pre-approved templates.
 */
export function makeWhatsApp(config: Config) {
  const wa = config.whatsapp;
  let displayNumber: Promise<string | undefined> | undefined;
  return {
    mode: (wa ? 'meta' : 'simulated') as 'meta' | 'simulated',
    /** The business number as Meta shows it, e.g. "+91 98200 55101". Looked up once; retried after a failure. */
    displayNumber(): Promise<string | undefined> {
      if (!wa) return Promise.resolve(undefined);
      displayNumber ??= fetch(`https://graph.facebook.com/v20.0/${wa.phoneId}?fields=display_phone_number`, { headers: { authorization: `Bearer ${wa.token}` }, signal: AbortSignal.timeout(5000) })
        .then(async (r) => (r.ok ? ((await r.json()) as { display_phone_number?: string }).display_phone_number : undefined))
        .catch(() => undefined)
        .then((n) => (n ? n : ((displayNumber = undefined), undefined)));
      return displayNumber;
    },
    async send(phone: string, body: string): Promise<SendResult> {
      if (!wa) return { ok: true };
      const to = toWhatsAppNumber(phone);
      if (!to) return { ok: false, error: 'No valid mobile number' };
      try {
        const res = await fetch(`https://graph.facebook.com/v20.0/${wa.phoneId}/messages`, {
          method: 'POST',
          headers: { authorization: `Bearer ${wa.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }),
        });
        const data = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
        if (!res.ok) return { ok: false, error: data.error?.message ?? `HTTP ${res.status}` };
        return { ok: true, externalId: data.messages?.[0]?.id };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
      }
    },
  };
}
export type WhatsApp = ReturnType<typeof makeWhatsApp>;

/** Digits in international format, as Meta expects. Bare 10-digit and 0-prefixed numbers are taken as Indian. */
export function toWhatsAppNumber(phone: string) {
  let d = phone.replace(/[^\d]/g, '');
  if (/^0\d{10}$/.test(d)) d = d.slice(1);
  if (/^[6-9]\d{9}$/.test(d)) d = `91${d}`;
  return d.length >= 11 ? d : null;
}
