import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { PrismaClient } from '@prisma/client';
import { createApp } from '../src/app.js';
import { operations } from '../src/app.js';
import { runJobs } from '../src/jobs/worker.js';
import { PERSONAL, SHARED } from '../src/realtime.js';
import { PASSWORD, app, clock, codeFor, db, fails, mailer, ok, reset, settings, signIn } from './helpers.js';
import { contract } from '../src/contract.js';

const sockets: WebSocket[] = [];
beforeEach(reset);
afterEach(async () => {
  await Promise.all(
    sockets.splice(0).map(async socket => {
      if (socket.readyState === 3) return;
      const closed = once(socket, 'close');
      socket.close();
      await closed;
    }),
  );
});
async function connect(token?: string) {
  await app.ready();
  const socket = await app.injectWS('/v1/realtime');
  sockets.push(socket);
  if (token) {
    const ready = once(socket, 'message');
    socket.send(JSON.stringify({ type: 'authenticate', token }));
    assert.deepEqual(JSON.parse(String((await ready)[0])), { type: 'ready' });
  }
  return socket;
}

test('the companion channel is AUTH and rejects bad frames, bad tokens and query credentials', async () => {
  assert.equal(contract['x-realtime']['x-permission'], 'AUTH');
  const socket = await connect();
  const closed = once(socket, 'close');
  socket.send(JSON.stringify({ type: 'authenticate', token: 'wrong' }));
  assert.equal((await closed)[0], 4001);
  const malformed = await connect();
  const denied = once(malformed, 'close');
  malformed.send(JSON.stringify({ type: 'subscribe', userId: 'someone-else' }));
  assert.equal((await denied)[0], 1008);
  await assert.rejects(app.injectWS('/v1/realtime?token=secret'));
});

test('any Origin is accepted, including the http://<API host> that React Native on Android always sends', async () => {
  const member = await signIn('MEMBER');
  for (const origin of ['http://127.0.0.1:3000', 'https://smart-mailroom-api.onrender.com']) {
    const socket = await app.injectWS('/v1/realtime', { headers: { origin } });
    sockets.push(socket);
    const ready = once(socket, 'message');
    socket.send(JSON.stringify({ type: 'authenticate', token: member.token }));
    assert.deepEqual(JSON.parse(String((await ready)[0])), { type: 'ready' }, origin);
  }
});

test('post-commit invalidations reach the recipient and staff, never an unrelated member; failed writes emit nothing', async () => {
  const operator = await signIn('OPERATOR');
  const colleague = await signIn('OPERATOR');
  const member = await signIn('MEMBER', { phone: '+919876543210' });
  const other = await signIn('MEMBER');
  const staff = await connect(colleague.token);
  const mine = await connect(member.token);
  const unrelated = await connect(other.token);
  const unwanted: string[] = [];
  unrelated.on('message', message => unwanted.push(String(message)));
  const staffChanged = once(staff, 'message');
  const memberChanged = once(mine, 'message');
  await ok(
    'intakeParcel',
    { id: randomUUID(), awb: 'EE123456789IN', shelf: 'LIVE', labelPhone: '9876543210' },
    operator.token,
  );
  for (const frame of [await staffChanged, await memberChanged])
    assert.deepEqual(JSON.parse(String(frame[0])), { type: 'changed' });
  assert.deepEqual(unwanted, []);
  const frames: string[] = [];
  mine.on('message', frame => frames.push(String(frame)));
  const failed = await app.inject({
    method: 'POST',
    url: '/v1/parcels',
    headers: { authorization: `Bearer ${operator.token}` },
    payload: {},
  });
  assert.equal(failed.statusCode, 400);
  assert.deepEqual(frames, []);
});

test('logout/revocation and expiry close live sessions; reconnect starts with a fresh ready signal', async () => {
  const member = await signIn('MEMBER');
  const first = await connect(member.token);
  const firstClosed = once(first, 'close');
  first.close();
  await firstClosed;
  const second = await connect(member.token);
  const closed = once(second, 'close');
  await ok('logout', {}, member.token);
  assert.equal((await closed)[0], 4001);
  const expired = await signIn('MEMBER');
  const third = await connect(expired.token);
  const expiredClose = once(third, 'close');
  clock.now += 8 * 86_400_000; // past the 7-day session: the heartbeat re-reads it and closes the socket
  await app.realtime.tick();
  assert.equal((await expiredClose)[0], 4001);
});

