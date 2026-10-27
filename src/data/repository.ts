import { brand } from '@/config/brand';
import type { Database } from '@/types';
import { createSeed, DB_VERSION } from './seed';

/**
 * Data access boundary. The demo persists to localStorage; a real backend can
 * implement the same interface (or replace the store actions with API calls)
 * without touching UI components.
 */
export interface DataRepository {
  load(): Database;
  save(db: Database): void;
  reset(): Database;
}

const SESSION_KEY = `${brand.storageKey}.session`;

/** Portal passwords never go to browser storage; in the demo they live in memory for the tab's lifetime. */
function withoutPasswords(db: Database): Database {
  return {
    ...db,
    clients: db.clients.map((c) =>
      c.portalLogins?.length ? { ...c, portalLogins: c.portalLogins.map((l) => ({ ...l, password: '', hasPassword: !!(l.password || l.hasPassword) })) } : c,
    ),
  };
}

export const localRepository: DataRepository = {
  load() {
    try {
      const raw = localStorage.getItem(brand.storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Database;
        if (parsed.version === DB_VERSION) return parsed;
      }
    } catch {
      // Corrupt or unavailable storage — fall back to a fresh seed.
    }
    const seeded = createSeed();
    this.save(seeded);
    return seeded;
  },
  save(db) {
    try {
      localStorage.setItem(brand.storageKey, JSON.stringify(withoutPasswords(db)));
    } catch {
      // Storage full or blocked; the session keeps working in memory.
    }
  },
  reset() {
    const seeded = createSeed();
    this.save(seeded);
    return seeded;
  },
};

export const sessionStore = {
  getUserId(): string | null {
    try {
      return localStorage.getItem(SESSION_KEY);
    } catch {
      return null;
    }
  },
  setUserId(id: string) {
    try {
      localStorage.setItem(SESSION_KEY, id);
    } catch {
      /* ignore */
    }
  },
};
