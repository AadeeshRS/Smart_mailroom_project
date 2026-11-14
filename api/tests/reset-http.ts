import { config, dedicatedDataset } from '../src/core/config.js';
import { database } from '../src/core/db.js';
import { truncateAll } from './truncate.js';

// The HTTP browser suite starts from an empty test database, so one run's parcels and login limits don't
// leak into the next.
const settings = config();
dedicatedDataset(settings.databaseUrl);
if (new URL(settings.databaseUrl).pathname !== '/smart_mailroom_test')
  throw Error('Only the isolated test database is reset.');
const db = database(settings.databaseUrl);
try {
  await truncateAll(db);
} finally {
  await db.$disconnect();
}
