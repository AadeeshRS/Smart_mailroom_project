import { createApp } from './app.js';
import { config } from './core/config.js';
import { database } from './core/db.js';
import { startWorker } from './jobs/worker.js';

const settings = config();
const db = database(settings.databaseUrl);
const app = await createApp(db, settings);
await app.listen({ host: process.env.HOST ?? '127.0.0.1', port: Number(process.env.PORT ?? 3000) });
const stopWorker = startWorker(db);

const close = async () => {
  stopWorker();
  await app.close();
  await db.$disconnect();
};
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
