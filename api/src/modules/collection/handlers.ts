import type { Handlers } from '../../contract.js';
import * as collection from './service.js';

export const handlers = {
  getMyCollection: collection.current,
  collectNow: collection.collectNow,
  cancelCollection: collection.cancel,
  listCollections: collection.list,
  verifyCollection: collection.verify,
  completeCollection: collection.complete,
} satisfies Partial<Handlers>;
