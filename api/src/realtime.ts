import websocket from '@fastify/websocket';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient, Role } from '@prisma/client';
import type { WebSocket } from 'ws';
import { Ajv } from 'ajv';
import { contract, type Ctx, type Operation, type S } from './contract.js';
import type { Config } from './core/config.js';
import { allowed } from './core/rbac.js';
import { authenticate, normalEmail } from './modules/auth/service.js';

type Client = {
  socket: WebSocket;
  sessionId: string;
  userId: string;
  role: Role;
  /** The session's expiry when last read; re-read only once it has passed (sessions slide forward daily). */
  expiresAt: number;
  alive: boolean;
};
/** Who gets "changed": these users' sockets, every staff socket, or everyone; never the writer's own session,
 * which refreshed itself after its HTTP reply. */
export type Audience = { users?: Iterable<string>; staff?: boolean; all?: boolean; except?: string };
export type Realtime = {
  /** In memory only: no database query. */
  publish: (audience: Audience) => void;
  /** Re-read one user's live sessions after a write that can have ended them; close the ended ones with 4001. */
  revalidate: (userId: string) => Promise<void>;
  /** One heartbeat: ping everyone, drop sockets that missed the last ping, re-read sessions whose expiry passed. */
  tick: () => Promise<void>;
};

/** Process-local hub: add shared pub/sub before running multiple API instances. An idle socket costs no database
 * query: publishing and pinging work from memory, and a session is re-read only when its expiry passes or a write
 * (logout, password change or reset, deactivation, role change) can have ended it. */
export async function realtime(app: FastifyInstance, db: PrismaClient, settings: Config, now: () => Date) {
  await app.register(websocket, {
    options: { maxPayload: 2048, perMessageDeflate: false },
    // An oversized or broken frame is the client's fault: log it at info, not as a server error (WS-09).
    errorHandler: (error, socket, request) => {
      request.log.info({ code: (error as { code?: string }).code }, 'Dropped a live-update socket after a bad frame');
      socket.terminate();
    },
  });
  const clients = new Set<Client>();
  const pending = new Set<WebSocket>();
  /** Unauthenticated sockets per client IP (WS-05): one address can't fill the 500 slots. Behind Render's proxy
   * request.ip is the real client (TRUST_PROXY=1). ponytail: a campus behind one NAT shares these 10 during a mass
   * reconnect; the client's backoff spreads the retries. */
  const pendingByIp = new Map<string, number>();
  const PENDING_PER_IP = 10;
  const validate = new Ajv({ strict: false }).compile(contract.components.schemas.RealtimeClientFrame as object);
  const send = (client: Client, type: S<'RealtimeServerFrame'>['type']) => {
    if (client.socket.readyState !== 1) return;
    if (client.socket.bufferedAmount > 8192) return client.socket.close(1013, 'Reconnect to refresh');
    client.socket.send(JSON.stringify({ type }));
  };
  async function recheck(targets: Client[]) {
    if (!targets.length) return;
    const sessions = await db.session.findMany({
      where: { id: { in: targets.map(client => client.sessionId) } },
      include: { user: true },
    });
    const byId = new Map(sessions.map(session => [session.id, session]));
    for (const client of targets) {
      const session = byId.get(client.sessionId);
      if (
        !session ||
        session.revokedAt ||
        session.expiresAt <= now() ||
        !session.user.active ||
        session.user.role !== client.role
      ) {
        clients.delete(client);
        client.socket.close(4001, 'Sign in again');
      } else client.expiresAt = +session.expiresAt;
    }
  }
  let ticking = false;
  const hub: Realtime = {
    publish: audience => {
      const users = new Set(audience.users ?? []);
      for (const client of clients)
        if (
          client.sessionId !== audience.except &&
          (audience.all || users.has(client.userId) || (audience.staff && client.role !== 'MEMBER'))
        )
          send(client, 'changed');
    },
    revalidate: userId => recheck([...clients].filter(client => client.userId === userId)),
    tick: async () => {
      if (ticking) return;
      ticking = true;
      try {
        await recheck([...clients].filter(client => client.expiresAt <= +now()));
      } catch {
        // The database is unreachable: skip this re-read and try again next tick, rather than drop everyone (WS-08).
      } finally {
        ticking = false;
      }
      for (const client of clients) {
        if (!client.alive) client.socket.terminate();
        else {
          client.alive = false;
          send(client, 'ping');
        }
      }
    },
  };
  const heartbeat = setInterval(() => void hub.tick(), 20_000);
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
        // No Origin check: React Native (Android) always sends Origin: http[s]://<API host>, and the session token
        // travels in the first frame, never a cookie, so another site can't use a socket without it.
        if (clients.size + pending.size >= 500) return reply.code(503).send({ error: 'Try again later' });
        if ((pendingByIp.get(request.ip) ?? 0) >= PENDING_PER_IP)
          return reply.code(429).send({ error: 'Too many connections from this address' });
      },
    },
    (socket, request) => {
      // Checked again here: simultaneous upgrades from one address can all pass onRequest first.
      const ip = request.ip;
      if ((pendingByIp.get(ip) ?? 0) >= PENDING_PER_IP) return socket.terminate();
      pendingByIp.set(ip, (pendingByIp.get(ip) ?? 0) + 1);
      let counted = true;
      const release = () => {
        if (!counted) return;
        counted = false;
        const left = (pendingByIp.get(ip) ?? 1) - 1;
        if (left) pendingByIp.set(ip, left);
        else pendingByIp.delete(ip);
      };
      pending.add(socket);
      let client: Client | undefined;
      let authenticating = false;
      // Only a missing first frame times out, never a slow session lookup (WS-02). terminate() frees the slot at
      // once; the client sees 1006 and reconnects. 4001 is kept for a token the server actually rejected.
      const deadline = setTimeout(() => socket.terminate(), 5000);
      deadline.unref();
      socket.on('close', () => {
        clearTimeout(deadline);
        release();
        pending.delete(socket);
        if (client) clients.delete(client);
      });
      socket.on('error', () => socket.terminate());
      // Install synchronously so early frames are never lost during asynchronous authentication.
      socket.on('message', async (raw, binary) => {
        let message: S<'RealtimeClientFrame'>;
        try {
          if (binary || authenticating) return socket.close(1008, 'Invalid frame');
          const frame: unknown = JSON.parse(raw.toString());
          if (!validate(frame)) return socket.close(1008, 'Invalid frame');
          message = frame as S<'RealtimeClientFrame'>;
        } catch {
          return socket.close(1008, 'Invalid frame');
        }
        if (client) {
          if (message.type !== 'pong') return socket.close(1008, 'Invalid frame');
          client.alive = true;
          return;
        }
        if (message.type !== 'authenticate') return socket.close(1008, 'Authenticate first');
        clearTimeout(deadline);
        authenticating = true;
        let found: Awaited<ReturnType<typeof authenticate>>;
        try {
          found = await authenticate({ db, config: settings, now: now(), ip: request.ip } as Ctx, message.token);
        } catch {
          return socket.close(1011, 'Try again'); // the database, not the token: reconnect
        }
        if (socket.readyState !== 1) return;
        if (!found || !allowed(found.user.role, contract['x-realtime']['x-permission']))
          return socket.close(4001, 'Sign in again');
        if ([...clients].filter(item => item.userId === found.user.id).length >= 5)
          return socket.close(1013, 'Too many connections');
        client = {
          socket,
          sessionId: found.session.id,
          userId: found.user.id,
          role: found.user.role,
          expiresAt: +found.session.expiresAt,
          alive: true,
        };
        pending.delete(socket);
        release();
        clients.add(client);
        authenticating = false;
        send(client, 'ready');
      });
    },
  );
  return hub;
}