test('failed OTP checks push their changed attempts and cancellation to the member and guard', async () => {
  const operator = await signIn('OPERATOR');
  const member = await signIn('MEMBER', { phone: '+919876543210' });
  await ok(
    'intakeParcel',
    { id: randomUUID(), awb: 'D12345678', shelf: 'A1', labelPhone: '9876543210' },
    operator.token,
  );
  const code = await ok('collectNow', {}, member.token);
  const mine = await connect(member.token);
  const staff = await connect(operator.token);
  const wrong = code.otp === '000000' ? '111111' : '000000';
  for (let attempt = 0; attempt < 5; attempt++) {
    const memberChanged = once(mine, 'message');
    const staffChanged = once(staff, 'message');
    await fails('verifyCollection', { collectionId: code.id, otp: wrong }, 'CODE_INVALID', operator.token);
    assert.deepEqual(JSON.parse(String((await memberChanged)[0])), { type: 'changed' });
    assert.deepEqual(JSON.parse(String((await staffChanged)[0])), { type: 'changed' });
  }
  assert.deepEqual(await ok('getMyCollection', {}, member.token), { collection: null });
  assert.deepEqual((await ok('listCollections', {}, operator.token)).items, []);
});

test('a socket that sends nothing for 5 s is dropped without 4001, and its token keeps working', async () => {
  const member = await signIn('MEMBER');
  const silent = await connect();
  const started = Date.now();
  const [code] = await once(silent, 'close');
  assert.notEqual(code, 4001, 'a timeout must not tell the client to sign out');
  assert.ok(Date.now() - started >= 4500, 'the deadline is about 5 s');
  await connect(member.token); // the same token still reaches "ready"
  await ok('getMe', {}, member.token);
});

test('the deadline stops when the authenticate frame arrives, so a slow session lookup still gets "ready"', async () => {
  const member = await signIn('MEMBER');
  // The same database, with session lookups delayed past the 5 s deadline (a waking Neon compute, say).
  const slowSessions = new Proxy(db.session, {
    get: (target, key) =>
      key === 'findUnique'
        ? async (...args: Parameters<typeof db.session.findUnique>) => {
            await new Promise(resolve => setTimeout(resolve, 5500));
            return target.findUnique(...args);
          }
        : Reflect.get(target, key),
  });
  const slowDb = new Proxy(db, { get: (target, key) => (key === 'session' ? slowSessions : Reflect.get(target, key)) });
  const slow = await createApp(slowDb as PrismaClient, settings, { now: () => new Date(clock.now), mailer });
  try {
    await slow.ready();
    const socket = await slow.injectWS('/v1/realtime');
    const first = Promise.race([
      once(socket, 'message').then(([frame]) => JSON.parse(String(frame))),
      once(socket, 'close').then(([code]) => ({ closed: code })),
    ]);
    socket.send(JSON.stringify({ type: 'authenticate', token: member.token }));
    assert.deepEqual(await first, { type: 'ready' });
    socket.terminate();
  } finally {
    await slow.close();
  }
});

test("password reset, deactivation, role change and logout each close just that user's sockets with 4001", async () => {
  const admin = await signIn('ADMIN');
  const bystander = await signIn('MEMBER');
  const watching = await connect(bystander.token);
  const cases: [string, (user: Awaited<ReturnType<typeof signIn>>) => Promise<unknown>][] = [
    ['logout', user => ok('logout', {}, user.token)],
    [
      'password reset',
      async user => {
        await ok('forgotPassword', { email: user.user.email });
        return ok('resetPassword', {
          email: user.user.email,
          code: codeFor(user.user.email),
          password: 'another-pass-1',
        });
      },
    ],
    ['deactivation', user => ok('updateUser', { userId: user.user.id, active: false }, admin.token)],
    ['role change', user => ok('updateUser', { userId: user.user.id, role: 'OPERATOR' }, admin.token)],
  ];
  for (const [name, end] of cases) {
    const user = await signIn('MEMBER');
    const socket = await connect(user.token);
    const closed = once(socket, 'close');
    await end(user);
    assert.equal((await closed)[0], 4001, name);
  }
  assert.equal(watching.readyState, 1, 'other users stay connected');
});

