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
import { handlers as auth } from './modules/auth/handlers.js';
import { handlers as hostels } from './modules/hostels/handlers.js';
import { handlers as parcels } from './modules/parcels/handlers.js';
import { handlers as users } from './modules/users/handlers.js';
import { mailer, type Mailer } from './modules/notifications/email.js';

declare module 'fastify' {
  interface FastifyRequest {
    ctx: Ctx;
  }
}

export type AppOptions = { now?: () => Date; mailer?: Mailer };
const addFormats = createRequire(import.meta.url)('ajv-formats') as (ajv: Ajv) => void;
const handlers: Partial<Handlers> = { ...auth, ...users, ...hostels, ...parcels };

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
    else if (error.validation) e = new DomainError('VALIDATION', `Invalid request: ${error.message}.`);
    else if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500)
      e = new DomainError('VALIDATION', 'Malformed request.');
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
        return reply.code(status).send(await handler(input, request.ctx));
      },
    });
  }
  return app;
}
