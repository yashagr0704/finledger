import fs from 'node:fs';
import type { Config } from './config';
import { connectPglite, connectPostgres, type Db } from './db';
import { migrate } from './migrations';

export async function connect(config: Config): Promise<Db> {
  let db: Db;
  if (config.databaseUrl) db = await connectPostgres(config.databaseUrl);
  else {
    fs.mkdirSync(config.pgliteDir, { recursive: true });
    db = await connectPglite(config.pgliteDir);
  }
  await migrate(db);
  return db;
}
