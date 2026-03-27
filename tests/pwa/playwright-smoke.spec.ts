import { expect, test } from '@playwright/test';

test('PWA smoke test loads the app shell', async ({ page }, testInfo) => {
  await page.goto('/');

  if (testInfo.project.name === 'desktop-chrome') {
    await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible();
    await expect(page.getByPlaceholder('••••••••')).toBeVisible();
    return;
  }

  await expect(page.getByRole('heading', { name: 'Instantly Install Mobile App' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Maybe later', exact: true })).toBeVisible();
});
