import websocket from '@fastify/websocket';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient, Role } from '@prisma/client';
import type { WebSocket } from 'ws';
import { Ajv } from 'ajv';
import { contract, type Ctx, type Operation, type S } from './contract.js';
import type { Config } from './core/config.js';
import { allowed } from './core/rbac.js';
import { authenticate } from './modules/auth/service.js';

type Client = { socket: WebSocket; sessionId: string; userId: string; role: Role; alive: boolean };
type Audience = { users?: Set<string>; all?: boolean };
export type Realtime = { publish: (audience: Audience) => Promise<void> };

/** Process-local hub: add shared pub/sub before running multiple API instances. */
export async function realtime(app: FastifyInstance, db: PrismaClient, settings: Config, now: () => Date) {
  await app.register(websocket, { options: { maxPayload: 2048, perMessageDeflate: false } });
  const clients = new Set<Client>();
  const pending = new Set<WebSocket>();
  const validate = new Ajv({ strict: false }).compile(contract.components.schemas.RealtimeClientFrame as object);
  const send = (client: Client, type: S<'RealtimeServerFrame'>['type']) => {
    if (client.socket.readyState !== 1) return;
    if (client.socket.bufferedAmount > 8192) return client.socket.close(1013, 'Reconnect to refresh');
    client.socket.send(JSON.stringify({ type }));
  };
  async function validClients() {
    if (!clients.size) return [];
    const sessions = await db.session.findMany({
      where: { id: { in: [...clients].map(client => client.sessionId) } },
      include: { user: true },
    });
    const sessionsById = new Map(sessions.map(session => [session.id, session]));
    return [...clients].filter(client => {
      const session = sessionsById.get(client.sessionId);
      if (
        !session ||
        session.revokedAt ||
        session.expiresAt <= now() ||
        !session.user.active ||
        session.user.role !== client.role
      ) {
        clients.delete(client);
        client.socket.close(4001, 'Sign in again');
        return false;
      }
      return true;
    });
  }
  const hub: Realtime = {
    publish: async audience => {
      for (const client of await validClients())
        if (audience.all || client.role !== 'MEMBER' || audience.users?.has(client.userId)) send(client, 'changed');
    },
  };
  let checking = false;
  const heartbeat = setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      for (const client of await validClients()) {
        if (!client.alive) client.socket.terminate();
        else {
          client.alive = false;
          send(client, 'ping');
        }
      }
    } catch {
      clients.forEach(client => client.socket.close(1013, 'Reconnect later'));
    } finally {
      checking = false;
    }
  }, 20_000);
  heartbeat.unref();
  app.addHook('preClose', async () => {
    clearInterval(heartbeat);
    pending.forEach(socket => socket.terminate());
    clients.forEach(client => client.socket.terminate());
  });
  app.get(
    '/v1' + contract['x-realtime'].path,
    {
      websocket: true,
      onRequest: async (request, reply) => {
        if (request.raw.url?.includes('?')) return reply.code(400).send({ error: 'No query parameters accepted' });
        if (request.headers.origin && !settings.origins.includes(request.headers.origin))
          return reply.code(403).send({ error: 'Origin not allowed' });
        if (clients.size + pending.size >= 500) return reply.code(503).send({ error: 'Try again later' });
      },
    },
    (socket, request) => {
      pending.add(socket);
      let client: Client | undefined;
      let authenticating = false;
      const deadline = setTimeout(() => socket.close(4001, 'Authentication required'), 5000);
      deadline.unref();
      socket.on('close', () => {
        clearTimeout(deadline);
        pending.delete(socket);
        if (client) clients.delete(client);
      });
      socket.on('error', () => socket.terminate());
      // Install synchronously so early frames are never lost during asynchronous authentication.
      socket.on('message', async (raw, binary) => {
        try {
          if (binary || authenticating) return socket.close(1008, 'Invalid frame');
          const frame: unknown = JSON.parse(raw.toString());
          if (!validate(frame)) return socket.close(1008, 'Invalid frame');
          const message = frame as S<'RealtimeClientFrame'>;
          if (client) {
            if (message.type !== 'pong') return socket.close(1008, 'Invalid frame');
            client.alive = true;
            return;
          }
          if (message.type !== 'authenticate') return socket.close(4001, 'Authentication required');
          authenticating = true;
          const found = await authenticate({ db, config: settings, now: now(), ip: request.ip } as Ctx, message.token);
          if (socket.readyState !== 1) return;
          if (!found || !allowed(found.user.role, contract['x-realtime']['x-permission']))
            return socket.close(4001, 'Sign in again');
          if ([...clients].filter(item => item.userId === found.user.id).length >= 5)
            return socket.close(1013, 'Too many connections');
          client = { socket, sessionId: found.session.id, userId: found.user.id, role: found.user.role, alive: true };
          clearTimeout(deadline);
          pending.delete(socket);
          clients.add(client);
          authenticating = false;
          send(client, 'ready');
        } catch {
          socket.close(1008, 'Invalid frame');
        }
      });
    },
  );
  return hub;
}

/** Resolve members after commit. The pushed frame itself contains no identities or business data. */
export async function changedAudience(
  db: PrismaClient,
  operation: Operation,
  input: Record<string, unknown>,
  result: unknown,
  actor?: string,
): Promise<Audience> {
  const users = new Set(actor ? [actor] : []);
  if (typeof result === 'object' && result && 'recipient' in result) {
    const recipient = (result as { recipient?: { id: string } }).recipient;
    if (recipient) users.add(recipient.id);
  }
  if (typeof input.userId === 'string') users.add(input.userId);
  if (typeof input.collectionId === 'string') {
    const collection = await db.collection.findUnique({ where: { id: input.collectionId }, select: { userId: true } });
    if (collection) users.add(collection.userId);
  }
  if (typeof input.parcelId === 'string') {
    const parcel = await db.parcel.findUnique({ where: { id: input.parcelId }, select: { recipientId: true } });
    if (parcel?.recipientId) users.add(parcel.recipientId);
  }
  if (
    (operation === 'intakeParcel' || operation === 'assignParcel') &&
    typeof result === 'object' &&
    result &&
    'id' in result
  ) {
    // A contact conflict still consumes the request, even though no recipient was assigned.
    const requests = await db.parcelRequest.findMany({
      where: { parcelId: String(result.id) },
      select: { userId: true },
    });
    requests.forEach(request => users.add(request.userId));
  }
  return { users, all: operation === 'createHostel' || operation === 'updateHostel' };
}
