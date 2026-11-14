import { expect, it } from 'vitest';
import {
  carrierName,
  cleanOtp,
  countdown,
  intakeBody,
  matchText,
  memberLine,
  parcelCode,
  phoneUnused,
  requestBody,
  requestText,
  type Draft,
} from '../src/parcels';

const draft: Draft = {
  id: '6f1c2b8e-3d4a-4f5b-9c7d-8e9f0a1b2c3d',
  kind: 'AWB',
  code: 'EE123456789IN',
  otherCode: ' ',
  carrier: 'INDIA_POST',
  labelName: ' Asha Rao ',
  labelPhone: '98765 43210',
  labelEmail: '',
  labelHostel: '',
  labelRoom: 'B-214',
  shelf: ' A3 ',
  note: '',
};

it('puts the code in the field its kind says and leaves blanks out', () => {
  expect(intakeBody(draft)).toEqual({
    id: draft.id,
    awb: 'EE123456789IN',
    orderId: undefined,
    carrier: 'INDIA_POST',
    labelName: 'Asha Rao',
    labelPhone: '98765 43210',
    labelEmail: undefined,
    labelHostel: undefined,
    labelRoom: 'B-214',
    shelf: 'A3',
    note: undefined,
  });
  const order = intakeBody({ ...draft, kind: 'ORDER_ID', code: 'OD1', otherCode: 'X9', carrier: 'UNKNOWN' });
  expect([order.awb, order.orderId, order.carrier]).toEqual(['X9', 'OD1', undefined]);
});

it('names carriers and parcels for people', () => {
  expect([carrierName('BLUEDART'), carrierName(null), carrierName('NEW_ONE')]).toEqual([
    'Blue Dart',
    'Carrier not known',
    'Carrier not known',
  ]);
  expect([parcelCode({ awb: 'A1', orderId: 'O1' }), parcelCode({ awb: null, orderId: 'O1' })]).toEqual(['A1', 'O1']);
});

it('says who a parcel belongs to, or why it has nobody', () => {
  const base = {
    id: 'p',
    awb: 'A1',
    orderId: null,
    carrier: null,
    labelName: null,
    labelPhone: null,
    labelEmail: null,
    labelHostel: null,
    labelRoom: null,
    shelf: 'A1',
    note: null,
    status: 'IN_MAILROOM',
    recipient: null,
    matchSource: null,
    matchFlag: null,
    receivedAt: '2026-11-14T00:00:00.000Z',
    receivedBy: 'Op',
    collectedAt: null,
  } as const;
  const recipient = {
    id: 'u',
    name: 'Asha',
    email: 'a@x',
    idNumber: '23CS1',
    phone: null,
    hostelName: null,
    roomNumber: null,
  };
  expect(matchText({ ...base, recipient, matchSource: 'CONTACT' })).toBe('Asha · 23CS1 (label contact)');
  expect(matchText({ ...base, matchFlag: 'AMBIGUOUS' })).toMatch(/Several members/);
  expect(matchText(base)).toBe('No member matched yet.');
  // A typed phone the API dropped (masked) is flagged; a used one or a blank one isn't.
  expect(phoneUnused(draft, base)).toBe(true);
  expect(phoneUnused(draft, { ...base, labelPhone: '+919876543210' })).toBe(false);
  expect(phoneUnused({ ...draft, labelPhone: ' ' }, base)).toBe(false);
});

it('builds request bodies and says where a request stands', () => {
  expect(requestBody({ awb: ' EE1 ', orderId: ' ', deliveryOtp: ' 48 21 ' })).toEqual({
    awb: 'EE1',
    orderId: undefined,
    deliveryOtp: '4821',
  });
  expect(cleanOtp('  ')).toBe(null);
  const request = {
    id: 'r',
    awb: 'EE1',
    orderId: null,
    carrier: null,
    deliveryOtp: null,
    status: 'MATCHED',
    createdAt: '2026-11-14T00:00:00.000Z',
    expiresAt: '2026-12-14T00:00:00.000Z',
  } as const;
  const parcel = {
    id: 'p',
    awb: 'EE1',
    orderId: null,
    carrier: null,
    receivedAt: request.createdAt,
    collectedAt: null,
  };
  expect(requestText(request)).toMatch(/checking it’s yours/);
  expect(requestText({ ...request, parcel: { ...parcel, status: 'IN_MAILROOM' } })).toMatch(/Collect it from Home/);
  expect(requestText({ ...request, status: 'OPEN' })).toBe('Waiting for it to arrive.');
});

it('formats a countdown and a member line', () => {
  expect([countdown(899_001), countdown(60_000), countdown(-5)]).toEqual(['15:00', '1:00', '0:00']);
  expect(memberLine({ idNumber: '23CS1', hostelName: null, roomNumber: 'B-2' })).toBe('23CS1 · room B-2');
});
