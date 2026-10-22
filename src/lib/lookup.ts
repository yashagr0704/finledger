import { useMemo } from 'react';
import { useDb } from '@/store/store';

/** Memoised id → entity maps for rendering. */
export function useLookup() {
  const db = useDb();
  return useMemo(() => {
    const users = new Map(db.users.map((u) => [u.id, u]));
    const clients = new Map(db.clients.map((c) => [c.id, c]));
    const categories = new Map(db.categories.map((c) => [c.id, c]));
    const tasks = new Map(db.tasks.map((t) => [t.id, t]));
    return { users, clients, categories, tasks };
  }, [db]);
}
