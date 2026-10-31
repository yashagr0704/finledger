import { runScheduledJobs, type JobReport } from '@/domain/jobs';
import type { App } from './app';

/** Runs scheduled work for every firm once. Safe to call concurrently on several instances. */
export async function runJobsOnce(app: App): Promise<Record<string, JobReport>> {
  const run = async () => {
    const { rows } = await app.db.query<{ id: string }>('SELECT id FROM firms WHERE suspended_at IS NULL ORDER BY id');
    const out: Record<string, JobReport> = {};
    for (const { id } of rows) {
      try {
        const r = await app.firms.mutate(id, (db) => {
          const j = runScheduledJobs(db);
          return { db: j.db, result: j.report };
        });
        out[id] = r.result;
      } catch (e) {
        app.log.error({ err: e, firmId: id }, 'scheduled job failed');
      }
    }
    return out;
  };
  if (app.db.kind !== 'postgres') return run();
  // One instance at a time: hold a transaction-scoped advisory lock while the jobs run.
  return app.db.tx(async (q) => {
    const { rows } = await q.query<{ ok: boolean }>("SELECT pg_try_advisory_xact_lock(hashtext('ledgerflow_jobs')) AS ok");
    return rows[0]?.ok ? run() : {};
  });
}

export function startJobs(app: App) {
  if (!app.config.jobsEnabled) return () => {};
  const tick = () => runJobsOnce(app).catch((e) => app.log.error({ err: e }, 'job runner failed'));
  const first = setTimeout(tick, 5000);
  const every = setInterval(tick, app.config.jobIntervalMin * 60000);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
