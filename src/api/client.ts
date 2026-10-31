import type { CommandName } from '@/domain/commands';
import type { ProposedId } from '@/domain/context';
import type { Database, UserStatus } from '@/types';

/**
 * Backend mode is enabled at build time with VITE_BACKEND=1 (set in .env.backend). The API lives at
 * VITE_API_URL (default: same origin, `/api`). Without it the app runs as the
 * self-contained browser demo.
 */
export const BACKEND = import.meta.env.VITE_BACKEND === '1';
export const API_BASE = `${(import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')}/api`;

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

/** JSON with `undefined` sent as null so the server can tell "cleared" from "absent". */
const encode = (v: unknown) => JSON.stringify(v, (_k, val) => (val === undefined ? null : val));

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include',
    headers: { 'x-ledgerflow': '1', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? encode(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(data.message ?? `Request failed (${res.status})`, res.status, data.code);
  return data as T;
}

export interface Capabilities {
  whatsapp: 'simulated' | 'meta';
  /** The server's default business number, when one is configured. */
  whatsappNumber?: string;
  /** Whether the server has a default number (WHATSAPP_TOKEN), used for chats not tied to a firm number. */
  whatsappDefault?: boolean;
  email: boolean;
  gstLookup: 'demo' | 'provider';
  noticeFetch: 'demo' | 'manual';
  storage: 'local' | 's3';
}

/** A firm as the platform superadmin sees it: size and admins, nothing from inside the firm. */
export interface PlatformFirm {
  id: string;
  name: string;
  createdAt: string;
  suspendedAt: string | null;
  members: number;
  admins: FirmAdmin[];
}
export interface FirmAdmin {
  id: string;
  email: string;
  name: string;
  status: UserStatus;
  hasPassword: boolean;
  lastLoginAt: string | null;
}

/** What the demo build (no server) can do: everything integration-backed is simulated. */
export const DEMO_CAPS: Capabilities = { whatsapp: 'simulated', email: false, gstLookup: 'demo', noticeFetch: 'demo', storage: 'local' };

export interface Bootstrap {
  db: Database;
  meId: string;
  version: number;
  caps: Capabilities;
}

export interface CommandAck {
  ok: true;
  version: number;
  idsChanged?: boolean;
  meta?: { inviteUrl?: string; emailed?: boolean };
}

export const api = {
  me: () => request<{ userId: string; firmId: string }>('GET', '/auth/me'),
  login: (email: string, password: string) => request<{ ok: true }>('POST', '/auth/login', { email, password }),
  logout: () => request<{ ok: true }>('POST', '/auth/logout', {}),
  inviteInfo: (token: string) => request<{ name: string; email: string; firm: string }>('GET', `/auth/invite/${encodeURIComponent(token)}`),
  acceptInvite: (token: string, password: string) => request<{ ok: true }>('POST', '/auth/accept-invite', { token, password }),
  changePassword: (current: string, next: string) => request<{ ok: true }>('POST', '/auth/password', { current, next }),
  forgotPassword: (email: string) => request<{ ok: true }>('POST', '/auth/forgot-password', { email }),
  resetInfo: (token: string) => request<{ name: string; email: string }>('GET', `/auth/reset/${encodeURIComponent(token)}`),
  resetPassword: (token: string, password: string) => request<{ ok: true }>('POST', '/auth/reset-password', { token, password }),
  resetLink: (userId: string) => request<{ resetUrl: string; emailed: boolean }>('POST', `/users/${encodeURIComponent(userId)}/reset-link`, {}),
  inviteLink: (userId: string) => request<{ inviteUrl: string; emailed: boolean }>('POST', `/users/${encodeURIComponent(userId)}/invite-link`, {}),
  bootstrap: () => request<Bootstrap>('GET', '/bootstrap'),
  command: (name: CommandName, args: unknown[], ids: ProposedId[]) => request<CommandAck>('POST', `/commands/${name}`, { args, ids }),
  revealLogin: (clientId: string, ref: string | number, portalId?: string) =>
    request<{ password: string }>('GET', `/clients/${encodeURIComponent(clientId)}/logins/${encodeURIComponent(ref)}${portalId ? `?portalId=${encodeURIComponent(portalId)}` : ''}`),
  launchLogin: (clientId: string, ref: string | number, portalId: string) =>
    request<{ clientId: string; portalId: string; username: string; password: string; extra?: string }>('POST', `/clients/${encodeURIComponent(clientId)}/logins/${encodeURIComponent(ref)}/launch`, { portalId }),
  whatsappSetup: () => request<{ callbackUrl: string; verifyToken: string | null }>('GET', '/whatsapp/setup'),
  connectWhatsAppNumber: (input: { label: string; phoneNumberId: string; wabaId: string; token: string; appSecret: string }) =>
    request<{ id: string; displayNumber: string; verifiedName: string }>('POST', '/whatsapp/numbers', input),
  disconnectWhatsAppNumber: (id: string) => request<{ ok: true }>('DELETE', `/whatsapp/numbers/${encodeURIComponent(id)}`),
  /** Platform superadmin (separate account and session from firm users). */
  platform: {
    me: () => request<{ id: string; email: string; name: string }>('GET', '/platform/me'),
    login: (email: string, password: string) => request<{ ok: true }>('POST', '/platform/login', { email, password }),
    logout: () => request<{ ok: true }>('POST', '/platform/logout', {}),
    changePassword: (current: string, next: string) => request<{ ok: true }>('POST', '/platform/password', { current, next }),
    firms: () => request<{ firms: PlatformFirm[] }>('GET', '/platform/firms'),
    createFirm: (input: { firmName: string; adminName: string; email: string; password: string }) => request<{ id: string }>('POST', '/platform/firms', input),
    setSuspended: (firmId: string, suspended: boolean) => request<{ ok: true }>('PATCH', `/platform/firms/${encodeURIComponent(firmId)}`, { suspended }),
    deleteFirm: (firmId: string, confirmName: string) => request<{ ok: true }>('DELETE', `/platform/firms/${encodeURIComponent(firmId)}`, { confirmName }),
    addAdmin: (firmId: string, input: { name: string; email: string; password: string }) => request<{ id: string }>('POST', `/platform/firms/${encodeURIComponent(firmId)}/admins`, input),
    setAdminStatus: (userId: string, status: 'active' | 'deactivated') => request<{ ok: true }>('PATCH', `/platform/admins/${encodeURIComponent(userId)}`, { status }),
    setAdminPassword: (userId: string, password: string) => request<{ ok: true }>('POST', `/platform/admins/${encodeURIComponent(userId)}/password`, { password }),
    deleteAdmin: (userId: string) => request<{ ok: true }>('DELETE', `/platform/admins/${encodeURIComponent(userId)}`),
  },
  gstin: (gstin: string) => request<{ record: unknown; pan: string; state: string; checksumOk: boolean; source: 'demo' | 'provider' }>('GET', `/gstin/${encodeURIComponent(gstin)}`),
  async upload(file: File, scope: { taskId?: string; clientId?: string }) {
    const q = new URLSearchParams(scope.taskId ? { taskId: scope.taskId } : { clientId: scope.clientId ?? '' });
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${API_BASE}/files?${q}`, { method: 'POST', credentials: 'include', headers: { 'x-ledgerflow': '1' }, body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data.message ?? 'Upload failed', res.status);
    return data as { fileId: string; name: string; sizeKb: number };
  },
  fileUrl: (fileId: string) => `${API_BASE}/files/${encodeURIComponent(fileId)}`,
  eventsUrl: () => `${API_BASE}/events`,
};
