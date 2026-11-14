import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

process.loadEnvFile('../api/.env.test');
if (new URL(process.env.DATABASE_URL!).pathname !== '/smart_mailroom_test')
  throw Error('HTTP browser tests require the isolated PostgreSQL test database.');
/** Screens underneath in the navigation stack stay mounted but hidden; only target the visible one. */
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true }).filter({ visible: true });
const API = 'http://127.0.0.1:3100/v1';
const PASSWORD = process.env.SEED_PASSWORD!;

async function apiCall(path: string, body: unknown, token?: string) {
  const response = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return response.json();
}
/** The latest code the API's console email provider sent to this address. */
async function emailedCode(email: string) {
  let code = '';
  await expect
    .poll(async () => (code = await (await fetch(`http://127.0.0.1:3101/code?email=${email}`)).text()))
    .toMatch(/^\d{6}$/);
  return code;
}
async function signIn(page: Page, email: string, password = PASSWORD) {
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await field(page, 'College email').fill(email);
  await field(page, 'Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}
async function signOut(page: Page) {
  await page.getByRole('tab', { name: /Profile/ }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
}

test('a member registers, verifies their email, stays signed in across a reload and edits their profile', async ({
  page,
}) => {
  const admin = await apiCall('/auth/login', { email: 'admin@college.example', password: PASSWORD });
  const hostel = `Hostel ${Date.now()}`;
  await apiCall('/admin/hostels', { name: hostel }, admin.token);
  const email = `student${Date.now()}@college.example`;

  await page.goto('/');
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await field(page, 'College email').fill(email);
  await field(page, 'Full name').fill('Asha Rao');
  await field(page, 'Password').fill('asha-password-1');
  await field(page, 'Enrollment number').fill(`E2E${Date.now()}`);
  await field(page, 'Phone').fill(`9${String(Date.now()).slice(-9)}`);
  await page.getByRole('radio', { name: hostel, exact: true }).click();
  await field(page, 'Room (optional)').fill('B-214');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Check your email', exact: true })).toBeVisible();

  // Signing in before verifying is refused, with a way to get a new code.
  await page.getByRole('button', { name: '‹ Back', exact: true }).click();
  await signIn(page, email, 'asha-password-1');
  await expect(page.getByText(/Verify your email first/)).toBeVisible();
  await page.getByRole('button', { name: 'Send me a new code', exact: true }).click();
  await field(page, 'Code').fill(await emailedCode(email));
  await page.getByRole('button', { name: 'Verify', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Hello, Asha', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/member$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Hello, Asha', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /Profile/ }).click();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await expect(field(page, 'Room (optional)')).toHaveValue('B-214');
  await expect(page.getByRole('radio', { name: hostel, exact: true })).toBeChecked();

  await field(page, 'Room (optional)').fill('C-101');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(field(page, 'Room (optional)')).toHaveValue('C-101');

  await signOut(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
});

test('each role lands in its own section and is sent back from the others', async ({ page }) => {
  for (const [role, own, other] of [
    ['operator', '/operator/scan', '/admin/parcels'],
    ['admin', '/admin/dashboard', '/member'],
    ['member', '/member', '/operator/parcels'],
  ] as const) {
    await page.goto('/login');
    await signIn(page, `${role}@college.example`);
    await expect(page).toHaveURL(new RegExp(own + '$'));
    await page.goto(other);
    await expect(page).toHaveURL(new RegExp(own + '$'));
    await signOut(page);
  }
});

test('an operator logs a parcel from its label and the member with that phone sees it at home', async ({ page }) => {
  const phone = `8${String(Date.now()).slice(-9)}`;
  const member = await apiCall('/auth/login', { email: 'member@college.example', password: PASSWORD });
  await fetch(API + '/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${member.token}` },
    body: JSON.stringify({ phone }),
  });
  const awb = `EE${String(Date.now()).slice(-9)}IN`;

  await page.goto('/login');
  await signIn(page, 'operator@college.example');
  await field(page, 'AWB or order ID').fill(awb.toLowerCase());
  await page.getByRole('button', { name: 'Look up', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Label details', exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'India Post', exact: true })).toBeChecked();
  await field(page, 'Name').fill('Test Member');
  await field(page, 'Phone').fill(phone);
  await field(page, 'Shelf').fill('E2E');
  await page.getByRole('button', { name: 'Save parcel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Parcel saved', exact: true })).toBeVisible();
  await expect(page.getByText(/^Test Member .*\(label contact\)$/)).toBeVisible();

  // Scanning the same code again warns that it's already logged.
  await page.getByRole('button', { name: 'Scan the next parcel', exact: true }).click();
  await field(page, 'AWB or order ID').fill(awb);
  await page.getByRole('button', { name: 'Look up', exact: true }).click();
  await expect(page.getByText(/Already logged once/)).toBeVisible();
  await page.getByRole('button', { name: '‹ Back', exact: true }).click();
  await signOut(page);

  await signIn(page, 'member@college.example');
  await expect(page.getByRole('heading', { name: awb, exact: true })).toBeVisible();
  await expect(page.getByText(/^India Post · arrived/)).toBeVisible();
  // The arrival notification is on Home too (no push on the web, or on Android in Expo Go); Mark as read clears it.
  const arrival = page.getByText('Your parcel is at the mailroom', { exact: true });
  await expect(arrival).toBeVisible();
  await page.getByRole('button', { name: 'Mark as read', exact: true }).click();
  await expect(arrival).toBeHidden();
});

test('a member requests a parcel with a delivery OTP; the operator sees it when scanning and it links', async ({
  page,
}) => {
  const awb = `TBA${String(Date.now()).slice(-12).padStart(12, '0')}`;
  await page.goto('/login');
  await signIn(page, 'member@college.example');
  await page.getByRole('tab', { name: /Requests/ }).click();
  await field(page, 'AWB / tracking number').fill(awb);
  await field(page, 'Delivery OTP (optional)').fill('48 21');
  await page.getByRole('button', { name: 'Add request', exact: true }).click();
  await expect(page.getByText(`Added ${awb}. Waiting for it to arrive.`, { exact: true })).toBeVisible();
  await signOut(page);

  await signIn(page, 'operator@college.example');
  await field(page, 'AWB or order ID').fill(awb);
  await page.getByRole('button', { name: 'Look up', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Requested by Test Member', exact: true })).toBeVisible();
  await expect(page.getByLabel('Delivery OTP 4 8 2 1', { exact: true })).toHaveText('4821');
  await field(page, 'Phone').fill('98XXXXXX10');
  await field(page, 'Shelf').fill('E2E');
  await page.getByRole('button', { name: 'Save parcel', exact: true }).click();
  await expect(page.getByText(/^Test Member .*\(their request\)$/)).toBeVisible();

  // A masked phone with no request behind it: the operator is told to link the parcel another way.
  await page.getByRole('button', { name: 'Scan the next parcel', exact: true }).click();
  await field(page, 'AWB or order ID').fill(`X${awb}`);
  await page.getByRole('button', { name: 'Look up', exact: true }).click();
  await field(page, 'Phone').fill('98XXXXXX10');
  await page.getByRole('button', { name: 'Save parcel', exact: true }).click();
  await expect(page.getByText(/The phone wasn’t used for matching \(masked or incomplete\)/)).toBeVisible();
  await signOut(page);

  await signIn(page, 'member@college.example');
  await expect(page.getByRole('heading', { name: awb, exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /Requests/ }).click();
  await expect(page.getByText('It’s at the mailroom. Collect it from Home.', { exact: true })).toBeVisible();
});

test('a member taps Collect now; the operator verifies the code, checks the ID card and hands the parcel over', async ({
  page,
}) => {
  // A parcel assigned to the member by hand, whose label carries another name.
  const operator = await apiCall('/auth/login', { email: 'operator@college.example', password: PASSWORD });
  const member = await apiCall('/auth/login', { email: 'member@college.example', password: PASSWORD });
  const awb = `EE${String(Date.now()).slice(-9)}IN`;
  const parcel = await apiCall(
    '/parcels',
    { id: randomUUID(), awb, shelf: 'G1', labelName: 'Somebody Else' },
    operator.token,
  );
  await apiCall(`/parcels/${parcel.id}/assign`, { userId: member.user.id }, operator.token);

  await page.goto('/login');
  await signIn(page, 'member@college.example');
  await page.getByRole('button', { name: 'Collect now', exact: true }).click();
  const otp = (await page.getByLabel(/^Your code /).textContent()) ?? '';
  expect(otp).toMatch(/^\d{6}$/);
  await page.getByRole('button', { name: '‹ Back', exact: true }).click();
  await signOut(page);

  // The operator's app pops the member up by itself.
  await signIn(page, 'operator@college.example');
  await expect(page.getByRole('heading', { name: 'Test Member', exact: true })).toBeVisible();
  await field(page, 'Code from the member').fill(otp);
  await page.getByRole('button', { name: 'Verify code', exact: true }).click();
  await page.getByRole('checkbox', { name: `Handed over ${awb}`, exact: true }).click();
  await expect(page.getByText(/A label name doesn’t match Test Member/)).toBeVisible();
  const handOver = page.getByRole('button', { name: 'Hand over 1 parcel', exact: true });
  await expect(handOver).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Checked ID card', exact: true }).click();
  await handOver.click();
  await expect(page.getByText('Handed over to Test Member.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await signOut(page);

  await signIn(page, 'member@college.example');
  await page.getByRole('tab', { name: /Past/ }).click();
  await expect(page.getByRole('heading', { name: awb, exact: true })).toBeVisible();
});

test('an admin lands on the dashboard, adds an operator and a hostel', async ({ page }) => {
  const stamp = Date.now();
  await page.goto('/login');
  await signIn(page, 'admin@college.example');
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await expect(page.getByLabel(/^Received today: \d+$/)).toBeVisible();
  await expect(page.getByText(/^Waiting by age: /)).toBeVisible();

  await page.getByRole('button', { name: 'Users', exact: true }).click();
  await field(page, 'Email').fill(`op${stamp}@college.example`);
  await field(page, 'Name').fill('New Operator');
  await page.getByRole('button', { name: 'Add and email a code', exact: true }).click();
  await expect(page.getByText(`Added op${stamp}@college.example.`, { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'New Operator', exact: true })).toBeVisible();
  await expect
    .poll(async () => (await fetch(`http://127.0.0.1:3101/code?email=op${stamp}@college.example`)).status)
    .toBe(200);

  await page.getByRole('button', { name: '‹ Back', exact: true }).click();
  await page.getByRole('button', { name: 'Hostels', exact: true }).click();
  await field(page, 'New hostel').fill(`Hostel ${stamp}`);
  await page.getByRole('button', { name: 'Add hostel', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Hostel ${stamp}`, exact: true })).toBeVisible();
  await page.getByRole('button', { name: '‹ Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
});
