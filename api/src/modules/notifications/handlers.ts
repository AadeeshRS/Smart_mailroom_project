import type { Handlers } from '../../contract.js';
import * as notifications from './service.js';

export const handlers = {
  registerDevice: notifications.registerDevice,
  listNotifications: notifications.list,
  markNotificationsRead: notifications.markRead,
} satisfies Partial<Handlers>;
