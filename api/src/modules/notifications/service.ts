import type { Prisma } from '@prisma/client';
import { id } from '../../core/security.js';

/** Queue an in-app notification (and its push, sent later by the worker) in the same transaction as the
 * change that caused it, so a rolled-back change never notifies anyone. */
export const queue = (
  tx: Prisma.TransactionClient,
  notice: { userId: string; type: string; title: string; body: string; parcelId?: string },
) => tx.notification.create({ data: { id: id('ntf'), ...notice } });
