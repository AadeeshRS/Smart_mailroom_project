import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/** No global lock: races are handled by conditional updates and unique indexes (plan §4.6). */
export const database = (url: string) =>
  new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 12 }) });

/** The column a unique constraint failed on, if `error` is one. */
export function uniqueViolation(error: unknown): string | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return undefined;
  const meta = error.meta as
    { target?: string[] | string; driverAdapterError?: { cause?: { constraint?: { fields?: string[] } } } } | undefined;
  const fields = meta?.driverAdapterError?.cause?.constraint?.fields ?? meta?.target;
  return (Array.isArray(fields) ? fields[0] : fields)?.replaceAll('"', '');
}
