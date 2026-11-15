import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Role } from '@prisma/client';
import { operations } from '../src/app.js';
import type { Operation } from '../src/contract.js';
import { digest, id, token } from '../src/core/security.js';
import { app, db, reset } from './helpers.js';

type Permission = 'PUBLIC' | 'AUTH' | 'MEMBER' | 'OPERATOR' | 'ADMIN';
type Caller = 'anonymous' | Role;

/** The expected permission of every operation. Written by hand on purpose: adding an operation to the
 * contract without adding it here fails this test. */
const EXPECTED: Record<Operation, Permission> = {
  register: 'PUBLIC',
  verifyEmail: 'PUBLIC',
  resendCode: 'PUBLIC',
  login: 'PUBLIC',
  forgotPassword: 'PUBLIC',
  resetPassword: 'PUBLIC',
  listHostels: 'PUBLIC',
  logout: 'AUTH',
  getMe: 'AUTH',
  updateMe: 'AUTH',
  changePassword: 'AUTH',
  listUsers: 'ADMIN',
  createUser: 'ADMIN',
  updateUser: 'ADMIN',
  createHostel: 'ADMIN',
  updateHostel: 'ADMIN',
  lookupParcel: 'OPERATOR',
  intakeParcel: 'OPERATOR',
  listParcels: 'OPERATOR',
  getParcel: 'OPERATOR',
  assignParcel: 'OPERATOR',
  searchMembers: 'OPERATOR',
  listMyParcels: 'MEMBER',
  listMyRequests: 'MEMBER',
  createRequest: 'MEMBER',
  updateRequest: 'MEMBER',
  cancelRequest: 'MEMBER',
  collectNow: 'MEMBER',
  getMyCollection: 'MEMBER',
  cancelCollection: 'MEMBER',
  listCollections: 'OPERATOR',
  verifyCollection: 'OPERATOR',
  completeCollection: 'OPERATOR',
  getStats: 'ADMIN',
  listAging: 'ADMIN',
  remindParcel: 'ADMIN',
  returnParcel: 'ADMIN',
  registerDevice: 'MEMBER',
  listNotifications: 'MEMBER',
  markNotificationsRead: 'MEMBER',
};

/** Who may call each permission level, independent of src/core/rbac.ts. */
const ALLOWED: Record<Permission, Caller[]> = {
  PUBLIC: ['anonymous', 'MEMBER', 'OPERATOR', 'ADMIN'],
  AUTH: ['MEMBER', 'OPERATOR', 'ADMIN'],
  MEMBER: ['MEMBER'],
  OPERATOR: ['OPERATOR', 'ADMIN'],
  ADMIN: ['ADMIN'],
};

const users = {} as Record<Role, string>;
before(async () => {
  await reset();
  for (const role of ['MEMBER', 'OPERATOR', 'ADMIN'] as const)
    users[role] = (
      await db.user.create({
        data: { id: id('usr'), email: `${role}@college.example`, name: role, role, emailVerifiedAt: new Date() },
      })
    ).id;
});

/** A fresh session per call, so an operation like logout can't affect the next call. */
async function bearer(role: Role) {
  const value = token();
  await db.session.create({
    data: {
      id: id('ses'),
      tokenDigest: digest(value),
      userId: users[role],
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  return value;
}

test('every contract operation is in the expected table, with the same x-permission', () => {
  assert.deepEqual(operations.map(o => o.operationId).sort(), Object.keys(EXPECTED).sort());
  for (const o of operations) assert.equal(o['x-permission'], EXPECTED[o.operationId], o.operationId);
});

test('route × role matrix: 401 without a session, 403 without the permission, otherwise allowed', async () => {
  for (const o of operations)
    for (const caller of ['anonymous', 'MEMBER', 'OPERATOR', 'ADMIN'] as const) {
      const url = '/v1' + o.path.replaceAll(/\{\w+\}/g, 'x_missing');
      // An empty body fails validation, which runs after the permission check, so no handler with
      // side effects runs for operations that take a body.
      const response = await app.inject({
        method: o.method,
        url,
        headers: caller === 'anonymous' ? {} : { authorization: 'Bearer ' + (await bearer(caller)) },
        ...(o.requestBody ? { payload: {} } : {}),
      });
      const permission = EXPECTED[o.operationId];
      const expected = ALLOWED[permission].includes(caller) ? 'allowed' : caller === 'anonymous' ? 401 : 403;
      const label = `${o.method} ${o.path} as ${caller} (${permission}): ${response.statusCode} ${response.body}`;
      if (expected === 'allowed') assert.ok(![401, 403].includes(response.statusCode), label);
      else assert.equal(response.statusCode, expected, label);
    }
});
