import type { Handlers } from '../../contract.js';
import * as users from './service.js';

export const handlers = {
  getMe: (_input, ctx) => users.getMe(ctx),
  updateMe: users.updateMe,
  listUsers: users.listUsers,
  createUser: users.createUser,
  updateUser: users.updateUser,
} satisfies Partial<Handlers>;
