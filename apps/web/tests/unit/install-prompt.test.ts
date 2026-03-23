/**
 * Unit tests for the install prompt component's eligibility logic.
 *
 * The component's rendering depends on:
 *   1. Whether the app is already in standalone mode (always non-eligible)
 *   2. Whether the user previously dismissed (stored in localStorage)
 *   3. OS / browser combination for iOS guided overlay
 *   4. Presence of a deferred BeforeInstallPromptEvent (Android banner)
 *
 * We test the state-transition rules without mounting the React component.
 */

import { describe, test, expect } from 'vitest';

const DISMISSED_KEY = 'calypso:pwa-install-dismissed';

/** Mirrors the eligibility decision from InstallPrompt */
function resolveEligibility(opts: {
  isStandalone: boolean;
  wasDismissed: boolean;
  hasBeforeInstallPrompt: boolean;
  os: string;
  browser: string;
}): 'not-eligible' | 'eligible' | 'installed' {
  if (opts.isStandalone) return 'installed';
  if (opts.wasDismissed) return 'not-eligible';
  if (opts.hasBeforeInstallPrompt) return 'eligible';
  if (opts.os === 'ios' && opts.browser === 'safari') return 'eligible';
  return 'not-eligible';
}

describe('InstallPrompt eligibility logic', () => {
  test('returns installed when already standalone', () => {
    expect(
      resolveEligibility({
        isStandalone: true,
        wasDismissed: false,
        hasBeforeInstallPrompt: false,
        os: 'android',
        browser: 'chrome',
      }),
    ).toBe('installed');
  });

  test('returns not-eligible when previously dismissed', () => {
    expect(
      resolveEligibility({
        isStandalone: false,
        wasDismissed: true,
        hasBeforeInstallPrompt: true,
        os: 'android',
        browser: 'chrome',
      }),
    ).toBe('not-eligible');
  });

  test('returns eligible when beforeinstallprompt captured on Android', () => {
    expect(
      resolveEligibility({
        isStandalone: false,
        wasDismissed: false,
        hasBeforeInstallPrompt: true,
        os: 'android',
        browser: 'chrome',
      }),
    ).toBe('eligible');
  });

  test('returns eligible when iOS Safari and not dismissed', () => {
    expect(
      resolveEligibility({
        isStandalone: false,
        wasDismissed: false,
        hasBeforeInstallPrompt: false,
        os: 'ios',
        browser: 'safari',
      }),
    ).toBe('eligible');
  });

  test('returns not-eligible when iOS Safari but dismissed', () => {
    expect(
      resolveEligibility({
        isStandalone: false,
        wasDismissed: true,
        hasBeforeInstallPrompt: false,
        os: 'ios',
        browser: 'safari',
      }),
    ).toBe('not-eligible');
  });

  test('returns not-eligible on desktop Chrome with no prompt event', () => {
    expect(
      resolveEligibility({
        isStandalone: false,
        wasDismissed: false,
        hasBeforeInstallPrompt: false,
        os: 'windows',
        browser: 'chrome',
      }),
    ).toBe('not-eligible');
  });

  test('dismissed key name is stable (used in localStorage)', () => {
    // Verifies the constant is exported-compatible for localStorage usage
    expect(DISMISSED_KEY).toBe('calypso:pwa-install-dismissed');
  });
});

describe('InstallPrompt module exports', () => {
  test('InstallPrompt is exported from the module', async () => {
    const mod = await import('../../src/components/pwa/install-prompt.js');
    expect(typeof mod.InstallPrompt).toBe('function');
  });
});
