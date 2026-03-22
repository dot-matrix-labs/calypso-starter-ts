import { expect, test } from '@playwright/test';

test('PWA smoke test loads the app shell', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'MeshMargin' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
  await expect(page.getByPlaceholder('••••••••')).toBeVisible();
});
