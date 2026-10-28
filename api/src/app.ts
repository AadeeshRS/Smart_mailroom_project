import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Ajv } from 'ajv';
import { createRequire } from 'node:module';
import type { PrismaClient } from '@prisma/client';
import type { operations } from '../../contracts/generated/api.js';
import { contract, schemaRef } from './contract.js';
import { Backend, type BackendOptions } from './backend.js';
import { DomainError } from './errors.js';
import { id } from './security.js';
import type { Config } from './config.js';
const addFormats = createRequire(import.meta.url)('ajv-formats') as (ajv: Ajv) => void;
export async function createApp(db: PrismaClient, config: Config, options: BackendOptions = {}) {
  const app = Fastify({ logger: false, bodyLimit: 32_768, requestTimeout: 20_000, connectionTimeout: 10_000 });
  await app.register(cors, { origin: config.origins, methods: ['GET', 'POST', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'] });
  const bodyAjv = new Ajv({ strict: false, allErrors: false, coerceTypes: false }); addFormats(bodyAjv);
  const parameterAjv = new Ajv({ strict: false, allErrors: false, coerceTypes: true }); addFormats(parameterAjv);
  for (const ajv of [bodyAjv, parameterAjv]) ajv.addSchema({ $id: 'mailroom', components: contract.components });
  app.setValidatorCompiler(({ schema, httpPart }) => (httpPart === 'body' ? bodyAjv : parameterAjv).compile(schema as object));
  app.addHook('onRequest', async (_request, reply) => { reply.header('Cache-Control', 'no-store'); });
  app.setErrorHandler((error, _request, reply) => {
    const requestId = id('req');
    const e = error instanceof DomainError ? error : new DomainError((error as { validation?: unknown }).validation || (error as { statusCode?: number }).statusCode === 400 || (error as { statusCode?: number }).statusCode === 413 ? 'VALIDATION' : 'PERSISTENCE', (error as { validation?: unknown }).validation ? 'Request does not satisfy the frozen API schema.' : 'Request could not be completed. Retry safely using the original key.', !(error as { validation?: unknown }).validation);
    const mapped = contract.components.schemas.ErrorCode['x-http-status-codes'][e.code];
    reply.code(typeof mapped === 'number' ? mapped : 503).send({ error: { code: e.code, message: e.message, requestId, retryable: e.retryable } });
  });
  app.setNotFoundHandler((request, reply) => reply.code(404).send({ error: { code: !config.demo && ['/v1/demo/sessions', '/v1/demo/reset'].includes(request.url.split('?')[0]) ? 'DEMO_DISABLED' : 'NOT_FOUND', message: 'Operation unavailable.', requestId: id('req'), retryable: false } }));
  const backend = new Backend(db, config, options);
  app.addHook('onClose', async () => { backend.credentials.clear(); });
  for (const [path, methods] of Object.entries(contract.paths) as [string, Record<string, { operationId: keyof operations; parameters: { name: string; in: string; required?: boolean; schema: unknown }[]; requestBody?: { content: { 'application/json': { schema: unknown } } } }> ][]) {
    for (const [method, operation] of Object.entries(methods)) {
      if (!config.demo && ['login', 'resetDemo'].includes(operation.operationId)) continue;
      const parameters = (kind: string) => { const list = operation.parameters.filter(p => p.in === kind); return { type: 'object', additionalProperties: false, properties: Object.fromEntries(list.map(p => [p.name, schemaRef(p.schema)])), required: list.filter(p => p.required).map(p => p.name) }; };
      app.route({ method: method.toUpperCase() as 'GET' | 'POST' | 'DELETE', url: '/v1' + path.replaceAll(/\{(\w+)\}/g, ':$1'), schema: { params: parameters('path'), querystring: parameters('query'), ...(operation.requestBody ? { body: schemaRef(operation.requestBody.content['application/json'].schema) } : {}) }, handler: async request => {
        if (!operation.requestBody && request.body !== undefined) throw new DomainError('VALIDATION', 'This operation does not accept a request body.');
        const bearer = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1] ?? '';
        const input = { ...(request.query as object), ...(request.params as object), ...(request.body as object ?? {}) };
        return backend.execute(operation.operationId, input, bearer, request.ip);
      } });
    }
  }
  return { app, backend };
}
