import { expect, test, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
process.loadEnvFile('../api/.env.test');
if (new URL(process.env.DATABASE_URL!).pathname !== '/smart_mailroom_test') throw Error('HTTP browser tests require isolated PostgreSQL test database.');
const { Pool } = createRequire(resolve('../api/package.json'))('pg') as { Pool: new (options: { connectionString: string }) => { query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, string>[] }>; end(): Promise<void> } };
const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
let staffId = '';
async function sql(query: string, values?: unknown[]) { return (await pool.query(query, values)).rows; }
async function login(page: Page, who: 'asha' | 'neel' | 'staff') {
  await page.getByRole('button', { name: who === 'asha' ? 'Asha Rao · Student · DEMO1001' : who === 'neel' ? 'Neel Shah · Student · DEMO1002' : 'Mira Sen · Mailroom staff', exact: true }).click();
  await page.getByLabel('Demo passcode', { exact: true }).fill(process.env.DEMO_PASSCODE!);
  await page.getByRole('button', { name: 'Sign in to demo', exact: true }).click();
  await expect(page.getByRole('heading', { name: who === 'staff' ? 'At the mailroom.' : who === 'asha' ? 'Hello, Asha.' : 'Hello, Neel.', exact: true })).toBeVisible();
}
async function logout(page: Page) { await page.getByRole('tab', { name: /Account/ }).click(); await expect(page.getByRole('heading', { name: 'Connection simulation', exact: true })).toHaveCount(0); await page.getByRole('button', { name: 'Log out', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Demonstration login', exact: true })).toBeVisible(); }
async function ready(page: Page) {
  await page.goto('/'); await expect(page.getByText('HTTP DEMO · POSTGRESQL · SYNTHETIC DATA ONLY', { exact: true }).first()).toBeVisible(); await login(page, 'asha');
  await page.getByRole('button', { name: 'Register an expected order', exact: true }).click();
  await page.getByRole('button', { name: 'Where do I find my order ID?', exact: true }).click(); await expect(page.getByText(/Open Amazon and go to Your Orders/)).toBeVisible();
  await page.getByRole('textbox', { name: 'Merchant order ID', exact: true }).fill('AMZ-HTTP-JOURNEY'); await page.getByRole('button', { name: 'Create expected order', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Order details', exact: true })).toBeVisible(); const orderId = new URL(page.url()).pathname.split('/').at(-1)!;
  await page.getByRole('button', { name: '‹ Back', exact: true }).click(); await logout(page); await login(page, 'staff');
  await page.getByRole('button', { name: 'Receive a parcel', exact: true }).click(); await page.getByRole('radio', { name: 'Order id', exact: true }).click();
  await page.getByRole('textbox', { name: 'Classified identifier value', exact: true }).fill('AMZ-HTTP-JOURNEY');
  await page.getByRole('textbox', { name: 'Label college email (if printed)', exact: true }).fill('asha@students.example.invalid');
  await page.getByRole('textbox', { name: 'Parcel description', exact: true }).fill('HTTP PostgreSQL parcel'); await page.getByRole('textbox', { name: 'Storage location', exact: true }).fill('C3');
  await page.getByRole('textbox', { name: 'Unique physical parcel reference', exact: true }).fill('HTTP-PHYSICAL-ONE');
  await page.getByRole('button', { name: 'Review intake before saving', exact: true }).click(); await page.getByRole('checkbox', { name: 'I reviewed the physical label, identifier classification, recipient evidence and storage location', exact: true }).click(); await page.getByRole('button', { name: 'Save intake and evaluate match', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Verify collection credential', exact: true })).toBeVisible(); const parcelId = new URL(page.url()).pathname.split('/').at(-1)!;
  expect((await sql('SELECT "orderId", "status" FROM "Parcel" WHERE id=$1', [parcelId]))[0]).toEqual({ orderId, status: 'AWAITING_COLLECTION' });
  await page.getByRole('button', { name: '‹ Back', exact: true }).click(); await logout(page); await login(page, 'asha'); await page.getByRole('tab', { name: /Inbox/ }).click();
  await expect(page.getByRole('heading', { name: 'Your parcel has arrived', exact: true })).toBeVisible(); await page.getByRole('button', { name: /^Mark ntf_.* as read$/ }).click(); await expect(page.getByText('Read', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: `Open parcel ${parcelId}`, exact: true }).click(); await page.getByRole('button', { name: 'Show collection OTP / QR', exact: true }).click(); await page.getByRole('button', { name: 'Request collection code', exact: true }).click();
  const otp = await page.getByLabel('Collection OTP', { exact: true }).innerText(); await expect(page.getByLabel('Collection QR code', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '‹ Back', exact: true }).click(); await page.getByRole('button', { name: '‹ Back', exact: true }).click(); await logout(page); await login(page, 'staff');
  await page.getByRole('tab', { name: /Parcels/ }).click(); await page.getByRole('button', { name: `View parcel ${parcelId}`, exact: true }).click(); await page.getByRole('button', { name: 'Verify collection credential', exact: true }).click();
  await page.getByRole('textbox', { name: 'Six-digit collection OTP', exact: true }).fill(otp); await page.getByRole('button', { name: 'Verify OTP', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Confirm physical handover', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Simulate a lost confirmation response once', exact: true })).toHaveCount(0);
  return { parcelId, orderId, otp };
}
test.beforeEach(async ({ request }) => {
  staffId = (await sql('SELECT id FROM "User" WHERE role=$1', ['STAFF']))[0].id;
  expect(staffId).not.toBe('usr_staff');
  const session = await request.post('http://127.0.0.1:3100/v1/demo/sessions', { data: { accountId: staffId, passcode: process.env.DEMO_PASSCODE } }); expect(session.status()).toBe(200);
  const reset = await request.post('http://127.0.0.1:3100/v1/demo/reset', { headers: { Authorization: `Bearer ${(await session.json()).token}` } }); expect(reset.status()).toBe(200);
});
test.afterAll(async () => { await pool.end(); });
test('actual HTTP/PostgreSQL student-to-staff journey persists handover, read state and searchable closed history', async ({ page, request }) => {
  const failures: string[] = []; page.on('pageerror', e => failures.push(e.message)); const { parcelId, otp } = await ready(page);
  await expect(page.getByRole('button', { name: 'Confirm handover and save receipt', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'I checked the student and parcel details and physically handed over this exact parcel', exact: true }).click(); await page.getByRole('button', { name: 'Confirm handover and save receipt', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Physical handover recorded', exact: true })).toBeVisible();
  const receiptId = new URL(page.url()).pathname.split('/').at(-1)!;
  expect((await sql('SELECT count(*)::text AS count FROM "Handover" WHERE "parcelId"=$1', [parcelId]))[0].count).toBe('1'); expect((await sql('SELECT status FROM "Parcel" WHERE id=$1', [parcelId]))[0].status).toBe('CLOSED');
  await page.reload(); await login(page, 'staff'); await page.getByRole('tab', { name: /Parcels/ }).click(); await page.getByRole('textbox', { name: 'Search parcels', exact: true }).fill(parcelId); await page.getByRole('radio', { name: 'Closed', exact: true }).click(); await page.getByRole('button', { name: `View parcel ${parcelId}`, exact: true }).click(); await page.getByRole('button', { name: 'View retained handover receipt', exact: true }).click();
  expect(new URL(page.url()).pathname).toBe(`/receipt/${receiptId}`);
  const auth = await request.post('http://127.0.0.1:3100/v1/demo/sessions', { data: { accountId: staffId, passcode: process.env.DEMO_PASSCODE } });
  const reuse = await request.post(`http://127.0.0.1:3100/v1/parcels/${parcelId}/verifications`, { headers: { Authorization: `Bearer ${(await auth.json()).token}` }, data: { method: 'OTP', otp } }); expect(reuse.status()).toBe(409); expect((await reuse.json()).error.code).toBe('ALREADY_COLLECTED'); expect(failures).toEqual([]);
});
test('actual committed response loss recovers after real verification expiry, API process restart and browser reload', async ({ page, request }) => {
  const { parcelId } = await ready(page); let original: Record<string, unknown> | undefined;
  await page.route('**/v1/parcels/*/handover', async route => { original = route.request().postDataJSON(); const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort('failed'); });
  await page.getByRole('checkbox', { name: 'I checked the student and parcel details and physically handed over this exact parcel', exact: true }).click(); await page.getByRole('button', { name: 'Confirm handover and save receipt', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Recover original confirmation', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('NETWORK');
  await expect.poll(async () => (await sql('SELECT count(*)::text AS count FROM "Handover" WHERE "parcelId"=$1', [parcelId]))[0].count).toBe('1');
  const receiptId = (await sql('SELECT id FROM "Handover" WHERE "parcelId"=$1', [parcelId]))[0].id;
  await page.unroute('**/v1/parcels/*/handover');
  // Actual elapsed wall time against the real server clock; no mocked browser time.
  await new Promise(resolve => setTimeout(resolve, 121_000));
  expect((await sql('SELECT ("expiresAt" < now())::text AS expired FROM "Verification" WHERE id=$1', [original!.verificationId]))[0].expired).toBe('true');
  expect((await request.post('http://127.0.0.1:3101/restart')).status()).toBe(200);
  await page.reload(); await login(page, 'staff'); await page.getByRole('button', { name: `Recover confirmation ${parcelId}`, exact: true }).click(); await page.getByRole('button', { name: 'Retry original confirmation', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Physical handover recorded', exact: true })).toBeVisible(); expect(new URL(page.url()).pathname).toBe(`/receipt/${receiptId}`);
  expect((await sql('SELECT count(*)::text AS count FROM "Handover" WHERE "parcelId"=$1', [parcelId]))[0].count).toBe('1');
  const record = (await sql('SELECT key FROM "Idempotency" WHERE operation=$1', ['confirmHandover']))[0]; expect(record.key).toBe(original!.idempotencyKey);
  const keys = await page.evaluate(() => Object.keys(localStorage)); expect(keys.some(k => k.includes(encodeURIComponent('http:http://127.0.0.1:3100/v1')) && k.endsWith(':' + staffId))).toBe(true);
});
test('expired ordinary recovery inspects PostgreSQL records without POST and requires an explicit separately reviewed operation', async ({ page }) => {
  const ashaId = (await sql('SELECT id FROM "User" WHERE "studentNumber"=$1', ['DEMO1001']))[0].id;
  await page.goto('/'); await login(page, 'asha'); await page.getByRole('button', { name: 'Register an expected order', exact: true }).click();
  await page.getByRole('textbox', { name: 'Merchant order ID', exact: true }).fill('AMZ-EXPIRED-ORIGINAL');
  await page.route('**/v1/orders', async route => { if (route.request().method() !== 'POST') return route.continue(); const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort('failed'); });
  await page.getByRole('button', { name: 'Create expected order', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('NETWORK');
  expect((await sql('SELECT count(*)::text AS count FROM "ExpectedOrder"'))[0].count).toBe('1'); await page.unroute('**/v1/orders');
  const original = await page.evaluate(account => {
    const key = Object.keys(localStorage).find(k => k.startsWith('smart-mailroom-http-writes-v1:') && k.endsWith(':' + account))!;
    const records = JSON.parse(localStorage.getItem(key)!); records[0].createdAt = new Date(Date.now() - 86_400_001).toISOString(); localStorage.setItem(key, JSON.stringify(records)); return records[0];
  }, ashaId);
  let posted = 0; page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/v1/orders') posted++; });
  await page.reload(); await login(page, 'asha'); await expect(page.getByRole('heading', { name: 'Recovery protection expired', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Recover original createOrder', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Inspect existing records for createOrder', exact: true }).click();
  await expect(page.getByText('Read-only current server records. Compare identifiers and physical references.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retain original and review new createOrder', exact: true })).toBeDisabled(); expect(posted).toBe(0);
  await page.getByRole('checkbox', { name: 'I inspected the original request and current records and will explicitly review a separate new operation', exact: true }).click(); await page.getByRole('button', { name: 'Retain original and review new createOrder', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Register an order', exact: true })).toBeVisible(); expect(posted).toBe(0);
  await page.getByRole('textbox', { name: 'Merchant order ID', exact: true }).fill('AMZ-EXPLICITLY-REVIEWED-NEW'); await page.getByRole('button', { name: 'Create expected order', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Order details', exact: true })).toBeVisible(); expect(posted).toBe(1);
  expect((await sql('SELECT count(*)::text AS count FROM "ExpectedOrder"'))[0].count).toBe('2');
  const archived = await page.evaluate(account => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('smart-mailroom-http-writes-v1:') && k.endsWith(':' + account))!)!), ashaId);
  expect(archived).toHaveLength(1); expect(archived[0].request).toEqual(original.request); expect(archived[0].createdAt).toBe(original.createdAt); expect(archived[0].reviewedAt).toBeDefined();
});
