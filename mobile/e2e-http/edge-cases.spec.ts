import { randomInt, randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

process.loadEnvFile('../api/.env.test');
if (new URL(process.env.DATABASE_URL!).pathname !== '/smart_mailroom_test') throw Error('Isolated test DB required');
const API = 'http://127.0.0.1:3100/v1';
const WEB = 'http://127.0.0.1:8082';
const PASSWORD = process.env.SEED_PASSWORD!;
const field = (page: Page, name: string) => page.getByLabel(name, { exact: true }).filter({ visible: true });
async function call(path: string, token?: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  // Bodyless generated operations use POST too; do not send an empty JSON object to them.
  if (body && typeof body === 'object' && !Object.keys(body).length) body = undefined;
  const response = await fetch(API + path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  expect(response.ok, `${path}: ${result.error?.code ?? response.status}`).toBe(true);
  return result;
}
async function emailCode(email: string) {
  let code = '';
  await expect
    .poll(async () => (code = await (await fetch(`http://127.0.0.1:3101/code?email=${email}`)).text()))
    .toMatch(/^\d{6}$/);
  return code;
}
async function member() {
  const email = `edge-${randomUUID()}@college.example`;
  await call('/auth/register', undefined, {
    email,
    password: PASSWORD,
    name: `Edge ${randomUUID().slice(0, 6)}`,
    memberType: 'STUDENT',
    idNumber: `EDGE${randomUUID()}`,
    phone: `9${randomInt(100000000, 999999999)}`,
    acceptPrivacyNotice: true,
  });
  return call('/auth/verify-email', undefined, { email, code: await emailCode(email) });
}
let staffFixture: Promise<{ token: string; email: string }> | undefined;
function staff() {
  return (staffFixture ??= (async () => {
    const admin = await call('/auth/login', undefined, { email: 'admin@college.example', password: PASSWORD });
    const email = `guard-${randomUUID()}@college.example`;
    await call('/admin/users', admin.token, { email, name: 'Edge Guard', role: 'OPERATOR' });
    await call('/auth/reset-password', undefined, { email, code: await emailCode(email), password: PASSWORD });
    const session = await call('/auth/login', undefined, { email, password: PASSWORD });
    return { token: session.token, email };
  })());
}
async function login(page: Page, email: string) {
  await page.goto(WEB + '/login');
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await field(page, 'College email').fill(email);
  await field(page, 'Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}
/** Staff open a member's handover from the Giveaway list; nothing pops up by itself. */
async function giveaway(page: Page, name: string) {
  await page.getByRole('tab', { name: /Giveaway/ }).click();
  await page.getByRole('button', { name: `Hand over to ${name}`, exact: true }).click();
}
async function parcel(token: string, email: string, name: string) {
  return call('/parcels', token, {
    id: randomUUID(),
    awb: `EE${randomInt(100000000, 999999999)}IN`,
    shelf: 'EDGE',
    labelName: name,
    labelEmail: email,
  });
}

test('another phone replacing/cancelling a code invalidates both the member code and the open guard sheet', async ({
  page,
  browser,
}) => {
  const guard = await staff();
  const student = await member();
  await parcel(guard.token, student.user.email, student.user.name);
  await login(page, student.user.email);
  await page.getByRole('button', { name: 'Collect now', exact: true }).click();
  await expect(page.getByLabel(/^Your code /)).toBeVisible();
  const context = await browser.newContext();
  try {
    const counter = await context.newPage();
    await login(counter, guard.email);
    await giveaway(counter, student.user.name);
    await expect(field(counter, 'Code from the member')).toBeVisible();
    const replacement = await call('/me/collection', student.token, {}); // a second phone, same member
    await expect(page.getByLabel(/^Your code /)).toBeHidden();
    await expect(counter.getByText(/This collection is no longer active/)).toBeVisible();
    await expect(counter.getByRole('button', { name: 'Verify code', exact: true })).toHaveCount(0);
    await counter.getByRole('button', { name: 'Close collection', exact: true }).click();
    await counter.getByRole('button', { name: `Hand over to ${student.user.name}`, exact: true }).click();
    await expect(field(counter, 'Code from the member')).toBeVisible();
    await field(counter, 'Code from the member').fill(replacement.otp);
    await counter.getByRole('button', { name: 'Verify code', exact: true }).click();
    await expect(counter.getByText(/Code verified\. Tick/)).toBeVisible();
    await call('/me/collection', student.token, undefined, 'DELETE');
    await expect(counter.getByText(/This collection is no longer active/)).toBeVisible();
  } finally {
    await context.close();
    await call('/me/collection', student.token, undefined, 'DELETE');
  }
});

test('two guards see verification and partial handover updates; a remaining parcel requires a new code', async ({
  page,
  browser,
}) => {
  const guard = await staff();
  const student = await member();
  const first = await parcel(guard.token, student.user.email, student.user.name);
  const second = await parcel(guard.token, student.user.email, 'Different Label Name');
  await login(page, student.user.email);
  await page.getByRole('button', { name: 'Collect now', exact: true }).click();
  const otp = (await page.getByLabel(/^Your code /).textContent())!;
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    const [one, two] = await Promise.all(contexts.map(context => context.newPage()));
    await login(one, guard.email);
    await login(two, guard.email);
    await giveaway(one, student.user.name);
    await giveaway(two, student.user.name);
    await field(one, 'Code from the member').fill(otp);
    await one.getByRole('button', { name: 'Verify code', exact: true }).click();
    await expect(two.getByText(/Code verified\. Tick/)).toBeVisible();
    await two.getByRole('checkbox', { name: `Handed over ${second.awb}`, exact: true }).click();
    await expect(two.getByRole('button', { name: 'Hand over 1 parcel', exact: true })).toBeDisabled();
    await one.getByRole('checkbox', { name: `Handed over ${first.awb}`, exact: true }).click();
    await one.getByRole('button', { name: 'Hand over 1 parcel', exact: true }).click();
    await expect(one.getByText(`Handed over to ${student.user.name}.`, { exact: true })).toBeVisible();
    await expect(two.getByText(/This collection is no longer active/)).toBeVisible();
    await expect(page.getByLabel(/^Your code /)).toBeHidden();
    await expect(page.getByRole('heading', { name: second.awb, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: first.awb, exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Collect now', exact: true })).toBeVisible();
  } finally {
    await Promise.all(contexts.map(context => context.close()));
    await call('/me/collection', student.token, undefined, 'DELETE');
  }
});

test('closing/reopening the camera releases it; a lost save response retries exactly one original parcel', async ({
  page,
}) => {
  const guard = await staff();
  await login(page, guard.email);
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole('button', { name: 'Scan barcode', exact: true }).click();
    await expect(page.locator('video')).toHaveCount(1);
    await page.getByRole('button', { name: 'Type the code instead', exact: true }).click();
    await expect(page.locator('video')).toHaveCount(0);
  }
  const awb = `EE${randomInt(100000000, 999999999)}IN`;
  await field(page, 'AWB or order ID').fill(awb);
  await page.getByRole('button', { name: 'Look up', exact: true }).click();
  await field(page, 'Name').fill('Retry Test');
  await field(page, 'Shelf').fill('ORIGINAL');
  const submitted: string[] = [];
  await page.route('**/v1/parcels', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    submitted.push(route.request().postData()!);
    if (submitted.length === 1) {
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Save parcel', exact: true }).click();
  await expect(page.getByText(/Retry Save parcel with these original details/)).toBeVisible();
  await expect(field(page, 'Shelf')).not.toBeEditable();
  await page.getByRole('button', { name: 'Save parcel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Parcel saved', exact: true })).toBeVisible();
  expect(submitted).toHaveLength(2);
  expect(submitted[1]).toBe(submitted[0]);
  const records = await call(`/parcels?q=${awb}`, guard.token);
  expect(records.items).toHaveLength(1);
  expect(records.items[0].shelf).toBe('ORIGINAL');
});

test('a late profile-save response cannot restore the old member after signing into another account', async ({
  page,
}) => {
  const guard = await staff();
  const student = await member();
  await login(page, student.user.email);
  await page.getByRole('tab', { name: /Profile/ }).click();
  await field(page, 'Room (optional)').fill('LATE-RESPONSE');
  const remotePhone = `9${randomInt(100000000, 999999999)}`;
  await call('/me', student.token, { altPhone: remotePhone }, 'PATCH');
  await expect(field(page, 'Alternate phone (optional)')).toHaveValue(`+91${remotePhone}`);
  await expect(field(page, 'Room (optional)')).toHaveValue('LATE-RESPONSE');
  let release!: () => void;
  let arrived!: () => void;
  const blocked = new Promise<void>(resolve => {
    release = resolve;
  });
  const captured = new Promise<void>(resolve => {
    arrived = resolve;
  });
  await page.route('**/v1/me', async route => {
    if (route.request().method() !== 'PATCH') return route.continue();
    const response = await route.fetch();
    arrived();
    await blocked;
    await route.fulfill({ response });
  });
  try {
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await captured;
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    await field(page, 'College email').fill(guard.email);
    await field(page, 'Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Receive a parcel', exact: true })).toBeVisible();
    const savedResponse = page.waitForResponse(
      response => response.url().endsWith('/v1/me') && response.request().method() === 'PATCH',
    );
    release();
    await savedResponse;
    await page.getByRole('tab', { name: /Profile/ }).click();
    await expect(page.getByText(guard.email, { exact: true })).toBeVisible();
    await expect(page.getByText(student.user.email, { exact: true })).toHaveCount(0);
  } finally {
    release();
  }
});
