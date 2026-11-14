import { spawnSync } from 'node:child_process';
import { config, dedicatedDataset } from '../src/core/config.js';
import { database } from '../src/core/db.js';
import { seed } from '../src/seed.js';

// Seeds the test database and builds the web export that the HTTP browser suite serves.
const settings = config();
dedicatedDataset(settings.databaseUrl);
if (new URL(settings.databaseUrl).pathname !== '/smart_mailroom_test')
  throw Error('The HTTP browser export uses the isolated test database.');
const db = database(settings.databaseUrl);
try {
  await seed(db, settings.databaseUrl, process.env.SEED_PASSWORD ?? '');
  const result = spawnSync(
    process.execPath,
    [
      'node_modules/expo/bin/cli',
      'export',
      '--clear',
      '--platform',
      'web',
      '--max-workers',
      '2',
      '--output-dir',
      'dist-http',
    ],
    {
      cwd: '../mobile',
      env: { ...process.env, NODE_ENV: 'production', EXPO_PUBLIC_API_BASE_URL: 'http://127.0.0.1:3100/v1' },
      stdio: 'inherit',
      windowsHide: true,
    },
  );
  process.exitCode = result.status ?? 1;
} finally {
  await db.$disconnect();
}
