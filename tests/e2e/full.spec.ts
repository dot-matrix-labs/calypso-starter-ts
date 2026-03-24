import { chromium, type Browser, expect as playwrightExpect } from '@playwright/test';
import { afterAll, beforeAll, expect as vitestExpect, test } from 'vitest';
import { startE2EServer, stopE2EServer, type E2EEnvironment } from './environment';

const INVALID_ERROR_PATTERNS = ['favicon', '401', 'Unauthorized'];

let browser: Browser;
let env: E2EEnvironment;

beforeAll(async () => {
  env = await startE2EServer();
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser.close();
  await stopE2EServer(env);
});

function isExpectedError(msg: string) {
  return INVALID_ERROR_PATTERNS.some((pattern) => msg.includes(pattern));
}

test('app loads and shows login screen', async () => {
  const consoleErrors: string[] = [];
  const page = await browser.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto(env.baseUrl, { waitUntil: 'networkidle' });

  await playwrightExpect(page.getByRole('heading', { name: 'Calypso' })).toBeVisible();
  await playwrightExpect(page.getByPlaceholder('••••••••')).toBeVisible();
  vitestExpect(consoleErrors.filter((e) => !isExpectedError(e))).toHaveLength(0);

  await page.close();
});

test('register and login renders the Calypso layout shell', async () => {
  const consoleErrors: string[] = [];
  const page = await browser.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto(env.baseUrl, { waitUntil: 'networkidle' });

  await page.getByRole('button', { name: 'Need an account? Register' }).click();
  const username = `e2e_smoke_${Date.now()}`;
  await page.getByPlaceholder('e.g. yourname').fill(username);
  await page.getByPlaceholder('••••••••').fill('smokepass123');
  await page.getByRole('button', { name: 'Create Account' }).click();

  await playwrightExpect(page.getByRole('heading', { name: 'Main Project' })).toBeVisible({
    timeout: 15_000,
  });
  vitestExpect(consoleErrors.filter((e) => !isExpectedError(e))).toHaveLength(0);

  await page.close();
});
