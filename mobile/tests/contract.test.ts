import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { URL } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { expect, it } from 'vitest';
import { createMockKernel } from '../src/api/mock';
import { DEMO_PASSCODE } from '../src/api/service';

// Deliberately use the separately installed contract tooling, rather than duplicate schemas.
const { parse } = createRequire(new URL('../../contracts/package.json', import.meta.url))('yaml') as { parse: (source: string) => { components: { schemas: Record<string, object> } } };
const document = parse(readFileSync(new URL('../../contracts/openapi.yaml', import.meta.url), 'utf8'));
const ajv = new Ajv({ strict: false, allErrors: true }); addFormats(ajv);
ajv.addSchema({ $id: 'mailroom', components: document.components });
function conforms(name: string, value: unknown) {
  const validate = ajv.compile({ $ref: `mailroom#/components/schemas/${name}` });
  expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
}
it('mock responses conform at runtime to the canonical OpenAPI schemas', async () => {
  let keyCounter = 0; let saved: string | null = null;
  const kernel = createMockKernel({ getItem: async () => saved, setItem: async (_key, value) => { saved = value; } });
  const student = kernel.client(); const staff = kernel.client();
  conforms('Session', await student.login({ accountId: 'usr_asha', passcode: DEMO_PASSCODE }));
  conforms('Session', await student.getSession({})); await staff.login({ accountId: 'usr_staff', passcode: DEMO_PASSCODE });
  for (const platform of ['AMAZON', 'FLIPKART', 'MYNTRA', 'OTHER'] as const) conforms('Guide', await student.getGuide({ platform }));
  const order = await student.createOrder({ idempotencyKey: 'contract-' + ++keyCounter, platform: 'AMAZON', merchantOrderId: 'CONTRACT-1', tracking: [] }); conforms('ExpectedOrder', order);
  conforms('ExpectedOrder', await student.addTracking({ orderId: order.id, reference: { kind: 'TRACKING', namespace: 'EKART', value: 'TRACK-1' } }));
  conforms('OrderPage', await student.listOrders({})); conforms('ExpectedOrder', await student.getOrder({ orderId: order.id }));
  const parcel = await staff.intakeParcel({ idempotencyKey: 'contract-intake-key', identifiers: [{ kind: 'TRACKING', namespace: 'EKART', value: 'TRACK-1' }], recipientEmail: 'asha@students.example.invalid', recipientStudentNumber: '', recipientName: '', description: 'Contract fixture', storageLocation: 'B1', physicalReference: 'CONTRACT-BOX', source: 'MANUAL', labelReviewed: true });
  conforms('StaffParcel', parcel); conforms('Parcel', await student.getParcel({ parcelId: parcel.id })); conforms('ParcelPage', await staff.listParcels({})); conforms('ParcelReview', await staff.getReview({ parcelId: parcel.id }));
  conforms('NotificationPage', await student.listNotifications({})); const n = (await student.listNotifications({})).items[0]; conforms('Notification', await student.readNotification({ notificationId: n.id }));
  const credential = await student.issueCredential({ parcelId: parcel.id, replace: false, idempotencyKey: 'contract-issue' }); conforms('Credential', credential);
  const verification = await staff.verifyCredential({ parcelId: parcel.id, method: 'QR', qr: credential.qr }); conforms('Verification', verification);
  const confirmation = await staff.confirmHandover({ parcelId: parcel.id, verificationId: verification.id, physicalHandoverConfirmed: true, idempotencyKey: 'contract-confirm' }); conforms('Confirmation', confirmation);
  conforms('Receipt', await student.getReceipt({ receiptId: confirmation.receipt.id })); conforms('ReceiptPage', await staff.listReceipts({}));
  const cancelled = await student.createOrder({ idempotencyKey: 'contract-' + ++keyCounter, platform: 'MYNTRA', merchantOrderId: 'CANCEL-ME', tracking: [] }); conforms('ExpectedOrder', await student.cancelOrder({ orderId: cancelled.id }));
  try { await student.getParcel({ parcelId: 'par_missing' }); } catch (error) { conforms('ErrorEnvelope', (error as { envelope: unknown }).envelope); }
  conforms('Ok', await student.logout({})); conforms('Ok', await staff.resetDemo({}));
});

it('verification schemas reject missing, mixed and wrongly typed credential fields', () => {
  const validate = ajv.compile({ $ref: 'mailroom#/components/schemas/VerifyInput' });
  const qr = { v: 1, credentialRef: 'crd_schema', token: 'synthetic-schema-token' };
  for (const value of [{ method: 'OTP' }, { method: 'QR' }, { method: 'OTP', otp: '012345', qr }, { method: 'QR', qr, otp: '012345' }, { method: 'OTP', otp: 123456 }, { method: 'QR', qr: { ...qr, extra: 'PII' } }]) expect(validate(value), JSON.stringify(value)).toBe(false);
  expect(validate({ method: 'OTP', otp: '012345' })).toBe(true); expect(validate({ method: 'QR', qr })).toBe(true);
});

it('public response schemas reject private staff fields rather than merely hiding them', () => {
  const parcel = ajv.compile({ $ref: 'mailroom#/components/schemas/Parcel' });
  const receipt = ajv.compile({ $ref: 'mailroom#/components/schemas/Receipt' });
  // Valid required fields are checked by the journey above; these projections must also be closed.
  expect(document.components.schemas.Parcel).toHaveProperty('additionalProperties', false);
  expect(document.components.schemas.Receipt).toHaveProperty('additionalProperties', false);
  expect(parcel({ audit: [], recipientEmail: 'private' })).toBe(false);
  expect(receipt({ staffId: 'usr_staff', verificationId: 'ver_private' })).toBe(false);
});
