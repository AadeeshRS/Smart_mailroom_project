import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/** No global lock: races are handled by conditional updates and unique indexes (plan §4.6). */
export const database = (url: string) =>
  new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 12 }) });

/** The column a single-column unique constraint failed on, if `error` is one. With the pg adapter Prisma
 * reports the index name (`User_phone_key`); other engines report the fields. */
export function uniqueViolation(error: unknown): string | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return undefined;
  const meta = error.meta as
    | { target?: string[]; driverAdapterError?: { cause?: { constraint?: { fields?: string[]; index?: string } } } }
    | undefined;
  const constraint = meta?.driverAdapterError?.cause?.constraint;
  if (constraint?.index?.endsWith('_pkey')) return 'id';
  return constraint?.fields?.[0] ?? /^[A-Za-z]+_(\w+)_key$/.exec(constraint?.index ?? '')?.[1] ?? meta?.target?.[0];
}
