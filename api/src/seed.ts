import { pathToFileURL } from 'node:url';
import type { PrismaClient } from '@prisma/client';
import { config, dedicatedDataset } from './config.js';
import { database, transaction, type Tx } from './db.js';
import { id, passwordHash } from './security.js';
export async function seed(db: PrismaClient, url: string, passcode: string) {
  dedicatedDataset(url); if (passcode.length < 12 || passcode.includes('CHANGE_ME')) throw new Error('Provide a synthetic DEMO_PASSCODE of at least 12 characters.');
  return transaction(db, async tx => {
    const accounts = [
      { name: 'Asha Rao', email: 'asha@students.example.invalid', studentNumber: 'DEMO1001', role: 'STUDENT' },
      { name: 'Neel Shah', email: 'neel@students.example.invalid', studentNumber: 'DEMO1002', role: 'STUDENT' },
      { name: 'Mira Sen', email: 'mira@staff.example.invalid', studentNumber: null, role: 'STAFF' },
    ];
    const result = [];
    for (const account of accounts) result.push(await tx.user.upsert({ where: { email: account.email }, create: { ...account, id: id('usr'), passwordHash: await passwordHash(passcode) }, update: {} }));
    return result.map(({ id, name, role }) => ({ id, name, role }));
  });
}
export async function reset(tx: Tx, url: string) {
  dedicatedDataset(url);
  if (await tx.user.count({ where: { synthetic: false } })) throw new Error('Reset refused: non-synthetic users exist.');
  await tx.$executeRaw`SELECT set_config('mailroom.reset', 'enabled', true)`;
  // Explicit project table deletes; retain provisioned identities and hashes.
  await tx.idempotency.deleteMany(); await tx.auditEvent.deleteMany(); await tx.decision.deleteMany();
  await tx.deliveryResult.deleteMany(); await tx.deliveryAttempt.deleteMany(); await tx.notification.deleteMany(); await tx.handover.deleteMany();
  await tx.verification.deleteMany(); await tx.credential.deleteMany(); await tx.parcelIdentifier.deleteMany();
  await tx.parcel.deleteMany(); await tx.orderReference.deleteMany(); await tx.expectedOrder.deleteMany();
  await tx.snapshot.deleteMany(); await tx.session.deleteMany(); await tx.rateWindow.deleteMany();
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const c = config(); if (!c.demo) throw new Error('Seed requires explicitly enabled development/test demo mode.');
  const db = database(c.databaseUrl);
  try { console.log(JSON.stringify(await seed(db, c.databaseUrl, process.env.DEMO_PASSCODE ?? ''), null, 2)); } finally { await db.$disconnect(); }
}
