import { loadConfig } from './config';
import { connect } from './connect';
import { makeCipher } from './crypto';
import { Events } from './events';
import { FirmStore } from './firmStore';
import { hashPassword, newFirmDatabase, seedDemoFirm, validatePassword } from './newFirm';

/**
 * Admin tasks:
 *   migrate                                   apply database migrations
 *   seed-demo [--password <pw>] [--reset]     load the demo firm
 *   create-firm --name <firm> --admin-name <name> --email <email> --password <pw>
 */
const [cmd, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};

const config = loadConfig();
const db = await connect(config);
const firms = new FirmStore(db, makeCipher(config.appSecret), new Events(db));

try {
  if (cmd === 'migrate') {
    console.log('Migrations applied.');
  } else if (cmd === 'seed-demo') {
    const password = flag('password') ?? process.env.DEMO_PASSWORD ?? 'demo1234';
    const exists = await db.query('SELECT 1 FROM firms WHERE id = $1', ['firm_demo']);
    if (exists.rows.length && !rest.includes('--reset')) {
      console.log('Demo firm already exists. Use --reset to recreate it.');
    } else {
      if (exists.rows.length) await db.query('DELETE FROM firms WHERE id = $1', ['firm_demo']);
      const { users } = await seedDemoFirm(firms, password);
      console.log(`Demo firm created. Password for all demo users: ${password}`);
      for (const u of users) console.log(`  ${u.role.padEnd(8)} ${u.email}  (${u.name})`);
    }
  } else if (cmd === 'create-firm') {
    const name = flag('name');
    const adminName = flag('admin-name');
    const email = flag('email');
    const password = flag('password');
    const err = validatePassword(password);
    if (!name || !adminName || !email || err) throw new Error(err ?? 'Usage: create-firm --name <firm> --admin-name <name> --email <email> --password <pw>');
    const { db: data, firmId, adminId } = newFirmDatabase(name, { name: adminName, email });
    await firms.create(data, firmId, { [adminId]: await hashPassword(password!) });
    console.log(`Firm “${name}” created (${firmId}). Admin: ${email}`);
  } else {
    console.log('Commands: migrate | seed-demo [--password pw] [--reset] | create-firm --name --admin-name --email --password');
    process.exitCode = 1;
  }
} finally {
  await db.close();
}
