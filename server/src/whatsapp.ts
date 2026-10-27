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
  return {
    mode: (wa ? 'meta' : 'simulated') as 'meta' | 'simulated',
    async send(phone: string, body: string): Promise<SendResult> {
      if (!wa) return { ok: true };
      const to = phone.replace(/[^\d]/g, '');
      if (to.length < 10) return { ok: false, error: 'No valid mobile number' };
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