/** Changes to parcels, requests, collections, users and hostels: the affected members and every staff socket hear
 * about them. */
export const SHARED = new Set<Operation>([
  'intakeParcel',
  'assignParcel',
  'remindParcel',
  'returnParcel',
  'createRequest',
  'updateRequest',
  'cancelRequest',
  'collectNow',
  'cancelCollection',
  'verifyCollection',
  'completeCollection',
  'createUser',
  'updateUser',
  'createHostel',
  'updateHostel',
]);
/** The signed-in user's own business: at most their other sessions hear about it. */
export const PERSONAL = new Set<Operation>([
  'logout',
  'updateMe',
  'changePassword',
  'markNotificationsRead',
  'registerDevice',
]);

/** After a successful write (or a wrong collection code, which spends an attempt): re-check sessions it can have
 * ended, then tell who needs to know. PUBLIC operations (sign-up, codes, login, password reset) tell nobody. The
 * writer's own session is skipped unless the call failed: it refreshed itself when its reply arrived. */
export async function afterWrite(
  hub: Realtime,
  db: PrismaClient,
  operation: Operation,
  input: Record<string, unknown>,
  result: unknown,
  ctx: Ctx,
  failed = false,
) {
  const ended =
    operation === 'logout' || operation === 'changePassword'
      ? ctx.user?.id
      : operation === 'updateUser'
        ? String(input.userId)
        : operation === 'resetPassword'
          ? (await db.user.findUnique({ where: { email: normalEmail(String(input.email)) }, select: { id: true } }))?.id
          : undefined;
  if (ended) await hub.revalidate(ended);
  if (!ctx.user || !ctx.session) return;
  if (!SHARED.has(operation)) return hub.publish({ users: [ctx.user.id], except: ctx.session.id });
  hub.publish({
    ...(await changedAudience(db, operation, input, result, ctx.user.id)),
    staff: true,
    except: failed ? undefined : ctx.session.id,
  });
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
