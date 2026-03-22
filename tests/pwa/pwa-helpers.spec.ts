import { expect, test } from '@playwright/test';
import {
  androidChrome,
  applyStandaloneDisplayMode,
  desktopChrome,
  iosSafari,
  iosSafariStandalone,
  stubBeforeInstallPrompt,
  stubGetUserMedia,
  stubMediaRecorder,
  stubNotification,
  stubServiceWorker,
  stubStorageManager,
} from '../helpers/pwa';

test('project preset matches the active browser profile', async ({ page }, testInfo) => {
  await page.goto('/');

  const snapshot = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    userAgent: navigator.userAgent,
    standalone: window.matchMedia('(display-mode: standalone)').matches,
  }));

  if (testInfo.project.name === 'desktop-chrome') {
    expect(snapshot.width).toBe(desktopChrome.viewport?.width ?? snapshot.width);
    expect(snapshot.userAgent).toContain('Chrome');
  }

  if (testInfo.project.name === 'android-chrome') {
    expect(snapshot.width).toBe(androidChrome.viewport?.width ?? snapshot.width);
    expect(snapshot.userAgent).toContain('Android');
  }

  if (testInfo.project.name === 'ios-safari') {
    expect(snapshot.height).toBe(iosSafari.viewport?.height ?? snapshot.height);
    expect(snapshot.userAgent).toContain('iPhone');
    expect(snapshot.standalone).toBe(false);
  }
});

test('iosSafariStandalone toggles the standalone display mode override', async ({ page }) => {
  await page.goto('/');
  await applyStandaloneDisplayMode(page, iosSafariStandalone);

  const isStandalone = await page.evaluate(
    () => window.matchMedia('(display-mode: standalone)').matches,
  );

  expect(isStandalone).toBe(true);
});

test('stubBeforeInstallPrompt records prompt usage', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    window.addEventListener(
      'beforeinstallprompt',
      (event) => {
        event.preventDefault();
        (event as Event & { prompt?: () => Promise<void> }).prompt?.();
      },
      { once: true },
    );
  });

  const handle = await stubBeforeInstallPrompt(page);

  expect(await handle.wasPromptCalled()).toBe(true);
});

test('stubGetUserMedia returns a fake stream and records the request', async ({ page }) => {
  await page.goto('/');
  const handle = await stubGetUserMedia(page, { video: true, audio: true });

  const trackCount = await page.evaluate(async () => {
    const stream = await navigator.mediaDevices!.getUserMedia({ video: true, audio: true });
    return stream.getTracks().length;
  });

  expect(trackCount).toBeGreaterThan(0);
  expect(await handle.wasRequested()).toBe(true);
  expect(await handle.lastConstraints()).toEqual({ video: true, audio: true });
});

test('stubMediaRecorder tracks start and stop cycles', async ({ page }) => {
  await page.goto('/');
  const handle = await stubMediaRecorder(page);

  const state = await page.evaluate(async () => {
    const recorder = new MediaRecorder({} as MediaStream);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      chunks.push(event.data);
    };
    recorder.start();
    recorder.requestData();
    recorder.stop();

    return {
      chunks: chunks.length,
      state: recorder.state,
      supported: MediaRecorder.isTypeSupported('audio/webm'),
    };
  });

  expect(state.chunks).toBeGreaterThan(0);
  expect(state.state).toBe('inactive');
  expect(state.supported).toBe(true);
  expect(await handle.wasStarted()).toBe(true);
});

test('stubNotification tracks constructor calls', async ({ page }) => {
  await page.goto('/');
  const handle = await stubNotification(page, 'granted');

  const permission = await page.evaluate(() => {
    new Notification('PWA ready', { body: 'install prompt available' });
    return Notification.permission;
  });

  expect(permission).toBe('granted');
  expect(await handle.wasNotified()).toBe(true);
});

test('stubServiceWorker exposes register and ready', async ({ page }) => {
  await page.goto('/');
  const handle = await stubServiceWorker(page);

  const registration = await page.evaluate(async () => {
    const sw = await navigator.serviceWorker.register('/sw.js');
    const ready = await navigator.serviceWorker.ready;
    return {
      scope: sw.scope,
      readyScope: ready.scope,
    };
  });

  expect(registration.scope).toBe('/');
  expect(registration.readyScope).toBe('/');
  expect(await handle.registeredPaths()).toEqual(['/sw.js']);
});

test('stubStorageManager returns the configured quota snapshot', async ({ page }) => {
  await page.goto('/');
  const handle = await stubStorageManager(page, { usage: 321, quota: 654 });

  const snapshot = await page.evaluate(async () => navigator.storage!.estimate());

  expect(snapshot).toEqual({ usage: 321, quota: 654 });
  expect(await handle.wasEstimated()).toBe(true);
  expect(await handle.lastEstimate()).toEqual({ usage: 321, quota: 654 });
});
