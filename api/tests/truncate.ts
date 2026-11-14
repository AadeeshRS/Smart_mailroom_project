import type { PrismaClient } from '@prisma/client';

/** Empty every table. TRUNCATE skips the append-only audit trigger, which only guards rows. */
export async function truncateAll(db: PrismaClient) {
  const tables = await db.$queryRaw<{ name: string }[]>`
    SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map(t => `"${t.name}"`).join(', ')} CASCADE`);
}
