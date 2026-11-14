import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createAdmin } from '../src/scripts/create-admin.js';
import { PASSWORD, call, codeFor, db, fails, mail, mailer, ok, reset, settings, signIn } from './helpers.js';

beforeEach(reset);

async function hostel(name: string, token: string) {
  return ok('createHostel', { name }, token);
}

test('PATCH /me edits only the whitelisted fields, normalised; email and name are rejected', async () => {
  const admin = await signIn('ADMIN');
  const { id: hostelId } = await hostel('Ganga', admin.token);
  const { user, token } = await signIn('MEMBER');
  const me = await ok(
    'updateMe',
    {
      memberType: 'STAFF',
      idNumber: ' emp-77 ',
      phone: '09876543210',
      altPhone: '9123456789',
      personalEmail: 'Asha@Gmail.com',
      hostelId,
      roomNumber: ' B-214 ',
    },
    token,
  );
  assert.deepEqual(
    [me.memberType, me.idNumber, me.phone, me.altPhone, me.personalEmail, me.hostelName, me.roomNumber],
    ['STAFF', 'EMP-77', '+919876543210', '+919123456789', 'asha@gmail.com', 'Ganga', 'B-214'],
  );
  const cleared = await ok('updateMe', { altPhone: null, hostelId: null, roomNumber: null }, token);
  assert.deepEqual([cleared.altPhone, cleared.hostelName, cleared.roomNumber], [null, null, null]);
  for (const forbidden of [{ email: 'other@college.example' }, { name: 'Someone Else' }, {}])
    await fails('updateMe', forbidden as never, 'VALIDATION', token);
  const stored = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.deepEqual([stored.email, stored.name], [user.email, user.name]);
});

test('phone and ID numbers are unique across accounts, with clear errors', async () => {
  await signIn('MEMBER', { phone: '+919876543210' });
  const other = await db.user.findFirstOrThrow();
  await db.user.update({ where: { id: other.id }, data: { idNumber: '23CS1001' } });
  const { token } = await signIn('MEMBER');
  await fails('updateMe', { phone: '98765 43210' }, 'PHONE_TAKEN', token);
  await fails('updateMe', { idNumber: '23cs1001' }, 'ID_NUMBER_TAKEN', token);
  await fails('updateMe', { phone: '12' }, 'VALIDATION', token);
});

test('an inactive hostel can no longer be picked', async () => {
  const admin = await signIn('ADMIN');
  const { id } = await hostel('Yamuna', admin.token);
  await ok('updateHostel', { hostelId: id, active: false }, admin.token);
  const { token } = await signIn('MEMBER');
  await fails('updateMe', { hostelId: id }, 'VALIDATION', token);
  assert.deepEqual((await ok('listHostels', {})).items, [{ id, name: 'Yamuna', active: false }]);
});

test('hostels: names are unique; rename and missing hostels', async () => {
  const { token } = await signIn('ADMIN');
  const a = await hostel('Ganga', token);
  await hostel('Kaveri', token);
  await fails('createHostel', { name: ' Ganga ' }, 'NAME_TAKEN', token);
  await fails('updateHostel', { hostelId: a.id, name: 'Kaveri' }, 'NAME_TAKEN', token);
  await fails('updateHostel', { hostelId: 'hst_missing', active: true }, 'NOT_FOUND', token);
  await ok('updateHostel', { hostelId: a.id, name: 'Ganga North' }, token);
  assert.deepEqual(
    (await ok('listHostels', {})).items.map(h => h.name),
    ['Ganga North', 'Kaveri'],
  );
});

test('admin invites an operator, who sets a password with the emailed code and signs in', async () => {
  const admin = await signIn('ADMIN');
  const created = await ok(
    'createUser',
    { email: 'Guard@College.Example', name: 'Gate Guard', role: 'OPERATOR' },
    admin.token,
  );
  assert.deepEqual([created.email, created.role, created.emailVerified], ['guard@college.example', 'OPERATOR', false]);
  await fails(
    'createUser',
    { email: 'guard@college.example', name: 'Again', role: 'ADMIN' },
    'EMAIL_TAKEN',
    admin.token,
  );
  await fails('login', { email: 'guard@college.example', password: PASSWORD }, 'UNAUTHENTICATED');
  await ok('resetPassword', {
    email: 'guard@college.example',
    code: codeFor('guard@college.example'),
    password: PASSWORD,
  });
  const session = await ok('login', { email: 'guard@college.example', password: PASSWORD });
  assert.deepEqual([session.user.role, session.user.emailVerified], ['OPERATOR', true]);
  const audit = await db.auditEvent.findFirstOrThrow({ where: { action: 'USER_CREATED' } });
  assert.equal(audit.actorId, admin.user.id);
});

