import type { Config } from './config';

export interface SendResult {
  ok: boolean;
  externalId?: string;
  error?: string;
}

/** What it takes to send from one WhatsApp Business number. */
export interface WaCreds {
  phoneId: string;
  token: string;
}

const GRAPH = 'https://graph.facebook.com/v20.0';

/** Calls the Graph API and returns its JSON, or throws with Meta's own error message. */
async function graph<T>(path: string, token: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${GRAPH}/${path}`, {
    method: init.method ?? 'GET',
    headers: { authorization: `Bearer ${token}`, ...(init.body ? { 'content-type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number } };
  if (!res.ok) throw new Error(data.error?.message ? `${data.error.code ? `(#${data.error.code}) ` : ''}${data.error.message}` : `Meta returned HTTP ${res.status}`);
  return data;
}

/**
 * WhatsApp delivery through the Meta Cloud API.
 *
 * Firms connect their own numbers (stored per firm, token encrypted); a message is sent
 * with the credentials of the number it belongs to. WHATSAPP_TOKEN + WHATSAPP_PHONE_ID
 * optionally provide a server-wide default number. Without either, sending is simulated.
 *
 * Note: Meta only allows free-form text within 24 hours of the client's last
 * message. Broadcasts and first contact need pre-approved templates.
 */
export function makeWhatsApp(config: Config) {
  const wa = config.whatsapp;
  const defaultCreds: WaCreds | undefined = wa ? { phoneId: wa.phoneId, token: wa.token } : undefined;
  let displayNumber: Promise<string | undefined> | undefined;
  return {
    /** Whether the server-wide default number is configured. */
    mode: (wa ? 'meta' : 'simulated') as 'meta' | 'simulated',
    defaultCreds,
    /** The default number as Meta shows it, e.g. "+91 98200 55101". Looked up once; retried after a failure. */
    displayNumber(): Promise<string | undefined> {
      if (!wa) return Promise.resolve(undefined);
      displayNumber ??= graph<{ display_phone_number?: string }>(`${wa.phoneId}?fields=display_phone_number`, wa.token)
        .then((d) => d.display_phone_number)
        .catch(() => undefined)
        .then((n) => (n ? n : ((displayNumber = undefined), undefined)));
      return displayNumber;
    },
    /** Sends a text. Without credentials (no number configured) the send is simulated. */
    async send(phone: string, body: string, creds: WaCreds | undefined = defaultCreds): Promise<SendResult> {
      if (!creds) return { ok: true };
      const to = toWhatsAppNumber(phone);
      if (!to) return { ok: false, error: 'No valid mobile number' };
      try {
        const data = await graph<{ messages?: { id: string }[] }>(`${creds.phoneId}/messages`, creds.token, {
          method: 'POST',
          body: { messaging_product: 'whatsapp', to, type: 'text', text: { body } },
        });
        return { ok: true, externalId: data.messages?.[0]?.id };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
      }
    },
    /** Checks a number's credentials with Meta. Throws a readable error when they don't work. */
    async lookupNumber(phoneId: string, token: string) {
      const d = await graph<{ display_phone_number?: string; verified_name?: string }>(`${encodeURIComponent(phoneId)}?fields=display_phone_number,verified_name`, token);
      if (!d.display_phone_number) throw new Error('Meta did not return a phone number for that Phone Number ID.');
      return { displayNumber: d.display_phone_number, verifiedName: d.verified_name ?? '' };
    },
    /** Subscribes our Meta app to the account's webhooks, so its incoming messages reach us. */
    async subscribe(wabaId: string, token: string) {
      await graph(`${encodeURIComponent(wabaId)}/subscribed_apps`, token, { method: 'POST' });
    },
    async unsubscribe(wabaId: string, token: string) {
      await graph(`${encodeURIComponent(wabaId)}/subscribed_apps`, token, { method: 'DELETE' });
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
