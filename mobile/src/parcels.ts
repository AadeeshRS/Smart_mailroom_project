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