test('admin user list: search by name, email, ID or phone; filter by role; keyset pages', async () => {
  const admin = await signIn('ADMIN');
  for (const name of ['Asha', 'Bala', 'Chitra', 'Dev', 'Esha']) {
    const { user } = await signIn('MEMBER');
    await db.user.update({ where: { id: user.id }, data: { name, idNumber: `ID-${name}` } });
  }
  await db.user.updateMany({ where: { name: 'Dev' }, data: { phone: '+919876543210' } });
  const names = async (input: Parameters<typeof ok<'listUsers'>>[1]) =>
    (await ok('listUsers', input, admin.token)).items.map(u => u.name);
  assert.deepEqual(await names({ q: 'sha' }), ['Asha', 'Esha']);
  assert.deepEqual(await names({ q: 'id-chitra' }), ['Chitra']);
  assert.deepEqual(await names({ q: '98765 43210' }), ['Dev']);
  assert.deepEqual(await names({ role: 'ADMIN' }), [admin.user.name]);
  const first = await ok('listUsers', { role: 'MEMBER', limit: 2 }, admin.token);
  const second = await ok('listUsers', { role: 'MEMBER', limit: 2, cursor: first.nextCursor }, admin.token);
  const third = await ok('listUsers', { role: 'MEMBER', limit: 2, cursor: second.nextCursor }, admin.token);
  assert.deepEqual(
    [...first.items, ...second.items, ...third.items].map(u => u.name),
    ['Asha', 'Bala', 'Chitra', 'Dev', 'Esha'],
  );
  assert.equal(third.nextCursor, undefined);
});

test('role changes and deactivation; deactivating revokes sessions', async () => {
  const admin = await signIn('ADMIN');
  const member = await signIn('MEMBER');
  const promoted = await ok('updateUser', { userId: member.user.id, role: 'OPERATOR' }, admin.token);
  assert.equal(promoted.role, 'OPERATOR');
  await ok('listHostels', {}); // the member's token keeps working with the new role
  assert.equal((await ok('getMe', {}, member.token)).role, 'OPERATOR');
  await ok('updateUser', { userId: member.user.id, active: false }, admin.token);
  await fails('getMe', {}, 'UNAUTHENTICATED', member.token);
  await fails('updateUser', { userId: 'usr_missing', active: true }, 'NOT_FOUND', admin.token);
});

test("an admin can't change themselves, and the last admin can't be removed, even in a race", async () => {
  const a = await signIn('ADMIN');
  await fails('updateUser', { userId: a.user.id, role: 'MEMBER' }, 'SELF_CHANGE', a.token);
  await fails('updateUser', { userId: a.user.id, active: false }, 'SELF_CHANGE', a.token);
  const b = await signIn('ADMIN');
  const results = await Promise.all([
    call('updateUser', { userId: b.user.id, role: 'OPERATOR' }, a.token),
    call('updateUser', { userId: a.user.id, active: false }, b.token),
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(await db.user.count({ where: { role: 'ADMIN', active: true } }), 1);
});

test('create-admin bootstraps an admin and refuses to change an existing non-admin', async () => {
  const user = await createAdmin(db, settings, mailer, 'First.Admin@College.Example', 'First Admin');
  assert.equal(user.role, 'ADMIN');
  await ok('resetPassword', {
    email: 'first.admin@college.example',
    code: codeFor('first.admin@college.example'),
    password: PASSWORD,
  });
  await ok('login', { email: 'first.admin@college.example', password: PASSWORD });
  const member = await signIn('MEMBER');
  await assert.rejects(createAdmin(db, settings, mailer, member.user.email, 'X'), /refusing/);
  assert.equal(mail.length, 1);
});
