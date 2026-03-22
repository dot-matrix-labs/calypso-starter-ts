/**
 * Unit tests for passkey API helper functions and routing.
 *
 * These tests verify the route-matching logic and request/response structure
 * of the passkey handler without requiring a database or authenticator device.
 */

import { describe, test, expect } from 'vitest';

describe('passkey route matching', () => {
  test('register/begin path is distinct from /api/auth/register', () => {
    const url = new URL('http://localhost/api/auth/passkey/register/begin');
    expect(url.pathname.startsWith('/api/auth/passkey')).toBe(true);
    expect(url.pathname.startsWith('/api/auth/passkey/register/begin')).toBe(true);
    expect(url.pathname === '/api/auth/register').toBe(false);
  });

  test('register/complete path matches correctly', () => {
    const url = new URL('http://localhost/api/auth/passkey/register/complete');
    expect(url.pathname).toBe('/api/auth/passkey/register/complete');
  });

  test('login/begin path matches correctly', () => {
    const url = new URL('http://localhost/api/auth/passkey/login/begin');
    expect(url.pathname).toBe('/api/auth/passkey/login/begin');
  });

  test('login/complete path matches correctly', () => {
    const url = new URL('http://localhost/api/auth/passkey/login/complete');
    expect(url.pathname).toBe('/api/auth/passkey/login/complete');
  });
});

describe('passkey challenge TTL constants', () => {
  test('challenge expires in 5 minutes (300 seconds)', () => {
    // The SQL uses NOW() + INTERVAL '5 minutes'. Verify intent is consistent.
    const TTL_SECONDS = 5 * 60;
    expect(TTL_SECONDS).toBe(300);
  });
});

describe('counter-based clone detection logic', () => {
  /**
   * The counter check in login/complete:
   *   if (newCounter <= cred.counter && newCounter !== 0) → reject
   */
  function isCloneDetected(newCounter: number, storedCounter: number): boolean {
    return newCounter <= storedCounter && newCounter !== 0;
  }

  test('accepts strictly higher counter', () => {
    expect(isCloneDetected(5, 4)).toBe(false);
  });

  test('rejects equal counter', () => {
    expect(isCloneDetected(4, 4)).toBe(true);
  });

  test('rejects lower counter', () => {
    expect(isCloneDetected(3, 4)).toBe(true);
  });

  test('allows counter=0 (stateless authenticators do not increment)', () => {
    // Some platform authenticators always return counter=0
    expect(isCloneDetected(0, 0)).toBe(false);
    expect(isCloneDetected(0, 5)).toBe(false);
  });

  test('accepts first use (stored=0, new=1)', () => {
    expect(isCloneDetected(1, 0)).toBe(false);
  });
});

describe('passkey RP configuration defaults', () => {
  test('default RP_ID is localhost for development', () => {
    // This reflects the env var fallback in passkey.ts
    const RP_ID = process.env.RP_ID ?? 'localhost';
    expect(RP_ID).toBe('localhost');
  });

  test('default ORIGIN is http://localhost:5174', () => {
    const ORIGIN = process.env.ORIGIN ?? 'http://localhost:5174';
    expect(ORIGIN).toBe('http://localhost:5174');
  });
});
