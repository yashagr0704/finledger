import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const env = process.env;
const bool = (v: string | undefined, d: boolean) => (v === undefined || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()));
const num = (v: string | undefined, d: number) => (v ? Number(v) : d);

export const isProd = env.NODE_ENV === 'production';
const dataDir = path.resolve(env.DATA_DIR ?? '.data');

/**
 * APP_SECRET encrypts stored client portal passwords. It is required in
 * production; in development one is generated once and kept in DATA_DIR.
 */
function appSecret(): string {
  if (env.APP_SECRET) {
    if (env.APP_SECRET.length < 32) throw new Error('APP_SECRET must be at least 32 characters.');
    return env.APP_SECRET;
  }
  if (isProd) throw new Error('APP_SECRET is required in production (32+ random characters).');
  const file = path.join(dataDir, 'app-secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  fs.mkdirSync(dataDir, { recursive: true });
  const s = crypto.randomBytes(32).toString('base64url');
  fs.writeFileSync(file, s, { mode: 0o600 });
  return s;
}

export interface Config {
  port: number;
  host: string;
  publicUrl: string;
  databaseUrl?: string;
  pgliteDir: string;
  appSecret: string;
  cookieSecure: boolean;
  corsOrigin?: string;
  allowSignup: boolean;
  storageDir: string;
  fileMaxMb: number;
  staticDir?: string;
  jobsEnabled: boolean;
  jobIntervalMin: number;
  smtpUrl?: string;
  mailFrom: string;
  whatsapp?: { token: string; phoneId: string; verifyToken?: string; appSecret?: string; firmId?: string };
  gstApi?: { url: string; key?: string };
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const port = num(env.PORT, 8787);
  const staticDir = path.resolve(env.STATIC_DIR ?? 'dist');
  return {
    port,
    host: env.HOST ?? '0.0.0.0',
    publicUrl: (env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, ''),
    databaseUrl: env.DATABASE_URL || undefined,
    pgliteDir: path.resolve(env.PGLITE_DIR ?? path.join(dataDir, 'pglite')),
    appSecret: overrides.appSecret ?? appSecret(),
    cookieSecure: bool(env.COOKIE_SECURE, isProd),
    corsOrigin: env.CORS_ORIGIN || undefined,
    allowSignup: bool(env.ALLOW_SIGNUP, !isProd),
    storageDir: path.resolve(env.STORAGE_DIR ?? path.join(dataDir, 'files')),
    fileMaxMb: num(env.FILE_MAX_MB, 25),
    staticDir: fs.existsSync(path.join(staticDir, 'index.html')) ? staticDir : undefined,
    jobsEnabled: bool(env.JOBS_ENABLED, true),
    jobIntervalMin: num(env.JOB_INTERVAL_MIN, 15),
    smtpUrl: env.SMTP_URL || undefined,
    mailFrom: env.MAIL_FROM ?? 'LedgerFlow <no-reply@localhost>',
    whatsapp: env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID ? { token: env.WHATSAPP_TOKEN, phoneId: env.WHATSAPP_PHONE_ID, verifyToken: env.WHATSAPP_VERIFY_TOKEN, appSecret: env.WHATSAPP_APP_SECRET, firmId: env.WHATSAPP_FIRM_ID } : undefined,
    gstApi: env.GST_API_URL ? { url: env.GST_API_URL.replace(/\/$/, ''), key: env.GST_API_KEY } : undefined,
    ...overrides,
  };
}
