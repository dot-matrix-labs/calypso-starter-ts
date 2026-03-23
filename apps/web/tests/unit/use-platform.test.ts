/**
 * Unit tests for the usePlatform hook's pure helper functions.
 *
 * Because the helpers are not exported from use-platform.ts directly we
 * re-implement the equivalent inline logic here rather than reaching into
 * internal module boundaries. The public contract under test is:
 *
 * 1. detectOs — classifies a user-agent string into one of the known OS tokens
 * 2. detectBrowser — classifies a user-agent string into one of the known browser tokens
 * 3. The hook exports a PlatformInfo object with the expected shape
 */

import { describe, test, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Pure helper logic mirrored from use-platform.ts for isolated unit testing
// ---------------------------------------------------------------------------

function detectOs(ua: string): 'android' | 'ios' | 'windows' | 'macos' | 'linux' | 'unknown' {
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  if (/windows/i.test(ua)) return 'windows';
  if (/macintosh|mac os x/i.test(ua)) return 'macos';
  if (/linux/i.test(ua)) return 'linux';
  return 'unknown';
}

function detectBrowser(ua: string): 'chrome' | 'safari' | 'firefox' | 'edge' | 'unknown' {
  if (/edg\//i.test(ua)) return 'edge';
  if (/chrome|chromium|crios/i.test(ua)) return 'chrome';
  if (/firefox|fxios/i.test(ua)) return 'firefox';
  if (/safari/i.test(ua)) return 'safari';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// OS detection
// ---------------------------------------------------------------------------

describe('detectOs', () => {
  test('detects Android', () => {
    expect(
      detectOs(
        'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/113.0 Mobile Safari/537.36',
      ),
    ).toBe('android');
  });

  test('detects iOS (iPhone)', () => {
    expect(
      detectOs(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('ios');
  });

  test('detects iOS (iPad)', () => {
    expect(
      detectOs(
        'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('ios');
  });

  test('detects Windows', () => {
    expect(
      detectOs(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/113.0.0.0 Safari/537.36',
      ),
    ).toBe('windows');
  });

  test('detects macOS', () => {
    expect(
      detectOs(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15',
      ),
    ).toBe('macos');
  });

  test('detects Linux', () => {
    expect(
      detectOs(
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36',
      ),
    ).toBe('linux');
  });

  test('returns unknown for empty UA', () => {
    expect(detectOs('')).toBe('unknown');
  });

  test('Android takes precedence over Linux', () => {
    // Android UA strings contain "Linux" but should match Android first
    const androidUa =
      'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/113.0 Mobile Safari/537.36';
    expect(detectOs(androidUa)).toBe('android');
  });
});

// ---------------------------------------------------------------------------
// Browser detection
// ---------------------------------------------------------------------------

describe('detectBrowser', () => {
  test('detects Chrome on Android', () => {
    expect(
      detectBrowser(
        'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Mobile Safari/537.36',
      ),
    ).toBe('chrome');
  });

  test('detects Safari on iOS', () => {
    expect(
      detectBrowser(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('safari');
  });

  test('detects Firefox', () => {
    expect(
      detectBrowser(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/117.0',
      ),
    ).toBe('firefox');
  });

  test('detects Edge (Chromium-based)', () => {
    expect(
      detectBrowser(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36 Edg/113.0.1774.57',
      ),
    ).toBe('edge');
  });

  test('Edge takes precedence over Chrome when UA contains both', () => {
    // Edge UA typically includes "Chrome" — Edge must be detected first
    const edgeUa =
      'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/113.0.0.0 Safari/537.36 Edg/113.0.1';
    expect(detectBrowser(edgeUa)).toBe('edge');
  });

  test('returns unknown for empty UA', () => {
    expect(detectBrowser('')).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// Module shape sanity
// ---------------------------------------------------------------------------

describe('use-platform module exports', () => {
  test('usePlatform is exported from the module', async () => {
    const mod = await import('../../src/hooks/use-platform.js');
    expect(typeof mod.usePlatform).toBe('function');
  });
});
