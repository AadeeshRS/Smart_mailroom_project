import type { Handlers } from '../../contract.js';
import * as requests from './service.js';

export const handlers = {
  listMyRequests: requests.list,
  createRequest: requests.create,
  updateRequest: requests.update,
  cancelRequest: requests.cancel,
} satisfies Partial<Handlers>;
