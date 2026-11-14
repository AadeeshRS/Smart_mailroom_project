import { pathToFileURL } from 'node:url';
import type { PrismaClient } from '@prisma/client';
import type { Ctx } from '../contract.js';
import { config, type Config } from '../core/config.js';
import { database } from '../core/db.js';
import { id } from '../core/security.js';
import { normalEmail, sendCode } from '../modules/auth/service.js';
import { mailer, type Mailer } from '../modules/notifications/email.js';

/** Bootstrap the first admin. Production-safe: no demo or environment gate. The admin gets an emailed
 * code and sets their password through "Forgot password". Refuses to touch an existing non-admin. */
export async function createAdmin(db: PrismaClient, settings: Config, mail: Mailer, rawEmail: string, name: string) {
  const email = normalEmail(rawEmail);
  if (!/^[^\s@]+@[^\s@]+$/.test(email) || !name.trim()) throw new Error('Usage: create-admin <email> <name>');
  const existing = await db.user.findUnique({ where: { email } });
  if (existing && existing.role !== 'ADMIN')
    throw new Error(`${email} already exists as ${existing.role}; refusing to change it. Use the admin screen.`);
  const user = existing ?? (await db.user.create({ data: { id: id('usr'), email, name: name.trim(), role: 'ADMIN' } }));
  const ctx: Ctx = { db, config: settings, mailer: mail, now: new Date(), ip: 'create-admin' };
  await sendCode(ctx, user, 'RESET');
  return user;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const settings = config();
  const db = database(settings.databaseUrl);
  try {
    const [email = '', ...name] = process.argv.slice(2);
    const user = await createAdmin(db, settings, mailer(settings), email, name.join(' '));
    console.log(`Admin ${user.email} is ready. A code to set the password was emailed.`);
  } finally {
    await db.$disconnect();
  }
}
