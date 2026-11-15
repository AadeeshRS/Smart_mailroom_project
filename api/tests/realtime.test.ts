import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import { app, clock, db, fails, ok, reset, signIn } from './helpers.js';
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

test('the companion channel is AUTH, rejects bad frames/tokens, query credentials and untrusted origins', async () => {
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
  await assert.rejects(app.injectWS('/v1/realtime', { headers: { origin: 'https://untrusted.example' } }));
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
