import { useSyncExternalStore } from 'react';
import { api, BACKEND } from '@/api/client';
import { adapterFor, type PortalAdapter } from '@/config/portalAdapters';
import type { Client, Portal, PortalLogin } from '@/types';

/**
 * Signing in to a client's portal.
 *
 * A web page cannot type into another site's tab, and a server-side browser
 * (Playwright/Selenium) cannot drive a tab in the user's own browser. So
 * autofill goes through the LedgerFlow Portal Helper extension
 * (`extension/portal-helper`): it opens the portal tab itself, types the
 * credentials only on the adapter's hosts, and leaves CAPTCHA/OTP to the user.
 * Without the extension the app opens the sign-in page and offers copy
 * buttons instead.
 *
 * Credentials travel app → extension over `chrome.runtime.connect`, never
 * `window.postMessage`, and are never logged or stored by the app.
 */

export type LoginState =
  | { state: 'working'; message: string }
  | { state: 'waiting'; message: string }
  | { state: 'signed_in'; message: string }
  | { state: 'error'; message: string };

export interface LaunchTarget {
  client: Client;
  login: PortalLogin;
  /** Position in client.portalLogins; used only for records saved before logins had ids. */
  index: number;
  portal: Portal;
}

export type LaunchResult = { mode: 'helper' } | { mode: 'manual'; adapter: PortalAdapter } | { mode: 'busy' } | { mode: 'error'; message: string };

// ------------------------------------------------------------------- status

const states = new Map<string, LoginState>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const setState = (key: string, s: LoginState | undefined) => {
  if (s) states.set(key, s);
  else states.delete(key);
  emit();
};

export const loginKey = (t: Pick<LaunchTarget, 'client' | 'login' | 'index'>) => `${t.client.id}:${t.login.id ?? `#${t.index}`}`;

export function useLoginState(key: string) {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => states.get(key),
  );
}

// ------------------------------------------------------------ helper bridge

interface ChromePort {
  postMessage(m: unknown): void;
  disconnect(): void;
  onMessage: { addListener(f: (m: HelperMessage) => void): void };
  onDisconnect: { addListener(f: () => void): void };
}
interface HelperMessage {
  requestId: string;
  status: 'opened' | 'filled' | 'needs_user' | 'signed_in' | 'busy' | 'error';
  message?: string;
}
declare global {
  interface Window {
    chrome?: { runtime?: { connect?: (id: string, info: { name: string }) => ChromePort } };
  }
}

let helperId: string | null = null;
const helperListeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  // The helper's content script announces its extension id on our origin.
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== window.location.origin) return;
    const d = e.data as { source?: string; type?: string; id?: string };
    if (d?.source === 'ledgerflow-helper' && d.type === 'hello' && typeof d.id === 'string' && /^[a-p]{32}$/.test(d.id)) {
      helperId = d.id;
      helperListeners.forEach((l) => l());
    }
  });
  window.postMessage({ source: 'ledgerflow-app', type: 'ping' }, window.location.origin);
}

const connectHelper = () => (helperId ? (window.chrome?.runtime?.connect?.(helperId, { name: 'portal-login' }) ?? null) : null);

export function useHelperInstalled() {
  return useSyncExternalStore(
    (l) => (helperListeners.add(l), () => helperListeners.delete(l)),
    () => !!helperId && !!window.chrome?.runtime?.connect,
  );
}

// ------------------------------------------------------------------- launch

/** Credentials for exactly this client + login + portal. Throws with a user-facing message. */
async function credentials(t: LaunchTarget) {
  if (BACKEND) {
    const r = await api.launchLogin(t.client.id, t.login.id ?? t.index, t.portal.id);
    if (r.clientId !== t.client.id || r.portalId !== t.portal.id) throw new Error('The server returned a different login. Nothing was filled.');
    return r;
  }
  if (t.client.exitDate) throw new Error('This client has left the firm. Re-activate them to use their portal logins.');
  if (!t.login.password) throw new Error('No password is saved for this login in this browser. Re-enter it under Edit client → Login Details.');
  return { username: t.login.username, password: t.login.password, extra: t.login.extra };
}

const HELPER_TIMEOUT_MS = 20_000;

/**
 * Starts signing in. Must be called from a click handler: without the helper
 * the sign-in page is opened synchronously so popup blockers allow it.
 */
export function launchPortalLogin(t: LaunchTarget): LaunchResult {
  const key = loginKey(t);
  const current = states.get(key);
  if (current?.state === 'working') return { mode: 'busy' };
  if (t.client.exitDate) return { mode: 'error', message: 'This client has left the firm. Re-activate them to use their portal logins.' };
  const adapter = adapterFor(t.portal);

  const port = connectHelper();
  if (!port) {
    // One named tab per client + portal, so repeated clicks reuse it.
    window.open(adapter.loginUrl, `lf_${t.client.id}_${t.portal.id}`.replace(/[^\w]/g, '_'), 'noopener');
    return { mode: 'manual', adapter };
  }

  const requestId = crypto.randomUUID();
  const label = `${t.portal.name} · ${t.client.name}`;
  setState(key, { state: 'working', message: 'Fetching credentials…' });
  let settled = false;
  const timer = window.setTimeout(() => {
    if (states.get(key)?.state === 'working') setState(key, { state: 'error', message: 'The Portal Helper did not respond. Check that it is enabled, then try again.' });
    port.disconnect();
  }, HELPER_TIMEOUT_MS);

  port.onMessage.addListener((m) => {
    if (m.requestId !== requestId) return;
    if (m.status === 'opened') {
      // The helper is alive; filling can take a while on two-step portals (e.g. Income Tax), so stop the timeout.
      window.clearTimeout(timer);
      setState(key, { state: 'waiting', message: adapter.fillHint ?? 'Portal opened — filling the sign-in form.' });
    }
    if (m.status === 'filled' || m.status === 'needs_user') {
      window.clearTimeout(timer);
      setState(key, { state: 'waiting', message: m.message ?? 'Details filled. Finish CAPTCHA / OTP in the portal tab.' });
    }
    if (m.status === 'signed_in') {
      settled = true;
      setState(key, { state: 'signed_in', message: m.message ?? 'The portal shows a signed-in page.' });
      port.disconnect();
    }
    if (m.status === 'busy' || m.status === 'error') {
      settled = true;
      window.clearTimeout(timer);
      setState(key, { state: 'error', message: m.message ?? 'The Portal Helper could not sign in.' });
      port.disconnect();
    }
  });
  port.onDisconnect.addListener(() => {
    window.clearTimeout(timer);
    if (!settled && states.get(key)?.state === 'working') setState(key, { state: 'error', message: 'The Portal Helper closed the connection.' });
  });

  credentials(t).then(
    (c) => {
      port.postMessage({ type: 'login', requestId, key, label, adapter, username: c.username, password: c.password, extra: c.extra });
      setState(key, { state: 'working', message: 'Opening the portal…' });
    },
    (e: Error) => {
      settled = true;
      window.clearTimeout(timer);
      port.disconnect();
      setState(key, { state: 'error', message: e.message });
    },
  );
  return { mode: 'helper' };
}

export const clearLoginState = (key: string) => setState(key, undefined);

/** Password for the manual fallback's copy button (audited on the server). */
export async function fetchPassword(t: LaunchTarget) {
  if (!BACKEND) return t.login.password;
  return (await api.revealLogin(t.client.id, t.login.id ?? t.index, t.portal.id)).password;
}
