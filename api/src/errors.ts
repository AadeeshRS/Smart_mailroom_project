import type { components } from '../../contracts/generated/api.js';
export type ErrorCode = components['schemas']['ErrorCode'];
export class DomainError extends Error {
  constructor(readonly code: ErrorCode, message: string, readonly retryable = false) { super(message); }
}
export function fail(code: ErrorCode, message: string): never { throw new DomainError(code, message); }
/** A failed OTP/rate attempt must commit counters, then be returned as an error. */
export class CommittedFailure { constructor(readonly error: DomainError) {} }
