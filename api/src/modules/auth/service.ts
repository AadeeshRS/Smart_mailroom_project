import type { CodePurpose, User } from '@prisma/client';
import { signedIn, type Ctx, type Input } from '../../contract.js';
import { fail } from '../../core/errors.js';
import { limit } from '../../core/rate.js';
import { digest, equal, id, otp, passwordHash, passwordValid, secretDigest, token } from '../../core/security.js';
import { rematchFor } from '../parcels/matching.js';
import { profileData, saveProfile, toUser } from '../users/service.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
export const SESSION_MS = 7 * DAY;
const CODE_MS = 10 * MINUTE;
const CODE_ATTEMPTS = 5;
// Per 15-minute window. Per-email limits are strict and fixed; per-IP limits come from config (RATE_*_PER_IP)
// and are loose, because a whole campus can share one public IP.
const WINDOW = 15 * MINUTE;
const LOGINS_PER_EMAIL = 10;
const CODES_PER_EMAIL = 5;
// Same cost as a real hash, so an unknown email takes as long as a wrong password.
const DUMMY_HASH = 'scrypt$16384$8$5$00000000000000000000000000000000$' + '0'.repeat(128);

export const normalEmail = (email: string) => email.trim().toLowerCase();

/** The session for a bearer token, sliding its expiry forward at most once a day. */
export async function authenticate(ctx: Ctx, bearer: string) {
  const found = await ctx.db.session.findUnique({ where: { tokenDigest: digest(bearer) }, include: { user: true } });
  if (!found || found.revokedAt || found.expiresAt <= ctx.now || !found.user.active) return undefined;
  const { user, ...session } = found;
  if (+session.expiresAt - +ctx.now < SESSION_MS - DAY) {
    session.expiresAt = new Date(+ctx.now + SESSION_MS);
    await ctx.db.session.update({ where: { id: session.id }, data: { expiresAt: session.expiresAt } });
  }
  return { user, session };
}

async function startSession(ctx: Ctx, user: User) {
  const bearer = token();
  const expiresAt = new Date(+ctx.now + SESSION_MS);
  await ctx.db.session.create({ data: { id: id('ses'), tokenDigest: digest(bearer), userId: user.id, expiresAt } });
  return { token: bearer, expiresAt: expiresAt.toISOString(), user: await toUser(ctx, user) };
}

const SUBJECTS: Record<CodePurpose, string> = {
  VERIFY: 'Your Smart Mailroom verification code',
  RESET: 'Your Smart Mailroom password code',
};

/** Issue a fresh 6-digit code (only the latest one works) and email it. */
export async function sendCode(ctx: Ctx, user: User, purpose: CodePurpose) {
  await ctx.mailer.send(...(await issueCode(ctx, user, purpose)));
}

async function issueCode(ctx: Ctx, user: User, purpose: CodePurpose): Promise<[string, string, string]> {
  const code = otp();
  const codeId = id('code');
  await ctx.db.$transaction([
    ctx.db.emailCode.updateMany({
      where: { userId: user.id, purpose, consumedAt: null },
      data: { consumedAt: ctx.now },
    }),
    ctx.db.emailCode.create({
      data: {
        id: codeId,
        userId: user.id,
        purpose,
        codeDigest: secretDigest(ctx.config.pepper, codeId, purpose, code),
        expiresAt: new Date(+ctx.now + CODE_MS),
      },
    }),
  ]);
  return [user.email, SUBJECTS[purpose], `Your code is ${code}. It expires in 10 minutes.`];
}

/** Endpoints that always answer 202 don't wait for the email provider, so the slow part of the response
 * doesn't reveal whether an account exists. ponytail: issuing the code (one small transaction) is still
 * awaited; equalise that too if a timing attack on account existence ever matters. */
async function sendQuietly(ctx: Ctx, user: User, purpose: CodePurpose) {
  const email = await issueCode(ctx, user, purpose);
  ctx.mailer.send(...email).catch(error => console.error('Email code not sent:', (error as Error).message));
}

async function limitCodes(ctx: Ctx, email: string) {
  await limit(ctx.db, `code:email:${email}`, CODES_PER_EMAIL, ctx.now, WINDOW);
  await limit(ctx.db, `code:ip:${ctx.ip}`, ctx.config.rates.codesPerIp, ctx.now, WINDOW);
}

/** Check a code. Each check spends one of the code's 5 attempts before comparing, so parallel guesses can't
 * exceed the limit. The code is consumed on success. */
