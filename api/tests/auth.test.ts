import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Input } from '../src/contract.js';
import { PASSWORD, call, clock, codeFor, db, fails, mail, ok, reset, signIn } from './helpers.js';

beforeEach(reset);

const DAY = 86_400_000;
const form = (email: string, extra: Partial<Input<'register'>> = {}): Input<'register'> => ({
  email,
  password: PASSWORD,
  name: 'Asha Rao',
  memberType: 'STUDENT',
  idNumber: '23cs1001',
  phone: '98765 43210',
  ...extra,
});

test('register → verify → login, with normalised profile fields', async () => {
  const reply = await call('register', form('Asha.Rao@College.Example', { altPhone: '+91 91234 56789' }));
  assert.equal(reply.status, 202);
  await fails('login', { email: 'asha.rao@college.example', password: PASSWORD }, 'EMAIL_NOT_VERIFIED');
  const session = await ok('verifyEmail', {
    email: 'asha.rao@college.example',
    code: codeFor('asha.rao@college.example'),
  });
  assert.equal(session.user.email, 'asha.rao@college.example');
  assert.equal(session.user.emailVerified, true);
  assert.equal(session.user.phone, '+919876543210');
  assert.equal(session.user.altPhone, '+919123456789');
  assert.equal(session.user.idNumber, '23CS1001');
  assert.equal(session.user.role, 'MEMBER');
  assert.equal((await ok('getMe', {}, session.token)).id, session.user.id);
  await ok('login', { email: 'ASHA.RAO@college.example', password: PASSWORD });
});

test('only college domains can register; bad phone numbers are rejected', async () => {
  await fails('register', form('asha@gmail.com'), 'EMAIL_DOMAIN_NOT_ALLOWED');
  await fails('register', form('asha@college.example', { phone: '98XXXXXX10' }), 'VALIDATION');
  await fails('register', form('asha@college.example', { hostelId: 'hst_missing' }), 'VALIDATION');
  assert.equal(await db.user.count(), 0);
});

test('five wrong codes lock the code, even when guessed in parallel; a new code works', async () => {
  const email = 'asha@college.example';
  await ok('register', form(email));
  const right = codeFor(email);
  const wrong = right === '000000' ? '111111' : '000000';
  const guesses = await Promise.all(Array.from({ length: 8 }, () => call('verifyEmail', { email, code: wrong })));
  assert.ok(guesses.every(g => g.status === 400));
  await fails('verifyEmail', { email, code: right }, 'CODE_INVALID');
  await ok('resendCode', { email });
  await ok('verifyEmail', { email, code: codeFor(email) });
});

test('codes expire after 10 minutes, and only the latest code works', async () => {
  const email = 'asha@college.example';
  await ok('register', form(email));
  const first = codeFor(email);
  clock.now += 10 * 60_000 + 1;
  await fails('verifyEmail', { email, code: first }, 'CODE_INVALID');
  await ok('resendCode', { email });
  const second = codeFor(email);
  await ok('resendCode', { email });
  const third = codeFor(email);
  if (second !== third) await fails('verifyEmail', { email, code: second }, 'CODE_INVALID');
  await ok('verifyEmail', { email, code: third });
  await fails('verifyEmail', { email, code: third }, 'CODE_INVALID');
});

test('no account enumeration: same answers for known and unknown emails', async () => {
  const { user } = await signIn('MEMBER', { email: 'known@college.example' });
  const unknown = await call('login', { email: 'nobody@college.example', password: PASSWORD });
  const wrong = await call('login', { email: user.email, password: 'not-the-password' });
  assert.equal(unknown.status, 401);
  assert.deepEqual(
    { ...wrong, body: { ...wrong.body, error: { ...(wrong.body as { error: object }).error, requestId: '' } } },
    { ...unknown, body: { ...unknown.body, error: { ...(unknown.body as { error: object }).error, requestId: '' } } },
  );
  for (const email of [user.email, 'nobody@college.example']) {
    assert.equal((await call('forgotPassword', { email })).status, 202);
    assert.equal((await call('resendCode', { email })).status, 202);
  }
  // Registering an already verified email answers 202 and changes nothing.
  assert.equal((await call('register', form(user.email, { name: 'Impostor' }))).status, 202);
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).name, user.name);
  assert.deepEqual(
    mail.map(m => [m.to, m.subject]),
    [[user.email, 'Your Smart Mailroom password code']],
  );
});

