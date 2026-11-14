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
async function login(page: Page, role: 'student' | 'staff') {
  await page
    .getByRole('button', {
      name: role === 'student' ? 'Asha Rao · Student · DEMO1001' : 'Mira Sen · Mailroom staff',
      exact: true,
    })
    .click();
  await page.getByLabel('Demo passcode', { exact: true }).fill(process.env.DEMO_PASSCODE!);
  await page.getByRole('button', { name: 'Sign in to demo', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: role === 'student' ? 'Hello, Asha.' : 'At the mailroom.', exact: true }),
  ).toBeVisible();
}
test('development screens do not render empty text directly inside native Views', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Demonstration login', exact: true })).toBeVisible();
  expect(problems).toEqual([]);
  await login(page, 'student');
  await page.getByRole('button', { name: 'Register an expected order', exact: true }).click();
  await page.getByRole('button', { name: 'Where do I find my order ID?', exact: true }).click();
  await expect(page.getByText(/Open Amazon and go to Your Orders/)).toBeVisible();
  await page.getByRole('button', { name: '‹ Back', exact: true }).click();
  await page.getByRole('tab', { name: /Account/ }).click();
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await login(page, 'staff');
  await page.getByRole('button', { name: 'Receive a parcel', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Classified identifier value', exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Review intake before saving', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review physical intake', exact: true })).toBeVisible();
});
test('button motion settles and respects a live reduced-motion preference change', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  // Exercise a local selection button without submitting an empty login request.
  const button = page.getByRole('button', { name: 'Asha Rao · Student · DEMO1001', exact: true });
  const surface = button.locator('..');
  const scale = () => surface.evaluate(element => new DOMMatrixReadOnly(getComputedStyle(element).transform).a);
  await button.hover();
  await page.mouse.down();
  await expect.poll(scale).toBeLessThan(0.99);
  await page.mouse.up();
  await expect.poll(scale).toBe(1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const heading = page.getByTestId('page-heading-motion').filter({ visible: true });
  await expect(heading).toHaveCSS('opacity', '1');
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
  await login(page, 'student');
  await page.getByRole('button', { name: 'Register an expected order', exact: true }).click();
  await expect(page.getByTestId('page-heading-motion').filter({ visible: true })).toHaveCSS('opacity', '1');
});
