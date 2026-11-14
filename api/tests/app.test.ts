import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { missingHandlers, operations } from '../src/app.js';
import { phone } from '../src/core/phone.js';
import { rate } from '../src/core/rate.js';
import { config } from '../src/core/config.js';
import { id, semaphore } from '../src/core/security.js';
import { cleanup } from '../src/jobs/worker.js';
import { app, clock, db, reset, signIn } from './helpers.js';

beforeEach(reset);

test('startup check: every contract operation has a handler, and a missing one is reported', () => {
  assert.deepEqual(missingHandlers(), []);
  assert.deepEqual(
    missingHandlers({}),
    operations.map(o => o.operationId),
  );
});

test('unknown routes, health and readiness', async () => {
  const unknown = await app.inject({ method: 'GET', url: '/v1/nope' });
  assert.equal(unknown.statusCode, 404);
  assert.equal(unknown.json().error.code, 'NOT_FOUND');
  assert.match(String(unknown.headers['x-request-id']), /^req_/);
  assert.equal(unknown.json().error.requestId, unknown.headers['x-request-id']);
  assert.equal((await app.inject({ method: 'GET', url: '/healthz' })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: '/readyz' })).statusCode, 200);
});

test('malformed JSON and unexpected bodies are VALIDATION errors', async () => {
  const bad = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    headers: { 'content-type': 'application/json' },
    payload: '{"email":',
  });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().error.code, 'VALIDATION');
});

test('phone numbers normalise to E.164; masked or junk numbers are null', () => {
  for (const [raw, expected] of [
    ['98765 43210', '+919876543210'],
    ['098765-43210', '+919876543210'],
    ['+91 (98765) 43210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['0044 20 7946 0018', '+442079460018'],
    ['+1 415 555 0100', '+14155550100'],
    ['98XXXXXX10', null],
    ['12345', null],
    ['5876543210', null],
    ['', null],
  ] as const)
    assert.equal(phone(raw), expected, raw);
});

test('rate limiter: a window allows the maximum, then resets when it expires', async () => {
  const now = new Date();
  const results = await Promise.all(Array.from({ length: 8 }, () => rate(db, 'k', 5, now, 60_000)));
  assert.equal(results.filter(Boolean).length, 5, 'concurrent requests cannot all slip under the limit');
  assert.equal(await rate(db, 'k', 5, new Date(+now + 60_001), 60_000), true);
});

test('worker cleanup removes expired sessions, rate windows, old codes and stale unverified sign-ups', async () => {
  const { user } = await signIn('MEMBER');
  const now = new Date(clock.now);
  const old = new Date(+now - 2 * 86_400_000);
  await db.user.create({ data: { id: id('usr'), email: 'stale@college.example', name: 'Stale', createdAt: old } });
  await db.user.create({ data: { id: id('usr'), email: 'fresh@college.example', name: 'Fresh' } });
  await db.session.create({ data: { id: id('ses'), tokenDigest: 'x', userId: user.id, expiresAt: old } });
  await db.rateWindow.create({ data: { key: 'old', count: 1, expiresAt: old } });
  await db.emailCode.create({
    data: { id: id('code'), userId: user.id, purpose: 'VERIFY', codeDigest: 'x', expiresAt: old },
  });
  await cleanup(db, now);
  assert.equal(await db.session.count(), 1, 'the live session from signIn stays');
  assert.equal(await db.rateWindow.count({ where: { key: 'old' } }), 0);
  assert.equal(await db.emailCode.count(), 0);
  assert.deepEqual(
    (await db.user.findMany({ orderBy: { email: 'asc' } })).map(u => u.email),
    ['fresh@college.example', user.email],
  );
});

test('the audit log is append-only, with no bypass', async () => {
  const { user } = await signIn('ADMIN');
  await db.auditEvent.create({ data: { id: 'aud_1', actorId: user.id, action: 'TEST', detail: '' } });
  await assert.rejects(db.$executeRaw`UPDATE "AuditEvent" SET detail = 'x'`, /append-only/);
  await assert.rejects(db.$executeRaw`SET mailroom.reset = 'enabled'; DELETE FROM "AuditEvent"`);
  await assert.rejects(db.auditEvent.deleteMany(), /append-only/);
});

test('semaphore: at most two tasks run at once, in order, and a failure frees its slot', async () => {
  const slot = semaphore(2);
  let running = 0;
  let peak = 0;
  const finished: number[] = [];
  const task = (n: number) =>
    slot(async () => {
      peak = Math.max(peak, ++running);
      await new Promise(resolve => setTimeout(resolve, 10));
      running--;
      if (n === 2) throw new Error('boom');
      finished.push(n);
      return n;
    });
  const results = await Promise.allSettled([0, 1, 2, 3, 4, 5].map(task));
  assert.equal(peak, 2);
  assert.deepEqual(finished, [0, 1, 3, 4, 5]);
  assert.equal(results[2].status, 'rejected');
  assert.equal(await slot(async () => 'free'), 'free');
});

test('config: per-IP limits default loose, read RATE_* variables, and reject junk', () => {
  const base = { DATABASE_URL: 'postgresql://x@localhost/db', CREDENTIAL_PEPPER: 'p'.repeat(32) };
  assert.deepEqual(config(base).rates, { loginPerIp: 300, codesPerIp: 150, codeChecksPerIp: 300 });
  assert.deepEqual(
    config({ ...base, RATE_LOGIN_PER_IP: '50', RATE_CODES_PER_IP: '20', RATE_CODE_CHECKS_PER_IP: '40' }).rates,
    { loginPerIp: 50, codesPerIp: 20, codeChecksPerIp: 40 },
  );
  for (const bad of ['0', '-1', '1.5', 'lots'])
    assert.throws(() => config({ ...base, RATE_LOGIN_PER_IP: bad }), /RATE_LOGIN_PER_IP/);
  assert.throws(() => config({ ...base, NODE_ENV: 'production' }), /RESEND_API_KEY, MAIL_FROM, ALLOWED_EMAIL_DOMAINS/);
});
