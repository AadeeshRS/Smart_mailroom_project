import Fastify, { LogController, type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import { Ajv } from 'ajv';
import { createRequire } from 'node:module';
import type { PrismaClient } from '@prisma/client';
import { contract, schemaRef, type ContractOperation, type Ctx, type Handlers } from './contract.js';
import type { Config } from './core/config.js';
import { DomainError } from './core/errors.js';
import { allowed } from './core/rbac.js';
import { id } from './core/security.js';
import { authenticate } from './modules/auth/service.js';
import { handlers as admin } from './modules/admin/handlers.js';
import { handlers as auth } from './modules/auth/handlers.js';
import { handlers as collection } from './modules/collection/handlers.js';
import { handlers as hostels } from './modules/hostels/handlers.js';
import { handlers as notifications } from './modules/notifications/handlers.js';
import { handlers as parcels } from './modules/parcels/handlers.js';
import { handlers as requests } from './modules/requests/handlers.js';
import { handlers as users } from './modules/users/handlers.js';
import { mailer, type Mailer } from './modules/notifications/email.js';
import { afterWrite, realtime, type Audience, type Realtime } from './realtime.js';

declare module 'fastify' {
  interface FastifyRequest {
    ctx: Ctx;
  }
  interface FastifyInstance {
    realtime: Realtime;
    publishChanges: (audience: Audience) => void;
  }
}

export type AppOptions = { now?: () => Date; mailer?: Mailer };

/** A schema-validation failure in words a person can act on (plan 8.4): the first problem, by field name. */
export function invalidMessage(error: Pick<FastifyError, 'validation'>) {
  const [first] = error.validation ?? [];
  const name = String(first?.params?.missingProperty ?? first?.instancePath.split('/').pop() ?? '');
  const field = name
    ? name
        .replace(/([A-Z])/g, ' $1')
        .toLowerCase()
        .replace(/^./, c => c.toUpperCase())
        .replace(/\bid\b/i, 'ID')
    : 'A value';
  const limit = first?.params?.limit;
  if (first?.keyword === 'required') return `${field} is required.`;
  if (first?.keyword === 'minLength') return `${field} must be at least ${limit} characters.`;
  if (first?.keyword === 'maxLength') return `${field} must be at most ${limit} characters.`;
  return `${field} isn’t valid. Check it and try again.`;
}
const addFormats = createRequire(import.meta.url)('ajv-formats') as (ajv: Ajv) => void;
const handlers: Partial<Handlers> = {
  ...auth,
  ...users,
  ...hostels,
  ...parcels,
  ...requests,
  ...collection,
  ...admin,
  ...notifications,
};

/** Every contract operation, with its $ref parameters resolved. */
export const operations = Object.entries(contract.paths).flatMap(([path, methods]) =>
  Object.entries(methods).map(([method, operation]) => ({
    path,
    method: method.toUpperCase() as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    ...operation,
    parameters: (operation.parameters ?? []).map(p =>
      '$ref' in p ? contract.components.parameters[p.$ref.split('/').at(-1)!] : p,
    ),
  })),
);

/** Contract operations with no handler; createApp refuses to start if there are any. */
export const missingHandlers = (map: Partial<Handlers> = handlers) =>
  operations.filter(o => !map[o.operationId]).map(o => o.operationId);

export async function createApp(db: PrismaClient, config: Config, options: AppOptions = {}) {
  const missing = missingHandlers();
  if (missing.length) throw new Error(`No handler for contract operation(s): ${missing.join(', ')}`);
  const now = options.now ?? (() => new Date());
  const mail = options.mailer ?? mailer(config);

  const app = Fastify({
    logger: config.environment !== 'test' && { redact: ['req.headers.authorization'] },
    // No per-request lines: URLs carry search terms like phone numbers. Errors are logged below.
    logController: new LogController({ disableRequestLogging: true }),
    genReqId: () => id('req'),
    trustProxy: config.trustProxy,
    bodyLimit: 32_768,
    requestTimeout: 20_000,
    connectionTimeout: 10_000,
  });
  const updates = await realtime(app, db, config, now);
  app.decorate('realtime', updates);
  app.decorate('publishChanges', (audience: Audience) => updates.publish(audience));
  await app.register(cors, {
    origin: config.origins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  const bodyAjv = new Ajv({ strict: false, coerceTypes: false });
  const parameterAjv = new Ajv({ strict: false, coerceTypes: true, useDefaults: true });
  for (const ajv of [bodyAjv, parameterAjv]) {
    addFormats(ajv);
    ajv.addSchema({ $id: 'mailroom', components: contract.components });
  }
  app.setValidatorCompiler(({ schema, httpPart }) =>
    (httpPart === 'body' ? bodyAjv : parameterAjv).compile(schema as object),
  );
  app.decorateRequest('ctx');
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store').header('x-request-id', request.id);
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    let e: DomainError;
    if (error instanceof DomainError) e = error;
    else if (error.validation) {
      request.log.info({ requestId: request.id, validation: error.message }, 'Invalid request');
      e = new DomainError('VALIDATION', invalidMessage(error));
    } else if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500)
      e = new DomainError(
        'VALIDATION',
        'The app sent something the server couldn’t read. Update the app and try again.',
      );
    else {
      request.log.error({ err: error, requestId: request.id }, 'Unexpected error');
      e = new DomainError('INTERNAL', 'Something went wrong on our side. Try again later.');
    }
    const status = contract.components.schemas.ErrorCode['x-http-status-codes'][e.code] ?? 500;
    reply
      .code(status)
      .send({ error: { code: e.code, message: e.message, requestId: request.id, retryable: e.retryable } });
  });
  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      error: { code: 'NOT_FOUND', message: 'No such endpoint.', requestId: request.id, retryable: false },
    }),
  );

  // Outside the contract and unauthenticated: for the host's health checks.
  app.get('/healthz', async () => ({ ok: true }));
  app.get('/readyz', async (_request, reply) => {
    try {
      await db.$queryRaw`SELECT 1`;
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });

  for (const operation of operations) {
    const permission = operation['x-permission'];
    const status = Number(Object.keys(operation.responses).find(code => /^2\d\d$/.test(code)));
    const parameters = (kind: string) => {
      const list = operation.parameters.filter(p => p.in === kind);
      return {
        type: 'object',
        additionalProperties: false,
        properties: Object.fromEntries(list.map(p => [p.name, schemaRef(p.schema)])),
        required: list.filter(p => p.required).map(p => p.name),
      };
    };
    const body = (operation as ContractOperation).requestBody?.content['application/json'].schema;
    app.route({
      method: operation.method,
      url: '/v1' + operation.path.replaceAll(/\{(\w+)\}/g, ':$1'),
      schema: {
        params: parameters('path'),
        querystring: parameters('query'),
        ...(body ? { body: schemaRef(body) } : {}),
      },
      // The one permission check, before any input validation, so callers learn nothing without access.
      onRequest: async request => {
        request.ctx = { db, config, mailer: mail, now: now(), ip: request.ip };
        if (permission === 'PUBLIC') return;
        const bearer = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1];
        const found = bearer && (await authenticate(request.ctx, bearer));
        if (!found) throw new DomainError('UNAUTHENTICATED', 'Sign in to continue.');
        if (!allowed(found.user.role, permission))
          throw new DomainError('FORBIDDEN', "Your account doesn't have access to this.");
        Object.assign(request.ctx, found);
      },
      handler: async (request, reply) => {
        if (!body && request.body !== undefined)
          throw new DomainError('VALIDATION', 'This operation does not accept a request body.');
        const input = { ...(request.query as object), ...(request.params as object), ...(request.body as object) };
        const handler = handlers[operation.operationId] as (input: unknown, ctx: Ctx) => Promise<unknown>;
        const live = (result: unknown, failed: boolean) =>
          void afterWrite(updates, db, operation.operationId, input, result, request.ctx, failed).catch(() =>
            app.log.warn('Live update unavailable; clients will recover with a fresh read'),
          );
        let result: unknown;
        try {
          result = await handler(input, request.ctx);
        } catch (error) {
          // A wrong collection code spends an attempt (the fifth cancels the code): a change, though the call failed.
          if (
            operation.operationId === 'verifyCollection' &&
            error instanceof DomainError &&
            error.code === 'CODE_INVALID'
          )
            live(undefined, true);
          throw error;
        }
        reply.code(status).send(result);
        // After the reply (WS-07): the caller never waits for the fan-out, and a failed fan-out can't fail the call.
        if (operation.method !== 'GET') live(result, false);
        return reply;
      },
    });
  }
  return app;
}
