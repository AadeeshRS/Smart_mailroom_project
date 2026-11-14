import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PrismaClient, Session, User } from '@prisma/client';
import YAML from 'yaml';
import type { components, operations } from '../../contracts/generated/api.js';
import type { Config } from './core/config.js';
import type { Permission } from './core/rbac.js';
import type { Mailer } from './modules/notifications/email.js';

export type S<K extends keyof components['schemas']> = components['schemas'][K];
export type Operation = keyof operations;
type Json<T> = T extends { content: { 'application/json': infer V } } ? V : Record<never, never>;
type Params<T, K extends string> = T extends { parameters: infer P }
  ? K extends keyof P
    ? NonNullable<P[K]> extends never
      ? Record<never, never>
      : NonNullable<P[K]>
    : Record<never, never>
  : Record<never, never>;
type Success<R> = R extends { 200: infer V } ? V : R extends { 202: infer V } ? V : never;
export type Input<K extends Operation> = (operations[K] extends { requestBody: infer B }
  ? Json<B>
  : Record<never, never>) &
  Params<operations[K], 'path'> &
  Params<operations[K], 'query'>;
export type Output<K extends Operation> = operations[K] extends { responses: infer R } ? Json<Success<R>> : never;

/** What every handler gets. `user` and `session` are set for every non-PUBLIC operation. */
export type Ctx = {
  db: PrismaClient;
  config: Config;
  mailer: Mailer;
  now: Date;
  ip: string;
  user?: User;
  session?: Session;
};
export type Handler<K extends Operation> = (input: Input<K>, ctx: Ctx) => Promise<Output<K>>;
export type Handlers = { [K in Operation]: Handler<K> };

/** The signed-in user; the router guarantees it for every non-PUBLIC operation. */
export const signedIn = (ctx: Ctx) => ({ user: ctx.user!, session: ctx.session! });

export type ContractOperation = {
  operationId: Operation;
  'x-permission': Permission;
  parameters?: ({ $ref: string } | { name: string; in: string; required?: boolean; schema: unknown })[];
  requestBody?: { content: { 'application/json': { schema: unknown } } };
  responses: Record<string, unknown>;
};

/** CONTRACT_PATH, else the nearest contracts/openapi.yaml above this file (works from src/ and dist/,
 * from any working directory: F17). */
function contractPath() {
  if (process.env.CONTRACT_PATH) return resolve(process.env.CONTRACT_PATH);
  for (let dir = dirname(fileURLToPath(import.meta.url)); dirname(dir) !== dir; dir = dirname(dir))
    if (existsSync(resolve(dir, 'contracts/openapi.yaml'))) return resolve(dir, 'contracts/openapi.yaml');
  throw new Error('contracts/openapi.yaml not found; set CONTRACT_PATH.');
}
export const contract = YAML.parse(readFileSync(contractPath(), 'utf8')) as {
  paths: Record<string, Record<string, ContractOperation>>;
  components: {
    parameters: Record<string, { name: string; in: string; required?: boolean; schema: unknown }>;
    schemas: Record<string, unknown> & { ErrorCode: { 'x-http-status-codes': Record<string, number> } };
  };
};
export const schemaRef = (schema: unknown) =>
  JSON.parse(JSON.stringify(schema).replaceAll('"#/components/', '"mailroom#/components/'));
