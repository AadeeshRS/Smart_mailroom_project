import type { components, operations } from '../../../contracts/generated/api';

export type Schema<K extends keyof components['schemas']> = components['schemas'][K];
type Json<T> = T extends { content: { 'application/json': infer V } } ? V : Record<never, never>;
type Params<T, K extends string> = T extends { parameters: infer P }
  ? K extends keyof P ? NonNullable<P[K]> extends never ? Record<never, never> : NonNullable<P[K]> : Record<never, never>
  : Record<never, never>;
export type Input<K extends keyof operations> =
  (operations[K] extends { requestBody: infer B } ? Json<B> : Record<never, never>) &
  Params<operations[K], 'path'> & Params<operations[K], 'query'>;
export type Output<K extends keyof operations> = operations[K] extends { responses: { 200: infer R } } ? Json<R> : never;
/** The future HTTP adapter implements this interface, mapping generated operations to HTTP.
 * Authentication context belongs to the adapter, never a caller-supplied role/student ID.
 */
export type MailroomService = { [K in keyof operations]: (input: Input<K>) => Promise<Output<K>> };

export class ServiceError extends Error {
  readonly envelope: Schema<'ErrorEnvelope'>;
  constructor(readonly code: Schema<'ErrorCode'>, message: string, readonly retryable = false) {
    super(message);
    this.name = 'ServiceError';
    this.envelope = { error: { code, message, retryable, requestId: 'demo-local' } };
  }
}

export const DEMO_ACCOUNTS = [
  { id: 'usr_asha', name: 'Asha Rao', detail: 'Student · DEMO1001', email: 'asha@students.example.invalid' },
  { id: 'usr_neel', name: 'Neel Shah', detail: 'Student · DEMO1002', email: 'neel@students.example.invalid' },
  { id: 'usr_staff', name: 'Mira Sen', detail: 'Mailroom staff', email: 'mira@staff.example.invalid' },
] as const;
export const DEMO_PASSCODE = 'mailroom-demo';
