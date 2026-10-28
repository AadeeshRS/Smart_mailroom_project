import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
export const database = (url: string) => new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 12 }) });
export type Tx = Prisma.TransactionClient;
/** One database-wide domain mutex, intentionally simple for a college mailroom.
 * READ COMMITTED + advisory transaction lock makes all API state transitions
 * sequential across processes while constraints remain the final backstop.
 * Reads also take this lock so authentication/projections see committed state.
 */
export async function transaction<T>(db: PrismaClient, action: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(732119, 2026)`;
        return action(tx);
      }, { isolationLevel: 'ReadCommitted', maxWait: 15_000, timeout: 30_000 });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !['P2034'].includes(error.code) || attempt >= 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
}
