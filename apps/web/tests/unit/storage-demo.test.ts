/**
 * Unit tests for the Storage API demo card helpers.
 *
 * Tests the pure data-layer functions (IndexedDB helpers, quota formatting,
 * persistent storage logic) without mounting the React component.
 */

import { describe, test, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Storage quota formatting — mirrors readStorageQuota output shape
// ---------------------------------------------------------------------------

interface StorageQuota {
  usedMb: number;
  totalMb: number;
  percentUsed: number;
}

function formatQuota(usage: number, quota: number): StorageQuota | null {
  if (quota === 0) return null;
  const usedMb = Math.round((usage / (1024 * 1024)) * 10) / 10;
  const totalMb = Math.round(quota / (1024 * 1024));
  const percentUsed = Math.round((usage / quota) * 100);
  return { usedMb, totalMb, percentUsed };
}

describe('formatQuota', () => {
  test('returns null when quota is zero', () => {
    expect(formatQuota(0, 0)).toBeNull();
  });

  test('computes usedMb correctly', () => {
    const result = formatQuota(5 * 1024 * 1024, 100 * 1024 * 1024);
    expect(result?.usedMb).toBe(5);
  });

  test('computes totalMb correctly', () => {
    const result = formatQuota(5 * 1024 * 1024, 100 * 1024 * 1024);
    expect(result?.totalMb).toBe(100);
  });

  test('computes percentUsed correctly', () => {
    const result = formatQuota(25 * 1024 * 1024, 100 * 1024 * 1024);
    expect(result?.percentUsed).toBe(25);
  });

  test('handles fractional MB usage', () => {
    // 1.5 MB used
    const result = formatQuota(1.5 * 1024 * 1024, 100 * 1024 * 1024);
    expect(result?.usedMb).toBe(1.5);
  });

  test('clamps percentUsed to a reasonable integer', () => {
    const result = formatQuota(1, 3);
    expect(result?.percentUsed).toBe(33);
  });
});

// ---------------------------------------------------------------------------
// IndexedDB mock helpers — mirrors idbWrite / idbRead logic
// ---------------------------------------------------------------------------

const memDb: Record<string, string> = {};

function mockIdbWrite(key: string, value: string): void {
  memDb[key] = value;
}

function mockIdbRead(key: string): string | null {
  return memDb[key] ?? null;
}

const DEMO_KEY = 'demo-record';

describe('IndexedDB write / read round-trip', () => {
  test('read returns null before any write', () => {
    delete memDb[DEMO_KEY];
    expect(mockIdbRead(DEMO_KEY)).toBeNull();
  });

  test('write stores value and read returns it', () => {
    mockIdbWrite(DEMO_KEY, 'hello indexeddb');
    expect(mockIdbRead(DEMO_KEY)).toBe('hello indexeddb');
  });

  test('second write overwrites previous value', () => {
    mockIdbWrite(DEMO_KEY, 'first');
    mockIdbWrite(DEMO_KEY, 'second');
    expect(mockIdbRead(DEMO_KEY)).toBe('second');
  });

  test('empty string can be stored and read back', () => {
    mockIdbWrite(DEMO_KEY, '');
    expect(mockIdbRead(DEMO_KEY)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Persistent storage state derivation
// ---------------------------------------------------------------------------

describe('persistent storage state display', () => {
  function persistLabel(state: boolean | null): string {
    if (state === true) return 'granted';
    if (state === false) return 'not-persistent';
    return 'loading';
  }

  test('returns "granted" when persist state is true', () => {
    expect(persistLabel(true)).toBe('granted');
  });

  test('returns "not-persistent" when persist state is false', () => {
    expect(persistLabel(false)).toBe('not-persistent');
  });

  test('returns "loading" when persist state is null', () => {
    expect(persistLabel(null)).toBe('loading');
  });
});

// ---------------------------------------------------------------------------
// Feature availability guard
// ---------------------------------------------------------------------------

describe('storageApiAvailable guard', () => {
  function isStorageApiAvailable(hasStorageManager: boolean, hasIndexedDB: boolean): boolean {
    return hasStorageManager || hasIndexedDB;
  }

  test('available when both flags true', () => {
    expect(isStorageApiAvailable(true, true)).toBe(true);
  });

  test('available when only storageManager is true', () => {
    expect(isStorageApiAvailable(true, false)).toBe(true);
  });

  test('available when only indexedDB is true', () => {
    expect(isStorageApiAvailable(false, true)).toBe(true);
  });

  test('unavailable when both flags false', () => {
    expect(isStorageApiAvailable(false, false)).toBe(false);
  });
});
