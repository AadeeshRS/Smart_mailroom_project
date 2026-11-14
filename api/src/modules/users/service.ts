import type { Hostel, User } from '@prisma/client';
import { signedIn, type Ctx, type Input, type S } from '../../contract.js';
import { uniqueViolation } from '../../core/db.js';
import { fail } from '../../core/errors.js';
import { phone } from '../../core/phone.js';
import { id } from '../../core/security.js';
import { normalEmail, sendCode } from '../auth/service.js';

export async function toUser(ctx: Ctx, user: User & { hostel?: Hostel | null }): Promise<S<'User'>> {
  const hostel =
    user.hostel !== undefined
      ? user.hostel
      : user.hostelId
        ? await ctx.db.hostel.findUnique({ where: { id: user.hostelId } })
        : null;
  return {
    id: user.id,
    role: user.role,
    email: user.email,
    name: user.name,
    active: user.active,
    emailVerified: !!user.emailVerifiedAt,
    memberType: user.memberType,
    idNumber: user.idNumber,
    phone: user.phone,
    altPhone: user.altPhone,
    personalEmail: user.personalEmail,
    hostelId: user.hostelId,
    hostelName: hostel?.name ?? null,
    roomNumber: user.roomNumber,
    createdAt: user.createdAt.toISOString(),
  };
}

const validPhone = (raw: string) => phone(raw) ?? fail('VALIDATION', `"${raw}" isn't a valid phone number.`);

/** The editable profile fields (plan W3), normalised. Registration and PATCH /me both go through here;
 * the contract already rejects email and name on PATCH. */
export async function profileData(ctx: Ctx, input: Input<'updateMe'>) {
  const data: Partial<
    Pick<User, 'memberType' | 'idNumber' | 'phone' | 'altPhone' | 'personalEmail' | 'roomNumber' | 'hostelId'>
  > = {};
  if (input.memberType !== undefined) data.memberType = input.memberType;
  if (input.idNumber !== undefined)
    data.idNumber = input.idNumber.trim().toUpperCase() || fail('VALIDATION', 'ID number is required.');
  if (input.phone !== undefined) data.phone = validPhone(input.phone);
  if (input.altPhone !== undefined) data.altPhone = input.altPhone === null ? null : validPhone(input.altPhone);
  if (input.personalEmail !== undefined) data.personalEmail = input.personalEmail && normalEmail(input.personalEmail);
  if (input.roomNumber !== undefined) data.roomNumber = input.roomNumber?.trim() || null;
  if (input.hostelId !== undefined) {
    if (input.hostelId !== null && !(await ctx.db.hostel.findFirst({ where: { id: input.hostelId, active: true } })))
      fail('VALIDATION', 'Pick a hostel from the list.');
    data.hostelId = input.hostelId;
  }
  return data;
}

/** Run a user write, turning unique-key clashes into clear errors. */
export async function saveProfile<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    const field = uniqueViolation(error);
    if (field === 'phone') fail('PHONE_TAKEN', 'Another account already uses this phone number.');
    if (field === 'idNumber') fail('ID_NUMBER_TAKEN', 'Another account already uses this ID number.');
    if (field === 'email') fail('EMAIL_TAKEN', 'An account with this email already exists.');
    throw error;
  }
}

export const getMe = (ctx: Ctx) => toUser(ctx, signedIn(ctx).user);

export async function updateMe(input: Input<'updateMe'>, ctx: Ctx) {
  const { user } = signedIn(ctx);
  const data = await profileData(ctx, input);
  const updated = await saveProfile(() =>
    ctx.db.user.update({ where: { id: user.id }, data, include: { hostel: true } }),
  );
  return toUser(ctx, updated);
}

// ponytail: case-insensitive substring search scans the user table; add a pg_trgm index past ~50k users.
export async function listUsers(input: Input<'listUsers'>, ctx: Ctx) {
  const term = input.q?.trim();
  const digits = term?.replace(/\D/g, '') ?? '';
  const take = input.limit ?? 20;
  const rows = await ctx.db.user.findMany({
    where: {
      ...(input.role ? { role: input.role } : {}),
      ...(term
        ? {
            OR: [
              { name: { contains: term, mode: 'insensitive' } },
              { email: { contains: term, mode: 'insensitive' } },
              { idNumber: { contains: term, mode: 'insensitive' } },
              ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : []),
            ],
          }
        : {}),
    },
    include: { hostel: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: take + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  const items = await Promise.all(rows.slice(0, take).map(row => toUser(ctx, row)));
  return rows.length > take ? { items, nextCursor: items.at(-1)!.id } : { items };
}

/** Operators and admins are invited: no password until they use the emailed code. */
export async function createUser(input: Input<'createUser'>, ctx: Ctx) {
  const { user: admin } = signedIn(ctx);
  const user = await saveProfile(() =>
    ctx.db.user.create({
      data: { id: id('usr'), email: normalEmail(input.email), name: input.name.trim(), role: input.role },
    }),
  );
  await ctx.db.auditEvent.create({
    data: { id: id('aud'), actorId: admin.id, action: 'USER_CREATED', detail: `${user.id} as ${user.role}` },
  });
  await sendCode(ctx, user, 'RESET');
  return toUser(ctx, user);
}

export async function updateUser(input: Input<'updateUser'>, ctx: Ctx) {
  const { user: admin } = signedIn(ctx);
  if (input.userId === admin.id) fail('SELF_CHANGE', "You can't change your own role or deactivate yourself.");
  return ctx.db.$transaction(async tx => {
    const target = await tx.user.findUnique({ where: { id: input.userId } });
    if (!target) return fail('NOT_FOUND', 'User not found.');
    const losesAdmin =
      target.role === 'ADMIN' && target.active && ((input.role && input.role !== 'ADMIN') || input.active === false);
    if (losesAdmin) {
      // Lock every active admin row so two admins demoting each other can't both succeed.
      const admins = await tx.$queryRaw<unknown[]>`SELECT id FROM "User" WHERE role = 'ADMIN' AND active FOR UPDATE`;
      if (admins.length <= 1) fail('LAST_ADMIN', 'Keep at least one active admin.');
    }
    const updated = await tx.user.update({
      where: { id: target.id },
      data: { role: input.role, active: input.active },
      include: { hostel: true },
    });
    if (input.active === false)
      await tx.session.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: ctx.now } });
    await tx.auditEvent.create({
      data: {
        id: id('aud'),
        actorId: admin.id,
        action: 'USER_UPDATED',
        detail: `${target.id}: ${JSON.stringify({ role: input.role, active: input.active })}`,
      },
    });
    return toUser(ctx, updated);
  });
}
