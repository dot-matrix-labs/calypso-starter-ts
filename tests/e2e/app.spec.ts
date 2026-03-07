import { test, expect } from '@playwright/test';

test('basic e2e test', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Calypso Weekly/);
});
