import { buildApp } from './app';
import { loadConfig } from './config';
import { connect } from './connect';
import { startJobs } from './jobs';

const config = loadConfig();
const db = await connect(config);
const { fastify, app } = await buildApp(config, db);
if (!config.databaseUrl) app.log.warn(`DATABASE_URL not set — using embedded PGlite at ${config.pgliteDir} (development only).`);
const stopJobs = startJobs(app);
await fastify.listen({ port: config.port, host: config.host });
app.log.info(`LedgerFlow API on ${config.publicUrl}${config.staticDir ? ' (serving the web app)' : ''}`);

const shutdown = async () => {
  stopJobs();
  await fastify.close();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
