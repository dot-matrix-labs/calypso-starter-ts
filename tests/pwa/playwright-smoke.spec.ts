import { expect, test } from '@playwright/test';

test('PWA smoke test loads the app shell', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible();
  await expect(page.getByPlaceholder('••••••••')).toBeVisible();
});
