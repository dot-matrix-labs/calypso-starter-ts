import { test, expect } from '@playwright/test';

// Playwright captures browser-level network errors (e.g. 401 from /api/auth/me)
// as console 'error' events. These are expected during the auth flow and are
// handled gracefully in JS. Filter them out — we only want to catch real JS errors.
function isExpectedError(msg: string): boolean {
  return msg.includes('favicon') || msg.includes('401') || msg.includes('Unauthorized');
}

test('app loads and shows login screen', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');

  // App shell renders — no blank page or server error
  await expect(page.locator('h1', { hasText: 'Calypso Weekly' })).toBeVisible({ timeout: 10000 });

  // Unauthenticated users see the login form
  await expect(page.locator('input[type="password"]')).toBeVisible();

  // No unexpected JS errors
  expect(consoleErrors.filter((e) => !isExpectedError(e))).toHaveLength(0);
});

test('register and login renders the Calypso layout shell', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');

  const username = `e2e_smoke_${Date.now()}`;

  // Switch to registration form
  await page.getByRole('button', { name: 'Need an account? Register' }).click();

  // Fill credentials and submit
  await page.getByPlaceholder('e.g. KaraSwisher').fill(username);
  await page.getByPlaceholder('••••••••').fill('smokepass123');
  await page.getByRole('button', { name: 'Create Account' }).click();

  // After successful registration the resizable layout shell is shown
  await expect(page.getByRole('heading', { name: 'Main Project' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Team Chat')).toBeVisible();

  // No unexpected JS errors during the session
  expect(consoleErrors.filter((e) => !isExpectedError(e))).toHaveLength(0);
});
