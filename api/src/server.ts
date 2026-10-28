import { database } from './db.js';
import { config } from './config.js';
import { createApp } from './app.js';
import { processOutbox } from './outbox.js';
const settings = config(), db = database(settings.databaseUrl);
const { app, backend } = await createApp(db, settings);
await app.listen({ host: process.env.HOST ?? '127.0.0.1', port: Number(process.env.PORT ?? 3000) });
console.log(`Smart Mailroom API listening; demo operations ${settings.demo ? 'enabled' : 'disabled'}; simulated delivery only.`);
let processing = false;
const worker = setInterval(async () => {
  if (processing) return; processing = true;
  backend.credentials.expire(new Date());
  try { await processOutbox(db); } catch { console.error('Outbox processing deferred; pending work remains durable.'); } finally { processing = false; }
}, 1000); worker.unref();
const close = async () => { clearInterval(worker); await app.close(); await db.$disconnect(); };
process.on('SIGINT', () => { void close(); }); process.on('SIGTERM', () => { void close(); });