test('re-registering an unverified email replaces its details; the latest password wins', async () => {
  const email = 'asha@college.example';
  await ok('register', form(email, { password: 'first-password' }));
  await ok('register', form(email, { name: 'Asha R', phone: '9000000001' }));
  const session = await ok('verifyEmail', { email, code: codeFor(email) });
  assert.equal(session.user.name, 'Asha R');
  assert.equal(session.user.phone, '+919000000001');
  await fails('login', { email, password: 'first-password' }, 'UNAUTHENTICATED');
  await ok('login', { email, password: PASSWORD });
});

test('password reset sets the new password and revokes every session', async () => {
  const { user, token } = await signIn('MEMBER');
  const other = (await ok('login', { email: user.email, password: PASSWORD })).token;
  await ok('forgotPassword', { email: user.email });
  await fails('resetPassword', { email: user.email, code: '123456', password: 'new-password-1' }, 'CODE_INVALID');
  await ok('resetPassword', { email: user.email, code: codeFor(user.email), password: 'new-password-1' });
  for (const t of [token, other]) await fails('getMe', {}, 'UNAUTHENTICATED', t);
  await fails('login', { email: user.email, password: PASSWORD }, 'UNAUTHENTICATED');
  await ok('login', { email: user.email, password: 'new-password-1' });
});

test('change password keeps this session and revokes the others', async () => {
  const { user, token } = await signIn('OPERATOR');
  const other = (await ok('login', { email: user.email, password: PASSWORD })).token;
  await fails('changePassword', { currentPassword: 'wrong', newPassword: 'new-password-1' }, 'VALIDATION', token);
  await ok('changePassword', { currentPassword: PASSWORD, newPassword: 'new-password-1' }, token);
  await ok('getMe', {}, token);
  await fails('getMe', {}, 'UNAUTHENTICATED', other);
});

test('sessions slide for 7 days while used, expire when idle, and end on logout', async () => {
  const { token } = await signIn('MEMBER');
  clock.now += 6.5 * DAY;
  await ok('getMe', {}, token); // extends to 7 days from now
  clock.now += 6.5 * DAY;
  await ok('getMe', {}, token);
  clock.now += 7 * DAY + 1;
  await fails('getMe', {}, 'UNAUTHENTICATED', token);
  const fresh = await signIn('MEMBER');
  await ok('logout', {}, fresh.token);
  await fails('getMe', {}, 'UNAUTHENTICATED', fresh.token);
  await fails('getMe', {}, 'UNAUTHENTICATED', 'not-a-token');
});

test('login is limited to 10 attempts per 15 minutes per email', async () => {
  const { user } = await signIn('MEMBER'); // uses 1 attempt from this IP
  for (let n = 0; n < 9; n++)
    await fails('login', { email: user.email, password: 'wrong-password' }, 'UNAUTHENTICATED');
  await fails('login', { email: user.email, password: PASSWORD }, 'RATE_LIMITED');
  clock.now += 15 * 60_000 + 1;
  await ok('login', { email: user.email, password: PASSWORD });
});

test('a deactivated account can no longer sign in', async () => {
  const { user, token } = await signIn('MEMBER');
  await db.user.update({ where: { id: user.id }, data: { active: false } });
  await fails('getMe', {}, 'UNAUTHENTICATED', token);
  await fails('login', { email: user.email, password: PASSWORD }, 'ACCOUNT_DISABLED');
});
