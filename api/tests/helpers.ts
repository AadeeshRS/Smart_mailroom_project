import { after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Ajv } from 'ajv';
import type { Role } from '@prisma/client';
import { createApp, operations } from '../src/app.js';
import { schemaRef, contract, type Input, type Operation, type Output } from '../src/contract.js';
import { config, dedicatedDataset } from '../src/core/config.js';
import { database } from '../src/core/db.js';
import { id, passwordHash } from '../src/core/security.js';
import { truncateAll } from './truncate.js';

export const settings = config();
dedicatedDataset(settings.databaseUrl);
assert.equal(new URL(settings.databaseUrl).pathname, '/smart_mailroom_test', 'Tests only run on the local test DB.');
export const db = database(settings.databaseUrl);
export const clock = { now: Date.now() };
export const mail: { to: string; subject: string; text: string }[] = [];
export const mailer = {
  send: async (to: string, subject: string, text: string) => void mail.push({ to, subject, text }),
};
export const app = await createApp(db, settings, { now: () => new Date(clock.now), mailer });
after(async () => {
  await app.close();
  await db.$disconnect();
});

export const PASSWORD = 'correct-horse-battery';
const hash = await passwordHash(PASSWORD);

/** Empty every table and restart the clock and mailbox. */
export async function reset() {
  await truncateAll(db);
  mail.length = 0;
  clock.now = Date.now();
}

const ajv = new Ajv({ strict: false });
(createRequire(import.meta.url)('ajv-formats') as (a: Ajv) => void)(ajv);
ajv.addSchema({ $id: 'mailroom', components: contract.components });

export type Reply<K extends Operation> = { status: number; body: Output<K> };

/** Call an operation over HTTP (in-process). Success bodies must match the contract's response schema. */
export async function call<K extends Operation>(operation: K, input: Input<K>, token?: string): Promise<Reply<K>> {
  const route = operations.find(o => o.operationId === operation)!;
  const fields = { ...input } as Record<string, unknown>;
  const path = route.path.replaceAll(/\{(\w+)\}/g, (_match, name: string) => {
    const value = String(fields[name]);
    delete fields[name];
    return encodeURIComponent(value);
  });
  const query = new URLSearchParams();
  for (const p of route.parameters.filter(p => p.in === 'query'))
    if (fields[p.name] !== undefined) {
      query.set(p.name, String(fields[p.name]));
      delete fields[p.name];
    }
  const response = await app.inject({
    method: route.method,
    url: '/v1' + path + (query.size ? '?' + query : ''),
    headers: token ? { authorization: 'Bearer ' + token } : {},
    ...(route.requestBody ? { payload: fields } : {}),
  });
  assert.equal(response.headers['cache-control'], 'no-store');
  const body = response.json();
  const success = Object.keys(route.responses).find(code => /^2\d\d$/.test(code))!;
  if (String(response.statusCode) === success) {
    const declared = route.responses[success] as { $ref?: string };
    const validate = ajv.compile(
      declared.$ref
        ? { $ref: 'mailroom' + declared.$ref + '/content/application~1json/schema' }
        : schemaRef(
            (declared as { content: { 'application/json': { schema: unknown } } }).content['application/json'].schema,
          ),
    );
    assert.ok(validate(body), `${operation} response breaks the contract: ${JSON.stringify(validate.errors)}`);
  }
  return { status: response.statusCode, body };
}

/** Assert a call succeeded and return its body. */
export async function ok<K extends Operation>(operation: K, input: Input<K>, token?: string) {
  const reply = await call(operation, input, token);
  assert.ok(reply.status < 300, `${operation} failed: ${reply.status} ${JSON.stringify(reply.body)}`);
  return reply.body as Output<K>;
}

/** Assert a call failed with this error code. */
export async function fails<K extends Operation>(operation: K, input: Input<K>, code: string, token?: string) {
  const reply = await call(operation, input, token);
  assert.equal(
    (reply.body as { error?: { code: string } }).error?.code,
    code,
    `${operation}: expected ${code}, got ${reply.status} ${JSON.stringify(reply.body)}`,
  );
  return reply.status;
}

/** The latest 6-digit code emailed to this address. */
export const codeFor = (email: string) =>
  /\b(\d{6})\b/.exec(mail.findLast(m => m.to === email)?.text ?? '')?.[1] ?? assert.fail(`No code mailed to ${email}`);

let counter = 0;
/** A verified, active user with PASSWORD, signed in. */
export async function signIn(role: Role, data: { email?: string; phone?: string } = {}) {
  const email = data.email ?? `${role.toLowerCase()}${++counter}@college.example`;
  const user = await db.user.create({
    data: {
      id: id('usr'),
      email,
      name: `${role} ${counter}`,
      role,
      passwordHash: hash,
      emailVerifiedAt: new Date(clock.now),
      phone: data.phone,
    },
  });
  const session = await ok('login', { email, password: PASSWORD });
  return { user, token: session.token };
}
