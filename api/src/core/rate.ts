import type { PrismaClient } from '@prisma/client';
import { fail } from './errors.js';

/** Fixed-window counter in the database, so limits hold across restarts and instances.
 * One atomic upsert: concurrent requests can't both slip under the limit. */
export async function rate(db: PrismaClient, key: string, maximum: number, now: Date, periodMs: number) {
  const until = new Date(+now + periodMs);
  const [row] = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateWindow" ("key", "count", "expiresAt") VALUES (${key}, 1, ${until})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateWindow"."expiresAt" <= ${now} THEN 1 ELSE "RateWindow"."count" + 1 END,
      "expiresAt" = CASE WHEN "RateWindow"."expiresAt" <= ${now} THEN ${until} ELSE "RateWindow"."expiresAt" END
    RETURNING "count"`;
  return row.count <= maximum;
}

/** `rate` that fails with RATE_LIMITED. */
export async function limit(db: PrismaClient, key: string, maximum: number, now: Date, periodMs: number) {
  if (!(await rate(db, key, maximum, now, periodMs))) fail('RATE_LIMITED', 'Too many attempts. Try again later.');
}
