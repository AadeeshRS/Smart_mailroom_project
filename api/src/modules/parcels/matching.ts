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

/** Verified members whose phone, alternate phone or emails match the label. Two rows are enough to know
 * whether there's exactly one. Every condition is an indexed equality. */
export function contactOwners(tx: Tx, labelPhone: string | null, labelEmail: string | null) {
  const or: Prisma.UserWhereInput[] = [];
  if (labelPhone) or.push({ phone: labelPhone }, { altPhone: labelPhone });
  if (labelEmail) or.push({ email: labelEmail }, { personalEmail: labelEmail });
  if (!or.length) return Promise.resolve([]);
  return tx.user.findMany({ where: { ...matchable, OR: or }, select: { id: true }, take: 2 });
}

const describe = (parcel: Pick<Parcel, 'awb' | 'orderId' | 'carrier'>) =>
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
    body: `${describe(parcel)} is waiting. Bring your college ID to collect it.`,
  });
  return true;
}

/** Plan §4.7 step 2, the contact match: one owner links, several flag AMBIGUOUS for the operator, none leaves
 * the parcel unlinked. Step 1 (member requests) is added in Phase 4. */
export async function findRecipient(tx: Tx, parcel: Parcel, actorId: string) {
  const owners = await contactOwners(tx, parcel.labelPhone, parcel.labelEmail);
  if (owners.length === 1) return link(tx, parcel, owners[0].id, 'CONTACT', actorId);
  if (owners.length > 1 && parcel.matchFlag !== 'AMBIGUOUS')
    await tx.parcel.update({ where: { id: parcel.id }, data: { matchFlag: 'AMBIGUOUS' } });
  return false;
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
