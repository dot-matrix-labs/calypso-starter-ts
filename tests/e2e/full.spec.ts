import { chromium, type Browser, type Page, expect as playwrightExpect } from '@playwright/test';
import { afterAll, beforeAll, expect as vitestExpect, test } from 'vitest';
import { readFileSync } from 'fs';
import {
  startE2EServer,
  startIsolatedRollbackServer,
  stopE2EServer,
  stopIsolatedRollbackServer,
  type E2EEnvironment,
} from './environment';

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

async function registerAndOpenStudio(page: Page) {
  await registerAndOpenStudioAt(page, env.baseUrl);
}

async function registerAndOpenStudioAt(page: Page, baseUrl: string) {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Need an account? Register' }).click();
  const username = `e2e_studio_${Date.now()}`;
  await page.getByPlaceholder('e.g. yourname').fill(username);
  await page.getByPlaceholder('••••••••').fill('studio-pass-123');
  await page.getByRole('button', { name: 'Create Account' }).click();
  await playwrightExpect(page.getByRole('heading', { name: 'Studio' })).toBeVisible({
    timeout: 15_000,
  });
  await playwrightExpect(page.getByPlaceholder('Describe a change...')).toBeVisible();
}

async function waitForLogContains(message: string): Promise<string> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const log = readFileSync(env.claudeLogPath, 'utf8');
      if (log.includes(message)) return log;
    } catch {
      // File might not yet exist.
    }
    await Bun.sleep(200);
  }
  throw new Error(`Timed out waiting for studio log to include ${message}`);
}

async function waitForLatestPromptContains(message: string): Promise<string> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const log = readFileSync(env.claudeLogPath, 'utf8');
      const prompts = log
        .split('PROMPT: ')
        .map((entry) => entry.trim())
        .filter(Boolean);
      const latestPrompt = prompts.at(-1) ?? '';
      if (latestPrompt.includes(message)) return latestPrompt;
    } catch {
      // File might not yet exist.
    }
    await Bun.sleep(200);
  }
  throw new Error(`Timed out waiting for latest studio prompt to include ${message}`);
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
  await playwrightExpect(page.getByRole('heading', { name: 'Studio' })).toBeVisible();
  vitestExpect(consoleErrors.filter((e) => !isExpectedError(e))).toHaveLength(0);

  await page.close();
});

test('studio chat is available when studio mode is active', async () => {
  const page = await browser.newPage();
  await registerAndOpenStudio(page);
  await playwrightExpect(page.getByText("Describe what you'd like to change.")).toBeVisible();
  await page.close();
});

test('studio chat sends a message and receives the mocked response', async () => {
  const page = await browser.newPage();
  await registerAndOpenStudio(page);
  const message = `Please adjust the header ${Date.now()}`;
  const input = page.getByPlaceholder('Describe a change...');
  const sendButton = page.getByRole('button', { name: 'Send message' });
  await input.fill(message);
  await sendButton.click();
  await playwrightExpect(page.getByText(message)).toBeVisible();
  await playwrightExpect(page.getByText('Mocked Claude response for studio e2e.')).toBeVisible({
    timeout: 10_000,
  });
  await page.close();
});

test('server receives studio chat prompts', async () => {
  const page = await browser.newPage();
  await registerAndOpenStudio(page);
  const message = `Check server receipt ${Date.now()}`;
  const input = page.getByPlaceholder('Describe a change...');
  const sendButton = page.getByRole('button', { name: 'Send message' });
  await input.fill(message);
  await sendButton.click();
  await playwrightExpect(page.getByText('Mocked Claude response for studio e2e.')).toBeVisible({
    timeout: 10_000,
  });
  const log = await waitForLogContains(`Partner: ${message}`);
  vitestExpect(log).toContain(`Partner: ${message}`);
  await page.close();
});

test('studio chat preserves prior turns across multiple messages', async () => {
  const page = await browser.newPage();
  await registerAndOpenStudio(page);

  const firstMessage = `First studio request ${Date.now()}`;
  const secondMessage = `Second studio request ${Date.now()}`;
  const input = page.getByPlaceholder('Describe a change...');
  const sendButton = page.getByRole('button', { name: 'Send message' });

  await input.fill(firstMessage);
  await sendButton.click();
  await playwrightExpect(page.getByText('Mocked Claude response for studio e2e.')).toBeVisible({
    timeout: 10_000,
  });

  await input.fill(secondMessage);
  await sendButton.click();
  await playwrightExpect(page.getByText(secondMessage)).toBeVisible();

  const prompt = await waitForLatestPromptContains(secondMessage);
  vitestExpect(prompt).toContain(`Partner: ${firstMessage}`);
  vitestExpect(prompt).toContain('Agent: Mocked Claude response for studio e2e.');
  vitestExpect(prompt).toContain(`Partner: ${secondMessage}`);

  await page.close();
});

test('studio shows the commit list and preserves it when rollback is cancelled', async () => {
  const isolatedEnv = await startIsolatedRollbackServer();
  const page = await browser.newPage();

  try {
    await registerAndOpenStudioAt(page, isolatedEnv.baseUrl);

    await playwrightExpect(page.getByText('Session commits')).toBeVisible();
    await playwrightExpect(page.getByText('studio: apply rollback target change')).toBeVisible();
    const rollbackButton = page.getByRole('button', { name: 'Rollback commit' }).first();
    await playwrightExpect(rollbackButton).toBeVisible();

    page.once('dialog', async (dialog) => {
      vitestExpect(dialog.message()).toContain('Roll back to commit');
      await dialog.dismiss();
    });

    await rollbackButton.click();

    await playwrightExpect(page.getByText('Session commits')).toBeVisible();
    await playwrightExpect(page.getByText('studio: apply rollback target change')).toBeVisible();
    await playwrightExpect(
      page.getByRole('button', { name: 'Rollback commit' }).first(),
    ).toBeVisible();
  } finally {
    await page.close();
    await stopIsolatedRollbackServer(isolatedEnv);
  }
});

test('studio rollback succeeds through the browser UI against an isolated checkout', async () => {
  const isolatedEnv = await startIsolatedRollbackServer();
  const page = await browser.newPage();

  try {
    await registerAndOpenStudioAt(page, isolatedEnv.baseUrl);

    await playwrightExpect(page.getByText('Session commits')).toBeVisible();
    await playwrightExpect(page.getByText('studio: apply rollback target change')).toBeVisible();
    await playwrightExpect(page.getByText('studio: start session a1b2')).toBeVisible();

    page.once('dialog', async (dialog) => {
      vitestExpect(dialog.message()).toContain('Roll back to commit');
      await dialog.accept();
    });

    await page
      .locator('div.group')
      .filter({ hasText: 'studio: start session a1b2' })
      .getByRole('button', { name: 'Rollback commit' })
      .click();

    await playwrightExpect(page.getByText('studio: apply rollback target change')).not.toBeVisible({
      timeout: 10_000,
    });
    await playwrightExpect(page.getByText('studio: start session a1b2')).toBeVisible();

    const changes = readFileSync(isolatedEnv.studioSession.changesPath, 'utf8');
    vitestExpect(changes).not.toContain('Added a rollback target change.');
    vitestExpect(changes).toContain('Initial studio session.');
  } finally {
    await page.close();
    await stopIsolatedRollbackServer(isolatedEnv);
  }
});
