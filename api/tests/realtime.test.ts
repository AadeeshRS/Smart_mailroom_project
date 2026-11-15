import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { PrismaClient } from '@prisma/client';
import { createApp } from '../src/app.js';
import { app, clock, db, fails, mailer, ok, reset, settings, signIn } from './helpers.js';
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
  const member = await signIn('MEMBER', { phone: '+919876543210' });
  const other = await signIn('MEMBER');
  const staff = await connect(operator.token);
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
  await db.session.updateMany({ where: { userId: expired.user.id }, data: { expiresAt: new Date(clock.now - 1) } });
  const expiredClose = once(third, 'close');
  await app.publishChanges();
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
