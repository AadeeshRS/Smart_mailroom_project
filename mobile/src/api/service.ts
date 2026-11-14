import type { components, operations } from '../../../contracts/generated/api';

export type Schema<K extends keyof components['schemas']> = components['schemas'][K];
type Json<T> = T extends { content: { 'application/json': infer V } } ? V : Record<never, never>;
type Params<T, K extends string> = T extends { parameters: infer P }
  ? K extends keyof P
    ? NonNullable<P[K]> extends never
      ? Record<never, never>
      : NonNullable<P[K]>
    : Record<never, never>
  : Record<never, never>;
export type Input<K extends keyof operations> = (operations[K] extends { requestBody: infer B }
  ? Json<B>
  : Record<never, never>) &
  Params<operations[K], 'path'> &
  Params<operations[K], 'query'>;
type Success<R> = R extends { 200: infer V } ? V : R extends { 202: infer V } ? V : never;
export type Output<K extends keyof operations> = operations[K] extends { responses: infer R }
  ? Json<Success<R>>
  : never;
/** One function per contract operation. Who is calling comes from the session token, never the input. */
export type MailroomService = { [K in keyof operations]: (input: Input<K>) => Promise<Output<K>> };

export class ServiceError extends Error {
  readonly envelope: Schema<'ErrorEnvelope'>;
  constructor(
    readonly code: Schema<'ErrorCode'>,
    message: string,
    readonly retryable = false,
    requestId = 'local',
  ) {
    super(message);
    this.name = 'ServiceError';
    this.envelope = { error: { code, message, retryable, requestId } };
  }
}

/** Separates an error's message from its reference line; Feedback renders the line small. */
export const REFERENCE = '\nReference: ';
/** What a screen shows for a failed call: the server's message (written for people), plus the request ID that
 * support can find in the API's logs. Errors made in the app (offline, unreadable answer) have no request ID. */
export function errorText(error: unknown) {
  if (!(error instanceof ServiceError)) return 'Something went wrong. Please try again.';
  const { requestId } = error.envelope.error;
  return requestId === 'local' ? error.message : error.message + REFERENCE + requestId;
}
