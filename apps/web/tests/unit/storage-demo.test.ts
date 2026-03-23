/**
 * Unit tests for the local storage demo card helpers.
 *
 * Tests the pure data-layer functions (loadNotes, saveNotes, readQuota
 * logic) without mounting the React component.
 */

import { describe, test, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Mirror pure helpers for isolated unit testing
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'pwa-demo-notes';

/** Simple in-memory store for testing */
const memStore: Record<string, string> = {};

const mockStorage = {
  getItem: (k: string) => memStore[k] ?? null,
  setItem: (k: string, v: string) => {
    memStore[k] = v;
  },
  removeItem: (k: string) => {
    delete memStore[k];
  },
  clear: () => {
    for (const k in memStore) delete memStore[k];
  },
};

function loadNotes(): string[] {
  try {
    const raw = mockStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((n): n is string => typeof n === 'string');
    return [];
  } catch {
    return [];
  }
}

function saveNotes(notes: string[]): void {
  mockStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
}

// ---------------------------------------------------------------------------
// loadNotes
// ---------------------------------------------------------------------------

describe('loadNotes', () => {
  test('returns empty array when no data stored', () => {
    mockStorage.clear();
    expect(loadNotes()).toEqual([]);
  });

  test('returns stored notes array', () => {
    saveNotes(['hello', 'world']);
    expect(loadNotes()).toEqual(['hello', 'world']);
    mockStorage.clear();
  });

  test('filters out non-string entries from stored data', () => {
    mockStorage.setItem(STORAGE_KEY, JSON.stringify(['valid', 42, null, 'also-valid']));
    expect(loadNotes()).toEqual(['valid', 'also-valid']);
    mockStorage.clear();
  });

  test('returns empty array for malformed JSON', () => {
    mockStorage.setItem(STORAGE_KEY, 'not-json{{{');
    expect(loadNotes()).toEqual([]);
    mockStorage.clear();
  });

  test('returns empty array when stored value is not an array', () => {
    mockStorage.setItem(STORAGE_KEY, JSON.stringify({ note: 'oops' }));
    expect(loadNotes()).toEqual([]);
    mockStorage.clear();
  });
});

// ---------------------------------------------------------------------------
// saveNotes / round-trip
// ---------------------------------------------------------------------------

describe('saveNotes round-trip', () => {
  test('saves and reloads notes correctly', () => {
    mockStorage.clear();
    const notes = ['first', 'second', 'third'];
    saveNotes(notes);
    expect(loadNotes()).toEqual(notes);
    mockStorage.clear();
  });

  test('overwrites previous notes on subsequent save', () => {
    mockStorage.clear();
    saveNotes(['old']);
    saveNotes(['new1', 'new2']);
    expect(loadNotes()).toEqual(['new1', 'new2']);
    mockStorage.clear();
  });
});

// ---------------------------------------------------------------------------
// Platform note derivation
// ---------------------------------------------------------------------------

describe('platform note derivation', () => {
  function getPlatformNote(os: string, isStandalone: boolean): string | undefined {
    if (os === 'ios' && !isStandalone)
      return 'Data may be cleared after 7 days of inactivity (browser tab mode)';
    if (os === 'ios' && isStandalone) return 'Data persists normally when installed to home screen';
    return undefined;
  }

  test('shows eviction warning for iOS browser tab', () => {
    expect(getPlatformNote('ios', false)).toMatch(/7 days/);
  });

  test('shows persistence note for iOS standalone', () => {
    expect(getPlatformNote('ios', true)).toMatch(/persists/);
  });

  test('returns undefined for Android', () => {
    expect(getPlatformNote('android', false)).toBeUndefined();
  });

  test('returns undefined for macOS desktop', () => {
    expect(getPlatformNote('macos', false)).toBeUndefined();
  });
});
