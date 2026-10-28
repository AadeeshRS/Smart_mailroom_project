import { spawnSync } from 'node:child_process';
import { config, dedicatedDataset } from '../src/config.js';
import { database } from '../src/db.js';
import { seed } from '../src/seed.js';
const c = config(); dedicatedDataset(c.databaseUrl);
if (new URL(c.databaseUrl).pathname !== '/smart_mailroom_test') throw Error('HTTP browser export uses seeded test account IDs.');
const db = database(c.databaseUrl);
try {
  await seed(db, c.databaseUrl, process.env.DEMO_PASSCODE!);
  const users = await db.user.findMany();
  const result = spawnSync(process.execPath, ['node_modules/expo/bin/cli', 'export', '--clear', '--platform', 'web', '--max-workers', '2', '--output-dir', 'dist-http'], { cwd: '../mobile', env: { ...process.env, NODE_ENV: 'production', EXPO_PUBLIC_API_MODE: 'http', EXPO_PUBLIC_API_BASE_URL: 'http://127.0.0.1:3100/v1', EXPO_PUBLIC_ASHA_ACCOUNT_ID: users.find(u => u.studentNumber === 'DEMO1001')!.id, EXPO_PUBLIC_NEEL_ACCOUNT_ID: users.find(u => u.studentNumber === 'DEMO1002')!.id, EXPO_PUBLIC_STAFF_ACCOUNT_ID: users.find(u => u.role === 'STAFF')!.id }, stdio: 'inherit', windowsHide: true });
  process.exitCode = result.status ?? 1;
} finally { await db.$disconnect(); }
