import { pathToFileURL } from 'node:url';
import type { PrismaClient, Role } from '@prisma/client';
import { config, dedicatedDataset } from './core/config.js';
import { database } from './core/db.js';
import { id, passwordHash } from './core/security.js';

/** Development fixtures: one verified account per role, on the reserved `.example` domain. */
export const SEED_ACCOUNTS: { email: string; name: string; role: Role }[] = [
  { email: 'member@college.example', name: 'Test Member', role: 'MEMBER' },
  { email: 'operator@college.example', name: 'Test Operator', role: 'OPERATOR' },
  { email: 'admin@college.example', name: 'Test Admin', role: 'ADMIN' },
];

export async function seed(db: PrismaClient, url: string, password: string) {
  dedicatedDataset(url);
  if (password.length < 8) throw new Error('Set SEED_PASSWORD (at least 8 characters).');
  const hash = await passwordHash(password);
  for (const account of SEED_ACCOUNTS)
    await db.user.upsert({
      where: { email: account.email },
      create: {
        ...account,
        id: id('usr'),
        passwordHash: hash,
        emailVerifiedAt: new Date(),
        ...(account.role === 'MEMBER' ? { memberType: 'STUDENT', idNumber: 'TEST0001' } : {}),
      },
      update: { passwordHash: hash, role: account.role, active: true },
    });
  return SEED_ACCOUNTS.map(account => account.email);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const settings = config();
  if (!['development', 'test'].includes(settings.environment)) throw new Error('Seed is for development only.');
  const db = database(settings.databaseUrl);
  try {
    console.log('Seeded:', (await seed(db, settings.databaseUrl, process.env.SEED_PASSWORD ?? '')).join(', '));
  } finally {
    await db.$disconnect();
  }
}
