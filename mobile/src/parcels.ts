import type { Schema } from './api/service';

type Carrier = Schema<'Carrier'>;
type Parcel = Schema<'OperatorParcel'>;

export const CARRIERS: Record<Carrier, string> = {
  DELHIVERY: 'Delhivery',
  BLUEDART: 'Blue Dart',
  EKART: 'Ekart',
  AMAZON: 'Amazon',
  DTDC: 'DTDC',
  XPRESSBEES: 'Xpressbees',
  SHADOWFAX: 'Shadowfax',
  INDIA_POST: 'India Post',
  OTHER: 'Other',
};

export const carrierName = (carrier: string | null) => CARRIERS[carrier as Carrier] ?? 'Carrier not known';

/** The code a parcel is known by: its AWB, else its order ID. */
export const parcelCode = (parcel: { awb: string | null; orderId: string | null }) =>
  parcel.awb ?? parcel.orderId ?? '';

/** One line on who a parcel belongs to, for operators. */
export function matchText(parcel: Parcel) {
  const r = parcel.recipient;
  if (r) {
    const how = { REQUEST: 'their request', CONTACT: 'label contact', MANUAL: 'assigned by hand' };
    return `${r.name}${r.idNumber ? ` · ${r.idNumber}` : ''} (${how[parcel.matchSource ?? 'MANUAL']})`;
  }
  if (parcel.matchFlag === 'AMBIGUOUS') return 'Several members match this label. Assign it by hand.';
  if (parcel.matchFlag === 'CONFLICT')
    return 'A request and the label point to different members. Check before assigning.';
  return 'No member matched yet.';
}

/** The operator typed a label phone the API couldn't use (masked or incomplete), so it played no part in matching. */
export const phoneUnused = (draft: Draft, parcel: Parcel) => !!draft.labelPhone.trim() && !parcel.labelPhone;

export type Draft = {
  id: string;
  kind: 'AWB' | 'ORDER_ID';
  code: string;
  otherCode: string;
  carrier: Carrier | 'UNKNOWN';
  labelName: string;
  labelPhone: string;
  labelEmail: string;
  labelHostel: string;
  labelRoom: string;
  shelf: string;
  note: string;
};

/** The intake request for a draft: the code goes in the field its kind says, blank fields are left out. */
export function intakeBody(draft: Draft): Schema<'IntakeInput'> {
  const value = (text: string) => text.trim() || undefined;
  const [awb, orderId] = draft.kind === 'AWB' ? [draft.code, draft.otherCode] : [draft.otherCode, draft.code];
  return {
    id: draft.id,
    awb: value(awb),
    orderId: value(orderId),
    carrier: draft.carrier === 'UNKNOWN' ? undefined : draft.carrier,
    labelName: value(draft.labelName),
    labelPhone: value(draft.labelPhone),
    labelEmail: value(draft.labelEmail),
    labelHostel: value(draft.labelHostel),
    labelRoom: value(draft.labelRoom),
    shelf: draft.shelf.trim(),
    note: value(draft.note),
  };
}

/** A delivery OTP as typed (spaces dropped), or null when blank. */
export const cleanOtp = (text: string) => text.replace(/\s/g, '') || null;

export type RequestDraft = { awb: string; orderId: string; deliveryOtp: string };

/** The create-request body: blank optional fields are left out. */
export const requestBody = (draft: RequestDraft): Schema<'RequestInput'> => ({
  awb: draft.awb.trim(),
  orderId: draft.orderId.trim() || undefined,
  deliveryOtp: cleanOtp(draft.deliveryOtp) ?? undefined,
});

/** Where a member's request stands, in a sentence. */
export function requestText(request: Schema<'MyRequest'>) {
  if (request.status === 'OPEN') return 'Waiting for it to arrive.';
  if (request.status === 'CANCELLED') return 'Cancelled.';
  if (request.status === 'EXPIRED') return 'Expired before it arrived.';
  if (!request.parcel) return 'It arrived. The mailroom is checking it’s yours.';
  return {
    IN_MAILROOM: 'It’s at the mailroom. Collect it from Home.',
    COLLECTED: 'Collected.',
    RETURNED: 'Returned to the sender.',
  }[request.parcel.status];
}

/** A member's ID, hostel and room on one line, for operators. */
export const memberLine = (m: Pick<Schema<'MemberSummary'>, 'idNumber' | 'hostelName' | 'roomNumber'>) =>
  [m.idNumber, m.hostelName, m.roomNumber && `room ${m.roomNumber}`].filter(Boolean).join(' · ');

/** Time left as m:ss, never below 0:00. */
export function countdown(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
