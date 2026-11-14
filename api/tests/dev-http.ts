import { spawn } from 'node:child_process';
import { config, dedicatedDataset } from '../src/core/config.js';
import { database } from '../src/core/db.js';
import { seed } from '../src/seed.js';

// Development rendering catches React Native warnings stripped from web exports.
const settings = config();
dedicatedDataset(settings.databaseUrl);
if (new URL(settings.databaseUrl).pathname !== '/smart_mailroom_test')
  throw Error('Development browser tests require the isolated test database.');
const db = database(settings.databaseUrl);
await seed(db, settings.databaseUrl, process.env.SEED_PASSWORD ?? '');
await db.$disconnect();
const child = spawn(
  process.execPath,
  ['node_modules/expo/bin/cli', 'start', '--localhost', '--port', '8083', '--clear', '--max-workers', '2'],
  {
    cwd: '../mobile',
    windowsHide: true,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'development',
      BABEL_ENV: 'development',
      CI: '1',
      EXPO_NO_TYPESCRIPT_SETUP: '1',
      EXPO_PUBLIC_API_BASE_URL: 'http://127.0.0.1:3100/v1',
    },
  },
);
child.on('exit', code => {
  process.exitCode = code ?? 1;
});
process.on('SIGINT', () => child.kill());
process.on('SIGTERM', () => child.kill());
process.on('exit', () => child.kill());
