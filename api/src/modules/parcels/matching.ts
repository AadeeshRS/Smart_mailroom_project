import type { MatchSource, Parcel, Prisma, PrismaClient, User } from '@prisma/client';
import { id } from '../../core/security.js';
import { queue } from '../notifications/service.js';

type Tx = Prisma.TransactionClient;

/** Only active members with a verified email can receive parcels (plan §4.7). */
export const matchable = {
  role: 'MEMBER',
  active: true,
  emailVerifiedAt: { not: null },
} satisfies Prisma.UserWhereInput;

/** Verified members whose phone, alternate phone or emails match the label (narrowed by `also`). Two rows
 * are enough to know whether there's exactly one. Every condition is an indexed equality. */
export function contactOwners(
  tx: Tx,
  labelPhone: string | null,
  labelEmail: string | null,
  also: Prisma.UserWhereInput = {},
) {
  const or: Prisma.UserWhereInput[] = [];
  if (labelPhone) or.push({ phone: labelPhone }, { altPhone: labelPhone });
  if (labelEmail) or.push({ email: labelEmail }, { personalEmail: labelEmail });
  if (!or.length) return Promise.resolve([]);
  return tx.user.findMany({ where: { ...matchable, ...also, OR: or }, select: { id: true, name: true }, take: 2 });
}

export const describe = (parcel: Pick<Parcel, 'awb' | 'orderId' | 'carrier'>) =>
  `Your ${parcel.carrier ? parcel.carrier.replace('_', ' ').toLowerCase() + ' ' : ''}parcel ${parcel.awb ?? parcel.orderId}`;

/** Link a parcel to a member unless someone already has it (conditional update: two links racing can't both
 * win), then audit it and queue the arrival notification, all in the caller's transaction. */
export async function link(
  tx: Tx,
  parcel: Pick<Parcel, 'id' | 'awb' | 'orderId' | 'carrier'>,
  userId: string,
  source: MatchSource,
  actorId: string,
) {
  const { count } = await tx.parcel.updateMany({
    where: { id: parcel.id, recipientId: null, status: 'IN_MAILROOM' },
    data: { recipientId: userId, matchSource: source, matchFlag: null },
  });
  if (!count) return false;
  await tx.auditEvent.create({
    data: { id: id('aud'), actorId, parcelId: parcel.id, action: 'LINKED', detail: `${source} match to ${userId}` },
  });
  await queue(tx, {
    userId,
    parcelId: parcel.id,
    type: 'ARRIVAL',
    title: 'Your parcel is at the mailroom',
    body: `${describe(parcel)} is waiting. Open the app and tap Collect now, then bring your college ID.`,
  });
  return true;
}

/** The open request a parcel answers: the one for its AWB, else the only one for its order ID. Requests from
 * members who can no longer receive parcels don't count. */
export async function openRequest(tx: Tx, awb: string | null, orderId: string | null) {
  const where = { status: 'OPEN', user: matchable } satisfies Prisma.ParcelRequestWhereInput;
  const include = { user: { include: { hostel: true } } } satisfies Prisma.ParcelRequestInclude;
  const byAwb = awb ? await tx.parcelRequest.findFirst({ where: { ...where, awb }, include }) : null;
  if (byAwb || !orderId) return byAwb;
  const byOrder = await tx.parcelRequest.findMany({ where: { ...where, orderId }, include, take: 2 });
  return byOrder.length === 1 ? byOrder[0] : null;
}

/** Plan §4.7 step 1: the request is used up (MATCHED, delivery OTP cleared). The parcel links to the
 * requester if the label's contact belongs to nobody or to them (among others); if it belongs only to other
 * members, it's flagged CONFLICT for the operator. False if another intake used the request first. */
export async function claim(
  tx: Tx,
  parcel: Parcel,
  request: { id: string; userId: string; user: { name: string } },
  actorId: string,
) {
  const { count } = await tx.parcelRequest.updateMany({
    where: { id: request.id, status: 'OPEN' },
    data: { status: 'MATCHED', parcelId: parcel.id, deliveryOtp: null },
  });
  if (!count) return false;
  const [theirs] = await contactOwners(tx, parcel.labelPhone, parcel.labelEmail, { id: request.userId });
  const others = theirs ? [] : await contactOwners(tx, parcel.labelPhone, parcel.labelEmail);
  if (!others.length) {
    await link(tx, parcel, request.userId, 'REQUEST', actorId);
    return true;
  }
  await tx.parcel.update({ where: { id: parcel.id }, data: { matchFlag: 'CONFLICT' } });
  await tx.auditEvent.create({
    data: {
      id: id('aud'),
      actorId,
      parcelId: parcel.id,
      action: 'FLAGGED',
      detail: `Requested by ${request.user.name}, but the label contact belongs to ${others.map(o => o.name).join(' and ')}`,
    },
  });
  return true;
}

/** Plan §4.7: an open request wins (step 1); else the contact match (step 2), where one owner links, several
 * flag AMBIGUOUS, none leaves the parcel unlinked. A CONFLICT is the operator's call, so it's left alone. */
export async function findRecipient(tx: Tx, parcel: Parcel, actorId: string) {
  if (parcel.matchFlag === 'CONFLICT') return;
  const request = await openRequest(tx, parcel.awb, parcel.orderId);
  if (request && (await claim(tx, parcel, request, actorId))) return;
  const owners = await contactOwners(tx, parcel.labelPhone, parcel.labelEmail);
  if (owners.length === 1) await link(tx, parcel, owners[0].id, 'CONTACT', actorId);
  else if (owners.length > 1 && parcel.matchFlag !== 'AMBIGUOUS')
    await tx.parcel.update({ where: { id: parcel.id }, data: { matchFlag: 'AMBIGUOUS' } });
}

/** Reverse trigger after a member verifies their email or edits their contacts: re-run matching only for
 * unlinked parcels whose label carries one of their contacts. */
export async function rematchFor(db: PrismaClient, user: User) {
  if (user.role !== 'MEMBER' || !user.active || !user.emailVerifiedAt) return;
  const phones = [user.phone, user.altPhone].filter((v): v is string => !!v);
  const emails = [user.email, user.personalEmail].filter((v): v is string => !!v);
  const parcels = await db.parcel.findMany({
    where: {
      recipientId: null,
      status: 'IN_MAILROOM',
      OR: [{ labelPhone: { in: phones } }, { labelEmail: { in: emails } }],
    },
  });
  for (const parcel of parcels) await db.$transaction(tx => findRecipient(tx, parcel, user.id));
}
