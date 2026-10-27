import crypto from 'node:crypto';

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export const newId = (prefix: string) => `${prefix}_${crypto.randomBytes(9).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '').padEnd(10, '0')}`;

/** AES-256-GCM for secrets stored inside records (client portal passwords). */
export function makeCipher(secret: string) {
  const key = crypto.createHash('sha256').update(`ledgerflow:${secret}`).digest();
  return {
    encrypt(plain: string) {
      if (!plain || plain.startsWith('enc:v1:')) return plain;
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
      return `enc:v1:${Buffer.concat([iv, c.getAuthTag(), body]).toString('base64url')}`;
    },
    decrypt(value: string) {
      if (!value?.startsWith('enc:v1:')) return value;
      const raw = Buffer.from(value.slice(7), 'base64url');
      const d = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
      d.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
    },
  };
}
export type Cipher = ReturnType<typeof makeCipher>;
