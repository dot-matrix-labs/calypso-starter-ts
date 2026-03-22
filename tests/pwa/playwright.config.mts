import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'url';

const BASE_URL = `http://127.0.0.1:${Number(process.env.STUDIO_PORT ?? 5174)}`;

const desktopChrome = devices['Desktop Chrome'];
const androidChrome = devices['Pixel 7'];
const iosSafari = devices['iPhone 14'];

if (!desktopChrome || !androidChrome || !iosSafari) {
  throw new Error('Required Playwright device descriptors are unavailable.');
}

export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'bun run dev',
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: {
        ...desktopChrome,
        browserName: 'chromium',
        launchOptions: {
          args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
        },
      },
    },
    {
      name: 'android-chrome',
      use: {
        ...androidChrome,
        browserName: 'chromium',
      },
    },
    {
      name: 'ios-safari',
      use: {
        ...iosSafari,
        browserName: 'chromium',
      },
    },
  ],
});
