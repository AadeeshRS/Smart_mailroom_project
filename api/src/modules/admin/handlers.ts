import type { Handlers } from '../../contract.js';
import * as admin from './service.js';

export const handlers = {
  getStats: admin.stats,
  listAging: admin.aging,
  remindParcel: admin.remind,
  returnParcel: admin.returnToSender,
} satisfies Partial<Handlers>;
