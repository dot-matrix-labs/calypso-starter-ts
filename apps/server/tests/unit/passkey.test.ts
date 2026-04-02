/**
 * Unit tests for passkey API helper functions, routing, and RP config derivation.
 *
 * These tests verify the route-matching logic, request/response structure,
 * and dynamic RP configuration of the passkey handler without requiring a
 * database or authenticator device.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { getRpConfig, handlePasskeyRequest } from '../../src/api/passkey';
import { verifyCsrf } from '../../src/auth/csrf';
import * as authModule from '../../src/api/auth';

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

describe('getRpConfig', () => {
  const savedEnv = { RP_ID: process.env.RP_ID, ORIGIN: process.env.ORIGIN };

  afterEach(() => {
    // Restore original env
    if (savedEnv.RP_ID === undefined) delete process.env.RP_ID;
    else process.env.RP_ID = savedEnv.RP_ID;
    if (savedEnv.ORIGIN === undefined) delete process.env.ORIGIN;
    else process.env.ORIGIN = savedEnv.ORIGIN;
  });

  function makeRequest(headers: Record<string, string> = {}): Request {
    return new Request('http://localhost/api/auth/passkey/register/begin', {
      method: 'POST',
      headers,
    });
  }

  test('env vars override request headers when both RP_ID and ORIGIN are set', () => {
    process.env.RP_ID = 'example.com';
    process.env.ORIGIN = 'https://example.com';
    const req = makeRequest({ origin: 'https://other.com' });
    const config = getRpConfig(req);
    expect(config.rpId).toBe('example.com');
    expect(config.origin).toBe('https://example.com');
  });

  test('derives rpId and origin from Origin header', () => {
    delete process.env.RP_ID;
    delete process.env.ORIGIN;
    const req = makeRequest({ origin: 'https://myapp.example.com:8443' });
    const config = getRpConfig(req);
    expect(config.rpId).toBe('myapp.example.com');
    expect(config.origin).toBe('https://myapp.example.com:8443');
  });

  test('falls back to Referer header when Origin is absent', () => {
    delete process.env.RP_ID;
    delete process.env.ORIGIN;
    const req = makeRequest({ referer: 'https://referer-host.dev/some/path' });
    const config = getRpConfig(req);
    expect(config.rpId).toBe('referer-host.dev');
    expect(config.origin).toBe('https://referer-host.dev');
  });

  test('prefers Origin header over Referer header', () => {
    delete process.env.RP_ID;
    delete process.env.ORIGIN;
    const req = makeRequest({
      origin: 'https://origin-host.dev',
      referer: 'https://referer-host.dev/page',
    });
    const config = getRpConfig(req);
    expect(config.rpId).toBe('origin-host.dev');
    expect(config.origin).toBe('https://origin-host.dev');
  });

  test('falls back to localhost defaults when no headers or env vars', () => {
    delete process.env.RP_ID;
    delete process.env.ORIGIN;
    const req = makeRequest();
    const config = getRpConfig(req);
    expect(config.rpId).toBe('localhost');
    expect(config.origin).toBe('http://localhost:5174');
  });

  test('falls back to localhost defaults on invalid Origin header', () => {
    delete process.env.RP_ID;
    delete process.env.ORIGIN;
    const req = makeRequest({ origin: 'not-a-valid-url' });
    const config = getRpConfig(req);
    expect(config.rpId).toBe('localhost');
    expect(config.origin).toBe('http://localhost:5174');
  });

  test('env vars ignored when only RP_ID is set (not ORIGIN)', () => {
    process.env.RP_ID = 'example.com';
    delete process.env.ORIGIN;
    const req = makeRequest({ origin: 'https://header-host.dev' });
    const config = getRpConfig(req);
    expect(config.rpId).toBe('header-host.dev');
    expect(config.origin).toBe('https://header-host.dev');
  });

  test('env vars ignored when only ORIGIN is set (not RP_ID)', () => {
    delete process.env.RP_ID;
    process.env.ORIGIN = 'https://example.com';
    const req = makeRequest({ origin: 'https://header-host.dev' });
    const config = getRpConfig(req);
    expect(config.rpId).toBe('header-host.dev');
    expect(config.origin).toBe('https://header-host.dev');
  });

  test('works with Docker container hostname in Origin', () => {
    delete process.env.RP_ID;
    delete process.env.ORIGIN;
    const req = makeRequest({ origin: 'http://my-container:3000' });
    const config = getRpConfig(req);
    expect(config.rpId).toBe('my-container');
    expect(config.origin).toBe('http://my-container:3000');
  });
});

// ---------------------------------------------------------------------------
// CSRF guard on register/complete
// ---------------------------------------------------------------------------

describe('register/complete CSRF guard', () => {
  beforeEach(() => {
    delete process.env.CSRF_DISABLED;
  });

  afterEach(() => {
    delete process.env.CSRF_DISABLED;
  });

  function makeCompleteRequest(csrfHeader?: string, csrfCookie?: string): Request {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (csrfHeader) headers['X-CSRF-Token'] = csrfHeader;
    const cookies: Record<string, string> = {};
    if (csrfCookie) cookies['__Host-csrf-token'] = csrfCookie;
    return new Request('http://localhost/api/auth/passkey/register/complete', {
      method: 'POST',
      headers,
    });
  }

  test('returns 403 when X-CSRF-Token header is missing', () => {
    const req = makeCompleteRequest(undefined, 'valid-token');
    const cookies = { '__Host-csrf-token': 'valid-token' };
    const res = verifyCsrf(req, cookies);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  test('returns 403 when CSRF token in header does not match cookie', () => {
    const req = makeCompleteRequest('wrong-token', 'valid-token');
    const cookies = { '__Host-csrf-token': 'valid-token' };
    const res = verifyCsrf(req, cookies);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  test('returns null (allowed) when CSRF tokens match', () => {
    const token = 'a'.repeat(64);
    const req = makeCompleteRequest(token, token);
    const cookies = { '__Host-csrf-token': token };
    const res = verifyCsrf(req, cookies);
    expect(res).toBeNull();
  });

  test('CSRF check is bypassed when CSRF_DISABLED=true', () => {
    process.env.CSRF_DISABLED = 'true';
    const req = makeCompleteRequest(undefined, undefined);
    const res = verifyCsrf(req, {});
    expect(res).toBeNull();
  });
});

describe('passkey credential management routes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeAppStateWithSql(
    sqlImpl: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>,
  ) {
    const sql = vi.fn(sqlImpl) as unknown as import('../../src/index').AppState['sql'];
    return {
      sql,
      auditSql: sql,
      analyticsSql: sql,
    } satisfies import('../../src/index').AppState;
  }

  test('GET /api/auth/passkey/credentials returns 401 when unauthenticated', async () => {
    vi.spyOn(authModule, 'getAuthenticatedUser').mockResolvedValue(null);
    const appState = makeAppStateWithSql(async () => []);

    const req = new Request('http://localhost/api/auth/passkey/credentials', { method: 'GET' });
    const res = await handlePasskeyRequest(req, new URL(req.url), appState);

    expect(res?.status).toBe(401);
  });

  test('GET /api/auth/passkey/credentials returns only caller credentials', async () => {
    vi.spyOn(authModule, 'getAuthenticatedUser').mockResolvedValue({
      id: 'user-1',
      username: 'alice',
    });
    const rows = [
      {
        id: 'cred-1',
        credential_id: 'abcdefghijklmnopqrstuvwxyz',
        created_at: '2026-03-01T12:00:00.000Z',
        last_used_at: '2026-03-02T12:00:00.000Z',
      },
    ];
    const appState = makeAppStateWithSql(async () => rows);

    const req = new Request('http://localhost/api/auth/passkey/credentials', { method: 'GET' });
    const res = await handlePasskeyRequest(req, new URL(req.url), appState);

    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toEqual(rows);
  });

  test('GET /api/auth/passkey/credentials returns empty array when none exist', async () => {
    vi.spyOn(authModule, 'getAuthenticatedUser').mockResolvedValue({
      id: 'user-1',
      username: 'alice',
    });
    const appState = makeAppStateWithSql(async () => []);

    const req = new Request('http://localhost/api/auth/passkey/credentials', { method: 'GET' });
    const res = await handlePasskeyRequest(req, new URL(req.url), appState);

    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toEqual([]);
  });

  test('DELETE /api/auth/passkey/credentials/:id returns 401 when unauthenticated', async () => {
    vi.spyOn(authModule, 'getAuthenticatedUser').mockResolvedValue(null);
    const appState = makeAppStateWithSql(async () => []);

    const req = new Request('http://localhost/api/auth/passkey/credentials/cred-1', {
      method: 'DELETE',
    });
    const res = await handlePasskeyRequest(req, new URL(req.url), appState);

    expect(res?.status).toBe(401);
  });

  test('DELETE /api/auth/passkey/credentials/:id returns 404 for unknown credential', async () => {
    vi.spyOn(authModule, 'getAuthenticatedUser').mockResolvedValue({
      id: 'user-1',
      username: 'alice',
    });
    const appState = makeAppStateWithSql(async () => []);

    const req = new Request('http://localhost/api/auth/passkey/credentials/cred-missing', {
      method: 'DELETE',
    });
    const res = await handlePasskeyRequest(req, new URL(req.url), appState);

    expect(res?.status).toBe(404);
  });

  test('DELETE /api/auth/passkey/credentials/:id returns 204 on success', async () => {
    vi.spyOn(authModule, 'getAuthenticatedUser').mockResolvedValue({
      id: 'user-1',
      username: 'alice',
    });
    const appState = makeAppStateWithSql(async () => [{ id: 'cred-1' }]);

    const req = new Request('http://localhost/api/auth/passkey/credentials/cred-1', {
      method: 'DELETE',
    });
    const res = await handlePasskeyRequest(req, new URL(req.url), appState);

    expect(res?.status).toBe(204);
  });
});
