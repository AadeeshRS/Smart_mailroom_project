import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import type { PrismaClient } from '@prisma/client';
import { database } from '../core/db.js';
import { id } from '../core/security.js';
import { normalEmail } from '../modules/auth/service.js';

/** Bootstrap the first admin. Production-safe: no demo or environment gate. Sends nothing: the admin sets a
 * password through "Forgot password" in the app. Refuses to touch an existing non-admin. */
export async function createAdmin(db: PrismaClient, rawEmail: string, name: string) {
  const email = normalEmail(rawEmail);
  if (!/^[^\s@]+@[^\s@]+$/.test(email) || !name.trim()) throw new Error('Usage: create-admin [--neon] <email> <name>');
  const existing = await db.user.findUnique({ where: { email } });
  if (existing && existing.role !== 'ADMIN')
    throw new Error(`${email} already exists as ${existing.role}; refusing to change it. Use the admin screen.`);
  return existing ?? (await db.user.create({ data: { id: id('usr'), email, name: name.trim(), role: 'ADMIN' } }));
}

/** DATABASE_URL from `file` alone (never `.env` or the environment), and only for a neon.tech host. The URL is
 * never printed. */
export function neonUrl(file = '.env.neon') {
  const url = parseEnv(readFileSync(file, 'utf8')).DATABASE_URL ?? '';
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    // reported below, without echoing the value
  }
  if (!host.endsWith('.neon.tech')) throw new Error(`Refusing: DATABASE_URL in ${file} is not a neon.tech host.`);
  return url;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const neon = args[0] === '--neon';
  const [email = '', ...name] = neon ? args.slice(1) : args;
  const db = database(neon ? neonUrl() : (process.env.DATABASE_URL ?? ''));
  try {
    const user = await createAdmin(db, email, name.join(' '));
    console.log(
      `Admin ${user.email} is ready${neon ? ' on Neon' : ''}. In the app, tap Forgot password with this email to set a ` +
        'password (on a staging server the code appears in its logs).',
    );
  } finally {
    await db.$disconnect();
  }
}
