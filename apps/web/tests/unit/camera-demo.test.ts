/**
 * Unit tests for the camera demo card logic.
 *
 * Tests the platform-specific method availability decision and the
 * capture method selection logic, without mounting the React component.
 */

import { describe, test, expect } from 'vitest';

/**
 * Mirror the getUserMedia availability decision from the component.
 */
function canUseGetUserMedia(opts: {
  supportsGetUserMedia: boolean;
  os: string;
  isStandalone: boolean;
}): boolean {
  return opts.supportsGetUserMedia && !(opts.os === 'ios' && opts.isStandalone);
}

describe('camera demo getUserMedia availability', () => {
  test('available on Android Chrome', () => {
    expect(
      canUseGetUserMedia({ supportsGetUserMedia: true, os: 'android', isStandalone: false }),
    ).toBe(true);
  });

  test('available on iOS Safari browser tab', () => {
    expect(canUseGetUserMedia({ supportsGetUserMedia: true, os: 'ios', isStandalone: false })).toBe(
      true,
    );
  });

  test('NOT available on iOS standalone (WebKit bugs)', () => {
    expect(canUseGetUserMedia({ supportsGetUserMedia: true, os: 'ios', isStandalone: true })).toBe(
      false,
    );
  });

  test('NOT available when API absent', () => {
    expect(
      canUseGetUserMedia({ supportsGetUserMedia: false, os: 'android', isStandalone: false }),
    ).toBe(false);
  });

  test('NOT available when API absent AND iOS standalone', () => {
    expect(canUseGetUserMedia({ supportsGetUserMedia: false, os: 'ios', isStandalone: true })).toBe(
      false,
    );
  });

  test('available on macOS desktop', () => {
    expect(
      canUseGetUserMedia({ supportsGetUserMedia: true, os: 'macos', isStandalone: false }),
    ).toBe(true);
  });
});

describe('camera demo platform note', () => {
  function getPlatformNote(os: string, isStandalone: boolean): string | undefined {
    if (os === 'ios' && isStandalone)
      return 'getUserMedia is unreliable in installed PWAs due to long-standing WebKit bugs. Using file input capture.';
    return undefined;
  }

  test('shows WebKit bug note on iOS standalone', () => {
    expect(getPlatformNote('ios', true)).toMatch(/WebKit/);
  });

  test('no note on iOS browser tab', () => {
    expect(getPlatformNote('ios', false)).toBeUndefined();
  });

  test('no note on Android', () => {
    expect(getPlatformNote('android', false)).toBeUndefined();
  });
});

describe('camera demo module exports', () => {
  test('CameraDemoCard is exported', async () => {
    const mod = await import('../../src/components/pwa/demos/camera-demo.js');
    expect(typeof mod.CameraDemoCard).toBe('function');
  });
});