test('an idle socket costs no database query: pings and publishes work from memory; an expiry that slid stays open', async () => {
  const member = await signIn('MEMBER');
  const touched: string[] = [];
  const counted = new Proxy(db, {
    get: (target, key) => {
      if (typeof key === 'string' && !key.startsWith('$')) touched.push(key);
      return Reflect.get(target, key);
    },
  });
  const live = await createApp(counted as PrismaClient, settings, { now: () => new Date(clock.now), mailer });
  try {
    await live.ready();
    const socket = await live.injectWS('/v1/realtime');
    const frames: string[] = [];
    socket.on('message', frame => frames.push(String(frame)));
    socket.send(JSON.stringify({ type: 'authenticate', token: member.token }));
    await new Promise(resolve => setTimeout(resolve, 200));
    touched.length = 0;
    await live.realtime.tick();
    live.realtime.publish({ users: [member.user.id] });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(touched, [], 'no table was touched');
    assert.deepEqual(frames, ['{"type":"ready"}', '{"type":"ping"}', '{"type":"changed"}']);
    // The session slid forward (it was used over HTTP); passing the old expiry re-reads it and keeps the socket.
    await db.session.updateMany({
      where: { userId: member.user.id },
      data: { expiresAt: new Date(clock.now + 14 * 86_400_000) },
    });
    clock.now += 8 * 86_400_000;
    socket.send(JSON.stringify({ type: 'pong' }));
    await new Promise(resolve => setTimeout(resolve, 100));
    await live.realtime.tick();
    assert.deepEqual(touched, ['session'], 'only the one expired session was re-read');
    assert.equal(socket.readyState, 1);
    socket.terminate();
  } finally {
    await live.close();
  }
});

test('the worker publishes only what it changed: an idle run sends nothing; an expired request reaches its member and staff', async () => {
  const operator = await signIn('OPERATOR');
  const member = await signIn('MEMBER');
  const other = await signIn('MEMBER');
  const frames = { operator: [] as string[], member: [] as string[], other: [] as string[] };
  for (const [name, user] of [
    ['operator', operator],
    ['member', member],
    ['other', other],
  ] as const)
    (await connect(user.token)).on('message', frame => frames[name].push(String(frame)));
  assert.equal(await runJobs(db, settings, new Date(clock.now)), undefined, 'an idle run changes nothing');
  await ok('createRequest', { awb: 'EE111222333IN' }, member.token);
  await new Promise(resolve => setTimeout(resolve, 100));
  for (const list of Object.values(frames)) list.length = 0;
  const audience = await runJobs(db, settings, new Date(clock.now + 31 * 86_400_000));
  assert.deepEqual(
    { users: [...(audience?.users ?? [])], staff: audience?.staff },
    { users: [member.user.id], staff: true },
  );
  app.publishChanges(audience!);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.deepEqual(frames, { operator: ['{"type":"changed"}'], member: ['{"type":"changed"}'], other: [] });
});

test('every authenticated write is classified as shared (parcels, requests, collections, users, hostels) or personal', () => {
  const writes = operations.filter(o => o.method !== 'GET' && o['x-permission'] !== 'PUBLIC').map(o => o.operationId);
  assert.deepEqual(
    writes.filter(op => SHARED.has(op) === PERSONAL.has(op)),
    [],
    'each write is in exactly one set',
  );
});

test("public writes tell nobody; personal writes reach only the actor's other sessions; shared writes reach affected members and staff, never the writer's own session", async () => {
  const operator = await signIn('OPERATOR');
  const member = await signIn('MEMBER');
  const phone = await ok('login', { email: member.user.email, password: PASSWORD }); // the member's other device
  const seen = { staff: 0, writer: 0, other: 0 };
  (await connect(operator.token)).on('message', () => seen.staff++);
  (await connect(member.token)).on('message', () => seen.writer++);
  (await connect(phone.token)).on('message', () => seen.other++);
  const settle = async () => {
    await new Promise(resolve => setTimeout(resolve, 150));
    const copy = { ...seen };
    Object.assign(seen, { staff: 0, writer: 0, other: 0 });
    return copy;
  };
  await ok('login', { email: member.user.email, password: PASSWORD });
  await ok('forgotPassword', { email: member.user.email });
  await ok('register', {
    email: 'newcomer@college.example',
    password: 'long-enough-1',
    name: 'New Comer',
    memberType: 'STUDENT',
    idNumber: 'NEW1',
    phone: '9000011111',
    acceptPrivacyNotice: true,
  });
  assert.deepEqual(await settle(), { staff: 0, writer: 0, other: 0 }, 'public writes');
  await ok('updateMe', { roomNumber: 'B-1' }, member.token);
  await ok('markNotificationsRead', {}, member.token);
  assert.deepEqual(await settle(), { staff: 0, writer: 0, other: 2 }, 'personal writes');
  await ok('createRequest', { awb: 'EE999888777IN' }, member.token);
  assert.deepEqual(await settle(), { staff: 1, writer: 0, other: 1 }, 'a shared write');
});
