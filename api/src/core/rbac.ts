import type { Role } from '@prisma/client';

export type Permission = 'PUBLIC' | 'AUTH' | 'MEMBER' | 'OPERATOR' | 'ADMIN';

/** The one place roles are defined. The router checks every operation's x-permission against this. */
export const PERMISSIONS: Record<Role, readonly Permission[]> = {
  MEMBER: ['AUTH', 'MEMBER'],
  OPERATOR: ['AUTH', 'OPERATOR'],
  ADMIN: ['AUTH', 'OPERATOR', 'ADMIN'],
};

export const allowed = (role: Role, permission: Permission) =>
  permission === 'PUBLIC' || PERMISSIONS[role].includes(permission);
