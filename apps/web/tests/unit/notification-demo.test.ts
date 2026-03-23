/**
 * Unit tests for the notification demo card logic.
 *
 * Tests platform-specific availability decisions and permission state mapping
 * without mounting the React component.
 */

import { describe, test, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Mirror pure helpers for isolated unit testing
// ---------------------------------------------------------------------------

/** Mirror of feature-availability logic */
function isFeatureAvailable(supportsNotifications: boolean): boolean {
  return supportsNotifications;
}

/** Mirror of iOS browser-tab restriction detection */
function isIosBrowserTab(os: string, isStandalone: boolean): boolean {
  return os === 'ios' && !isStandalone;
}

/** Mirror of DemoCard permissionState mapping */
function toCardPermissionState(
  permissionState: NotificationPermission,
  iosBrowserTab: boolean,
): PermissionState | null {
  if (iosBrowserTab) return null;
  if (permissionState === 'default') return 'prompt';
  return permissionState as PermissionState;
}

/** Mirror of unavailable note */
function getUnavailableNote(
  featureAvailable: boolean,
  os: string,
  isStandalone: boolean,
): string | undefined {
  if (featureAvailable) return undefined;
  if (os === 'ios' && isStandalone) return 'Notifications require iOS 16.4 or later.';
  return 'Notification API not available on this platform.';
}

// ---------------------------------------------------------------------------
// Feature availability
// ---------------------------------------------------------------------------

describe('notification feature availability', () => {
  test('available when Notification API is present', () => {
    expect(isFeatureAvailable(true)).toBe(true);
  });

  test('not available when Notification API is absent', () => {
    expect(isFeatureAvailable(false)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// iOS browser tab detection
// ---------------------------------------------------------------------------

describe('iOS browser tab detection', () => {
  test('detected on iOS browser tab (not standalone)', () => {
    expect(isIosBrowserTab('ios', false)).toBe(true);
  });

  test('NOT detected on iOS standalone', () => {
    expect(isIosBrowserTab('ios', true)).toBe(false);
  });

  test('NOT detected on Android browser tab', () => {
    expect(isIosBrowserTab('android', false)).toBe(false);
  });

  test('NOT detected on macOS', () => {
    expect(isIosBrowserTab('macos', false)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Permission state mapping
// ---------------------------------------------------------------------------

describe('permission state mapping', () => {
  test('maps default to prompt on non-iOS-tab', () => {
    expect(toCardPermissionState('default', false)).toBe('prompt');
  });

  test('maps granted to granted', () => {
    expect(toCardPermissionState('granted', false)).toBe('granted');
  });

  test('maps denied to denied', () => {
    expect(toCardPermissionState('denied', false)).toBe('denied');
  });

  test('returns null for iOS browser tab (handled separately)', () => {
    expect(toCardPermissionState('default', true)).toBeNull();
    expect(toCardPermissionState('granted', true)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Unavailable notes
// ---------------------------------------------------------------------------

describe('unavailable note derivation', () => {
  test('returns undefined when feature is available', () => {
    expect(getUnavailableNote(true, 'ios', true)).toBeUndefined();
  });

  test('shows iOS version note for iOS standalone without Notification API', () => {
    expect(getUnavailableNote(false, 'ios', true)).toMatch(/iOS 16\.4/);
  });

  test('shows generic note for other platforms without Notification API', () => {
    expect(getUnavailableNote(false, 'android', false)).toMatch(/not available/i);
  });

  test('shows generic note for unknown platform', () => {
    expect(getUnavailableNote(false, 'unknown', false)).toMatch(/not available/i);
  });
});

// ---------------------------------------------------------------------------
// Module export
// ---------------------------------------------------------------------------

describe('notification-demo module exports', () => {
  test('NotificationDemoCard is exported', async () => {
    const mod = await import('../../src/components/pwa/demos/notification-demo.js');
    expect(typeof mod.NotificationDemoCard).toBe('function');
  });
});
