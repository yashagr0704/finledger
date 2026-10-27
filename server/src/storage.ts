import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

/** File storage. Local disk by default; an S3-compatible driver can implement the same interface. */
export interface Storage {
  kind: 'local' | 's3';
  put(key: string, data: Readable): Promise<number>;
  get(key: string): Readable;
  remove(key: string): Promise<void>;
}

export function localStorage(root: string): Storage {
  fs.mkdirSync(root, { recursive: true });
  const resolve = (key: string) => {
    const p = path.resolve(root, key);
    if (!p.startsWith(path.resolve(root) + path.sep)) throw new Error('Invalid storage key');
    return p;
  };
  return {
    kind: 'local',
    async put(key, data) {
      const p = resolve(key);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      await pipeline(data, fs.createWriteStream(p, { mode: 0o600 }));
      return fs.statSync(p).size;
    },
    get: (key) => fs.createReadStream(resolve(key)),
    async remove(key) {
      await fs.promises.rm(resolve(key), { force: true });
    },
  };
}
