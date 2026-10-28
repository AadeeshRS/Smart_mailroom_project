import type { S, Input } from './contract.js';
import type { Context } from './context.js';
import { collection, ownedParcel, rate, remember, replay, revision, staff, student } from './context.js';
import { CommittedFailure, DomainError, fail } from './errors.js';
import { equal, id, otp, secretDigest, token } from './security.js';
import { audit, notify, revoke } from './matching.js';
import { profile, staffParcel, staffReceipt, type P } from './projections.js';

export class Credentials {
  // Deliberately not durable: process loss/session change/expiry => explicit replacement.
  private secrets = new Map<string, { sessionId: string; value: S<'Credential'> }>();
  constructor(private pepper: string, private afterHandover?: () => Promise<void>) {}
  expire(now: Date) { for (const [key, record] of this.secrets) if (Date.parse(record.value.expiresAt) <= +now) this.secrets.delete(key); }
  forgetSession(sessionId: string) { for (const [key, record] of this.secrets) if (record.sessionId === sessionId) this.secrets.delete(key); }
  clear() { this.secrets.clear(); }
  private current(p: P, now: Date) {
    const credential = p.credentials[0];
    if (!credential || credential.state === 'INVALIDATED' || p.credentialState === 'INVALIDATED') fail('CREDENTIAL_INVALIDATED', 'Request an explicit replacement collection credential.');
    if (credential.expiresAt <= now) fail('CREDENTIAL_EXPIRED', 'Collection credential expired.');
    if (credential.state !== 'ACTIVE') fail('INVALID_CREDENTIAL', 'Collection credential is not current.');
    return credential;
  }
  async issue(c: Context, input: Input<'issueCredential'>) {
    student(c); this.expire(c.now); const p = await ownedParcel(c, input.parcelId); collection(p);
    const previous = await replay(c, 'issueCredential', input);
    if (previous.old) {
      const ref = previous.old.result as { credentialId: string };
      const record = this.secrets.get(ref.credentialId);
      if (!record || record.sessionId !== c.session.id || p.credentials[0]?.id !== ref.credentialId || p.credentials[0]?.state !== 'ACTIVE' || Date.parse(record.value.expiresAt) <= +c.now) fail('ISSUANCE_RETRY_UNAVAILABLE', 'Original secrets are unavailable. Explicitly replace with a NEW key and replace=true.');
      return record.value;
    }
    if (!await rate(c.tx, `issue:${c.user.id}:${p.id}`, 6, c.now)) return new CommittedFailure(new DomainError('VALIDATION', 'Credential issuance rate limit reached. Retry after one minute.', true));
    if (p.credentials[0]?.state === 'ACTIVE' && p.credentials[0].expiresAt > c.now && !input.replace) fail('CREDENTIAL_ACTIVE', 'A current credential exists. Explicitly replace it.');
    if (p.credentialState !== 'NONE' && !input.replace) fail('CREDENTIAL_INVALIDATED', 'Explicit replacement requires replace=true and a new key.');
    await revoke(c.tx, p); const ref = id('crd'), code = otp(), qrToken = token();
    const value: S<'Credential'> = { id: ref, parcelId: p.id, otp: code, qr: { v: 1, credentialRef: ref, token: qrToken }, issuedAt: c.now.toISOString(), expiresAt: new Date(+c.now + 600_000).toISOString() };
    await c.tx.credential.create({ data: { id: ref, parcelId: p.id, sessionId: c.session.id, otpDigest: secretDigest(this.pepper, ref, 'otp', code), qrDigest: secretDigest(this.pepper, ref, 'qr', qrToken), issuedAt: c.now, expiresAt: new Date(value.expiresAt) } });
    await c.tx.parcel.update({ where: { id: p.id }, data: { credentialState: 'ACTIVE' } });
    await remember(c, 'issueCredential', input.idempotencyKey, previous.fingerprint, { credentialId: ref });
    this.secrets.set(ref, { sessionId: c.session.id, value }); return value;
  }
  async verify(c: Context, input: Input<'verifyCredential'>) {
    staff(c); const p = await ownedParcel(c, input.parcelId); collection(p);
    if (!await rate(c.tx, `verify:${c.user.id}:${p.id}`, 20, c.now)) return new CommittedFailure(new DomainError('VALIDATION', 'Verification rate limit reached. Retry after one minute.', true));
    const credential = this.current(p, c.now);
    const valid = input.method === 'OTP' ? equal(secretDigest(this.pepper, credential.id, 'otp', input.otp), credential.otpDigest) : input.qr.credentialRef === credential.id && equal(secretDigest(this.pepper, credential.id, 'qr', input.qr.token), credential.qrDigest);
    if (!valid) {
      if (input.method === 'OTP') {
        const attempts = credential.attempts + 1;
        await c.tx.credential.update({ where: { id: credential.id }, data: { attempts, ...(attempts >= 5 ? { state: 'INVALIDATED' } : {}) } });
        if (attempts >= 5) { await revoke(c.tx, p); return new CommittedFailure(new DomainError('ATTEMPTS_EXCEEDED', 'Five failed OTP attempts invalidated this credential. Request replacement.')); }
      }
      return new CommittedFailure(new DomainError('INVALID_CREDENTIAL', 'Credential does not match the current parcel credential.'));
    }
    const verification = await c.tx.verification.create({ data: { id: id('ver'), parcelId: p.id, credentialId: credential.id, parcelRevision: p.revision, staffSessionId: c.session.id, expiresAt: new Date(Math.min(+c.now + 120_000, +credential.expiresAt)) } });
    const user = await c.tx.user.findUniqueOrThrow({ where: { id: p.studentId! } });
    return { id: verification.id, parcelId: p.id, credentialId: credential.id, parcelRevision: p.revision, expiresAt: verification.expiresAt.toISOString(), student: profile(user), parcel: staffParcel(p, c.now) } satisfies S<'Verification'>;
  }
  async confirm(c: Context, input: Input<'confirmHandover'>) {
    staff(c); const previous = await replay(c, 'confirmHandover', input);
    if (previous.old) return { ...(previous.old.result as unknown as S<'Confirmation'>), replayed: true };
    const p = await ownedParcel(c, input.parcelId); collection(p);
    if (!input.physicalHandoverConfirmed) fail('VALIDATION', 'Explicit physical handover confirmation is required.');
    const v = await c.tx.verification.findUnique({ where: { id: input.verificationId } });
    if (!v || v.expiresAt <= c.now || v.consumedAt) fail('VERIFICATION_EXPIRED', 'Verification expired or unavailable. Verify the current credential again.');
    if (v.parcelId !== p.id || v.staffSessionId !== c.session.id) fail('INVALID_CREDENTIAL', 'Verification belongs to a different parcel or staff session.');
    revision(p, v.parcelRevision); const credential = this.current(p, c.now);
    if (v.credentialId !== credential.id) fail('CONCURRENT_CONFLICT', 'Credential changed after verification.');
    const h = await c.tx.handover.create({ data: { id: id('rcp'), parcelId: p.id, orderId: p.orderId!, studentId: p.studentId!, staffId: c.user.id, verificationId: v.id, storageLocation: p.storageLocation, confirmedAt: c.now } });
    await c.tx.credential.update({ where: { id: credential.id }, data: { state: 'CONSUMED' } });
    await c.tx.verification.update({ where: { id: v.id }, data: { consumedAt: c.now } });
    await c.tx.parcel.update({ where: { id: p.id }, data: { status: 'CLOSED', credentialState: 'CONSUMED', revision: { increment: 1 } } });
    await audit(c.tx, p.id, c.user.id, 'HANDOVER_CONFIRMED', `Physical handover explicitly confirmed; receipt ${h.id}.`, c.now);
    await notify(c.tx, p, 'Parcel collected', `Parcel collected. Receipt ${h.id} is retained in history.`, `collection:${p.id}`, c.now);
    const result = { receipt: staffReceipt(h), replayed: false };
    await remember(c, 'confirmHandover', input.idempotencyKey, previous.fingerprint, result, h.id);
    await this.afterHandover?.(); // Dependency-injected rollback test hook; no HTTP endpoint.
    return result;
  }
}