async function useCode(ctx: Ctx, rawEmail: string, purpose: CodePurpose, code: string) {
  const invalid = () => fail('CODE_INVALID', 'That code is wrong or has expired. Request a new one.');
  await limit(ctx.db, `code-check:ip:${ctx.ip}`, ctx.config.rates.codeChecksPerIp, ctx.now, WINDOW);
  const user = await ctx.db.user.findUnique({ where: { email: normalEmail(rawEmail) } });
  const row =
    user &&
    (await ctx.db.emailCode.findFirst({
      where: { userId: user.id, purpose, consumedAt: null, expiresAt: { gt: ctx.now } },
      orderBy: { createdAt: 'desc' },
    }));
  if (!user || !row) return invalid();
  const spent = await ctx.db.emailCode.updateMany({
    where: { id: row.id, consumedAt: null, attempts: { lt: CODE_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (spent.count !== 1 || !equal(secretDigest(ctx.config.pepper, row.id, purpose, code), row.codeDigest))
    return invalid();
  const used = await ctx.db.emailCode.updateMany({
    where: { id: row.id, consumedAt: null },
    data: { consumedAt: ctx.now },
  });
  if (used.count !== 1) return invalid();
  return user;
}

export async function register(input: Input<'register'>, ctx: Ctx) {
  const email = normalEmail(input.email);
  const domain = email.split('@')[1];
  if (!ctx.config.allowedDomains.includes(domain))
    fail('EMAIL_DOMAIN_NOT_ALLOWED', 'Register with your college email address.');
  await limitCodes(ctx, email);
  const existing = await ctx.db.user.findUnique({ where: { email } });
  // A verified account, or an invited operator/admin, is never changed here; same 202 either way.
  if (existing && (existing.emailVerifiedAt || existing.role !== 'MEMBER')) return { ok: true as const };
  const data = {
    ...(await profileData(ctx, input)),
    name: input.name.trim(),
    passwordHash: await passwordHash(input.password),
    createdAt: ctx.now,
  };
  const user = await saveProfile(() =>
    existing
      ? ctx.db.user.update({ where: { id: existing.id }, data })
      : ctx.db.user.create({ data: { ...data, id: id('usr'), email, role: 'MEMBER' } }),
  );
  await sendQuietly(ctx, user, 'VERIFY');
  return { ok: true as const };
}

export async function resendCode(input: Input<'resendCode'>, ctx: Ctx) {
  const email = normalEmail(input.email);
  await limitCodes(ctx, email);
  const user = await ctx.db.user.findUnique({ where: { email } });
  if (user && !user.emailVerifiedAt && user.passwordHash) await sendQuietly(ctx, user, 'VERIFY');
  return { ok: true as const };
}

export async function verifyEmail(input: Input<'verifyEmail'>, ctx: Ctx) {
  const user = await useCode(ctx, input.email, 'VERIFY', input.code);
  if (!user.active) fail('ACCOUNT_DISABLED', 'This account has been deactivated.');
  const verified = await ctx.db.user.update({
    where: { id: user.id },
    data: { emailVerifiedAt: user.emailVerifiedAt ?? ctx.now },
  });
  await rematchFor(ctx.db, verified); // parcels may have arrived before the member verified
  return startSession(ctx, verified);
}

export async function login(input: Input<'login'>, ctx: Ctx) {
  const email = normalEmail(input.email);
  await limit(ctx.db, `login:email:${email}`, LOGINS_PER_EMAIL, ctx.now, WINDOW);
  await limit(ctx.db, `login:ip:${ctx.ip}`, ctx.config.rates.loginPerIp, ctx.now, WINDOW);
  const user = await ctx.db.user.findUnique({ where: { email } });
  const valid = await passwordValid(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user?.passwordHash || !valid) fail('UNAUTHENTICATED', 'Wrong email or password.');
  if (!user.emailVerifiedAt) fail('EMAIL_NOT_VERIFIED', 'Verify your email first. We can send a new code.');
  if (!user.active) fail('ACCOUNT_DISABLED', 'This account has been deactivated.');
  return startSession(ctx, user);
}

export async function forgotPassword(input: Input<'forgotPassword'>, ctx: Ctx) {
  const email = normalEmail(input.email);
  await limitCodes(ctx, email);
  const user = await ctx.db.user.findUnique({ where: { email } });
  if (user?.active) await sendQuietly(ctx, user, 'RESET');
  return { ok: true as const };
}

/** Also how invited operators and admins set their first password, which verifies their email. */
export async function resetPassword(input: Input<'resetPassword'>, ctx: Ctx) {
  const user = await useCode(ctx, input.email, 'RESET', input.code);
  await ctx.db.$transaction([
    ctx.db.user.update({
      where: { id: user.id },
      data: { passwordHash: await passwordHash(input.password), emailVerifiedAt: user.emailVerifiedAt ?? ctx.now },
    }),
    ctx.db.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: ctx.now } }),
  ]);
  return { ok: true as const };
}

export async function logout(ctx: Ctx) {
  const { session } = signedIn(ctx);
  await ctx.db.session.update({ where: { id: session.id }, data: { revokedAt: ctx.now } });
  return { ok: true as const };
}

export async function changePassword(input: Input<'changePassword'>, ctx: Ctx) {
  const { user, session } = signedIn(ctx);
  await limit(ctx.db, `password:${user.id}`, LOGINS_PER_EMAIL, ctx.now, WINDOW);
  if (!(await passwordValid(input.currentPassword, user.passwordHash ?? DUMMY_HASH)))
    fail('VALIDATION', 'Your current password is wrong.');
  await ctx.db.$transaction([
    ctx.db.user.update({ where: { id: user.id }, data: { passwordHash: await passwordHash(input.newPassword) } }),
    ctx.db.session.updateMany({
      where: { userId: user.id, revokedAt: null, id: { not: session.id } },
      data: { revokedAt: ctx.now },
    }),
  ]);
  return { ok: true as const };
}
