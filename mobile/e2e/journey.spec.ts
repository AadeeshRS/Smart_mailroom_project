import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const evidence = path.resolve('../.scratch/screenshots');
async function screenshot(page: Page, name: string) {
  const banner = page.getByText('DEMO MODE · SYNTHETIC DATA ONLY', { exact: true }).filter({ visible: true }).last();
  await expect(banner).toBeInViewport();
  await expect.poll(async () => (await banner.boundingBox())?.y ?? Infinity).toBeLessThan(60);
  await mkdir(evidence, { recursive: true }); await page.screenshot({ path: path.join(evidence, name), scale: 'css', animations: 'disabled' });
}
async function login(page: Page, who: 'asha' | 'neel' | 'staff') {
  await page.getByRole('button', { name: who === 'asha' ? 'Asha Rao · Student · DEMO1001' : who === 'neel' ? 'Neel Shah · Student · DEMO1002' : 'Mira Sen · Mailroom staff', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in to demo', exact: true }).click();
  await expect(page.getByRole('heading', { name: who === 'staff' ? 'At the mailroom.' : who === 'asha' ? 'Hello, Asha.' : 'Hello, Neel.', exact: true })).toBeVisible();
}
async function logout(page: Page) {
  await page.getByRole('tab', { name: /Account/ }).click();
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A better way to pick up.', exact: true })).toBeVisible();
}
test('complete mobile viewport journey, explicit handover and retained history after reload', async ({ page }) => {
  const failures: string[] = []; page.on('pageerror', error => failures.push(error.message));
  await page.goto('/'); await screenshot(page, '01-demo-login.png'); await login(page, 'asha');
  await page.getByRole('button', { name: 'Register an expected order', exact: true }).click();
  await page.getByRole('button', { name: 'Where do I find my order ID?', exact: true }).click();
  await expect(page.getByText(/Open Amazon and go to Your Orders/)).toBeVisible();
  await page.getByRole('textbox', { name: 'Merchant order ID', exact: true }).fill('AMZ-E2E-1001');
  await page.getByRole('button', { name: 'Create expected order', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Order details', exact: true })).toBeVisible(); await screenshot(page, '02-expected-order.png');
  await page.getByRole('button', { name: '‹ Back', exact: true }).click(); await logout(page); await login(page, 'staff');
  await page.getByRole('button', { name: 'Receive a parcel', exact: true }).click();
  await page.getByRole('radio', { name: 'Order id', exact: true }).click();
  await page.getByRole('textbox', { name: 'Classified identifier value', exact: true }).fill('AMZ-E2E-1001');
  await page.getByRole('textbox', { name: 'Label college email (if printed)', exact: true }).fill('asha@students.example.invalid');
  await page.getByRole('textbox', { name: 'Parcel description', exact: true }).fill('E2E brown box');
  await page.getByRole('textbox', { name: 'Storage location', exact: true }).fill('Rack A2');
  await page.getByRole('textbox', { name: 'Unique physical parcel reference', exact: true }).fill('E2E-BOX-001');
  await page.getByRole('button', { name: 'Review intake before saving', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review physical intake', exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'I reviewed the physical label, identifier classification, recipient evidence and storage location', exact: true }).click();
  await page.getByRole('button', { name: 'Save intake and evaluate match', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Verify collection credential', exact: true })).toBeVisible(); await screenshot(page, '03-matched-intake.png');
  const parcelPath = new URL(page.url()).pathname; const parcelId = parcelPath.split('/').at(-1)!;
  await page.getByRole('button', { name: '‹ Back', exact: true }).click(); await logout(page); await login(page, 'asha');
  await page.getByRole('tab', { name: /Inbox/ }).click();
  await expect(page.getByRole('heading', { name: 'Your parcel has arrived', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Mark ntf_.* as read$/ }).click();
  await expect(page.getByText('Read', { exact: true })).toBeVisible(); await screenshot(page, '04-arrival-inbox.png');
  await page.getByRole('button', { name: `Open parcel ${parcelId}`, exact: true }).click();
  await page.getByRole('button', { name: 'Show collection OTP / QR', exact: true }).click();
  await page.getByRole('button', { name: 'Request collection code', exact: true }).click();
  const otp = await page.getByLabel('Collection OTP', { exact: true }).innerText(); expect(otp).toMatch(/^\d{6}$/);
  await expect(page.getByLabel('Collection QR code', { exact: true })).toBeVisible(); await screenshot(page, '05-collection-credential.png');
  await page.getByText(/^Expires in /).scrollIntoViewIfNeeded();
  await expect(page.getByLabel('Collection QR code', { exact: true })).toBeInViewport({ ratio: 1 }); await screenshot(page, '05b-qr-countdown.png');
  await page.getByRole('button', { name: '‹ Back', exact: true }).click(); await page.getByRole('button', { name: '‹ Back', exact: true }).click(); await logout(page); await login(page, 'staff');
  await page.getByRole('tab', { name: /Parcels/ }).click(); await page.getByRole('button', { name: `View parcel ${parcelId}`, exact: true }).click();
  await page.getByRole('button', { name: 'Verify collection credential', exact: true }).click();
  await page.getByRole('textbox', { name: 'Six-digit collection OTP', exact: true }).fill(otp);
  await page.getByRole('button', { name: 'Verify OTP', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Confirm physical handover', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm handover and save receipt', exact: true })).toBeDisabled(); await screenshot(page, '06-separate-handover-confirmation.png');
  await page.getByRole('checkbox', { name: 'I checked the student and parcel details and physically handed over this exact parcel', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm handover and save receipt', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Physical handover recorded', exact: true })).toBeVisible(); await screenshot(page, '07-retained-receipt.png');
  await page.reload(); await expect(page.getByRole('heading', { name: 'A better way to pick up.', exact: true })).toBeVisible(); await login(page, 'staff');
  await page.getByRole('tab', { name: /Parcels/ }).click(); await page.getByRole('textbox', { name: 'Search parcels', exact: true }).fill(parcelId);
  await page.getByRole('radio', { name: 'Closed', exact: true }).click(); await page.getByRole('button', { name: `View parcel ${parcelId}`, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Verify collection credential', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'View retained handover receipt', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Physical handover recorded', exact: true })).toBeVisible();
  expect(failures).toEqual([]);
});
test('validation, role navigation, camera fallback and simulated network retry', async ({ page }) => {
  await page.clock.install();
  await page.goto('/'); await login(page, 'neel');
  await page.getByRole('button', { name: 'Register an expected order', exact: true }).click(); await page.getByRole('button', { name: 'Create expected order', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Merchant order ID is required'); await page.getByRole('button', { name: '‹ Back', exact: true }).click();
  await expect(page.getByRole('tab', { name: /Intake/ })).toHaveCount(0);
  await page.getByRole('tab', { name: /Account/ }).click(); await page.getByRole('radio', { name: 'Offline', exact: true }).click(); await page.getByRole('tab', { name: /Parcels/ }).click();
  await expect(page.getByRole('alert')).toContainText('NETWORK'); await page.getByRole('button', { name: 'Simulated offline · Tap to reconnect', exact: true }).click(); await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No parcels found', exact: true })).toBeVisible();
  await logout(page); await login(page, 'staff'); await page.getByRole('button', { name: 'Receive a parcel', exact: true }).click(); await page.getByRole('button', { name: 'Scan label barcode / QR', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Scan a parcel label', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use manual label entry', exact: true })).toBeVisible(); await page.clock.runFor(500); await screenshot(page, '08-camera-fallback.png'); await page.getByRole('button', { name: 'Use manual label entry', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Classified identifier value', exact: true })).toBeVisible();
  await page.clock.fastForward('31:00');
  await expect(page.getByRole('heading', { name: 'A better way to pick up.', exact: true })).toBeVisible();
  await expect(page.getByText('Your demonstration session expired. Sign in again.', { exact: true })).toBeVisible();
});
test('simulated camera unavailability and permission denial offer manual fallback', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', { configurable: true, value: async () => [] });
  });
  await page.goto('/'); await login(page, 'staff'); await page.getByRole('button', { name: 'Receive a parcel', exact: true }).click(); await page.getByRole('button', { name: 'Scan label barcode / QR', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Camera unavailable', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Use manual label entry', exact: true }).click();
  await page.evaluate(() => {
    Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', { configurable: true, value: async () => [{ kind: 'videoinput', deviceId: 'simulated-ui-only', label: '', groupId: '' }] });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => { throw new DOMException('Permission denied', 'NotAllowedError'); } });
  });
  await page.getByRole('button', { name: 'Scan label barcode / QR', exact: true }).click();
  await page.getByRole('button', { name: 'Allow camera access', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Camera access was denied or unavailable');
  await page.getByRole('button', { name: 'Use manual label entry', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Classified identifier value', exact: true })).toBeVisible();
});
