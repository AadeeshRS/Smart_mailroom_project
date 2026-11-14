import { expect, test, type Page } from '@playwright/test';

process.loadEnvFile('../api/.env.test');
let problems: string[];
test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('console', message => {
    if (message.text().includes('Unexpected text node')) problems.push(message.text());
  });
  page.on('pageerror', error => problems.push(error.message));
});
test.afterEach(() => {
  expect(problems).toEqual([]);
});

/** Screens underneath in the navigation stack stay mounted but hidden; only target the visible one. */
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true }).filter({ visible: true });
const heading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true });
async function signIn(page: Page, email: string, password = process.env.SEED_PASSWORD!) {
  await field(page, 'College email').fill(email);
  await field(page, 'Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test('development screens do not render empty text directly inside native Views', async ({ page }) => {
  await page.goto('/');
  await expect(heading(page, 'Sign in')).toBeVisible();
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await expect(heading(page, 'Create your account')).toBeVisible();
  await page.getByRole('radio', { name: 'College staff', exact: true }).click();
  await expect(field(page, 'Staff ID')).toBeVisible();
  await page.getByRole('button', { name: '‹ Back', exact: true }).click();
  await page.getByRole('button', { name: 'Forgot password, or set up an invited account', exact: true }).click();
  await field(page, 'Email').fill('nobody@college.example');
  await page.getByRole('button', { name: 'Email me a code', exact: true }).click();
  await expect(field(page, 'New password')).toBeVisible();
  await page.goto('/verify-email?email=nobody%40college.example');
  await expect(heading(page, 'Check your email')).toBeVisible();
  for (const [role, landing] of [
    ['member', 'Hello, Test'],
    ['operator', 'Receive a parcel'],
    ['admin', 'Receive a parcel'],
  ] as const) {
    await page.goto('/login');
    await signIn(page, `${role}@college.example`);
    await expect(heading(page, landing)).toBeVisible();
    if (role === 'operator') {
      await field(page, 'AWB or order ID').fill('D12345678');
      await page.getByRole('button', { name: 'Look up', exact: true }).click();
      await expect(heading(page, 'Label details')).toBeVisible();
      await page.getByRole('tab', { name: /Parcels/ }).click();
      await expect(heading(page, 'Parcels')).toBeVisible();
    }
    await page.getByRole('tab', { name: /Profile/ }).click();
    await expect(heading(page, 'Profile')).toBeVisible();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(heading(page, 'Sign in')).toBeVisible();
  }
});

test('button motion settles and respects a live reduced-motion preference change', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  // A failed sign-in stays on this screen, so the same button can be pressed again.
  await field(page, 'College email').fill('nobody@college.example');
  await field(page, 'Password').fill('not-a-password');
  const button = page.getByRole('button', { name: 'Sign in', exact: true });
  const surface = button.locator('..');
  const scale = () => surface.evaluate(element => new DOMMatrixReadOnly(getComputedStyle(element).transform).a);
  await button.hover();
  await page.mouse.down();
  await expect.poll(scale).toBeLessThan(0.99);
  await page.mouse.up();
  await expect.poll(scale).toBe(1);
  await expect(page.getByText('Wrong email or password.', { exact: true })).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.getByTestId('page-heading-motion').filter({ visible: true })).toHaveCSS('opacity', '1');
  await button.hover();
  await page.mouse.down();
  const reducedFrames = await surface.evaluate(async element => {
    const values: number[] = [];
    for (let frame = 0; frame < 12; frame++) {
      await new Promise(requestAnimationFrame);
      values.push(new DOMMatrixReadOnly(getComputedStyle(element).transform).a);
    }
    return values;
  });
  expect(reducedFrames.every(value => value === 1)).toBe(true);
  await page.mouse.up();
  // Navigation with reduced motion must leave the content immediately readable.
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await expect(page.getByTestId('page-heading-motion').filter({ visible: true })).toHaveCSS('opacity', '1');
});
