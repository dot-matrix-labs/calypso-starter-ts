/**
 * Unit tests for environment-aware auth cookie configuration.
 *
 * These tests verify that Set-Cookie headers produced by register, login, and
 * logout endpoints carry the correct attributes in both dev mode (SECURE_COOKIES
 * unset) and HTTPS mode (SECURE_COOKIES=true).
 */

import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Bun polyfill — vitest runs under Node where Bun globals are absent.
// We shim Bun.password so that the auth handler can call hash/verify.
// ---------------------------------------------------------------------------

const MOCK_HASH = '$argon2id$v=19$m=65536,t=2,p=1$mock$mockhash';

if (typeof globalThis.Bun === 'undefined') {
  (globalThis as Record<string, unknown>).Bun = {
    password: {
      hash: vi.fn().mockResolvedValue(MOCK_HASH),
      verify: vi.fn().mockResolvedValue(true),
    },
  };
}

import { handleAuthRequest, getAuthenticatedUser } from '../../src/api/auth';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAppState(overrides: { sqlResult?: unknown[] } = {}) {
  const rows = overrides.sqlResult ?? [];
  const sql = vi.fn(() =>
    Promise.resolve(rows),
  ) as unknown as import('../../src/index').AppState['sql'];
  (sql as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => v;

  return {
    sql,
    auditSql: sql,
    analyticsSql: sql,
  } satisfies import('../../src/index').AppState;
}

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('../../src/auth/jwt', () => ({
  signJwt: vi.fn().mockResolvedValue('mock-jwt-token'),
  verifyJwt: vi.fn().mockResolvedValue({ id: 'mock-id', username: 'testuser' }),
}));

vi.mock('../../src/auth/csrf', () => ({
  generateCsrfToken: vi.fn().mockReturnValue('mock-csrf-token'),
  csrfCookieHeader: vi
    .fn()
    .mockReturnValue('__Host-csrf-token=mock-csrf-token; SameSite=Strict; Secure; Path=/'),
  verifyCsrf: vi.fn().mockReturnValue(null),
}));

vi.mock('../../src/security/rate-limiter', () => ({
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
  globalLimiter: { check: vi.fn().mockReturnValue({ allowed: true }), consume: vi.fn() },
  loginIpLimiter: { check: vi.fn().mockReturnValue({ allowed: true }), consume: vi.fn() },
  loginUserLimiter: { check: vi.fn().mockReturnValue({ allowed: true }), consume: vi.fn() },
  registerIpLimiter: { check: vi.fn().mockReturnValue({ allowed: true }), consume: vi.fn() },
  tooManyRequests: vi.fn(),
}));

vi.mock('db/revocation', () => ({
  revokeToken: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('db/api-keys', () => ({
  authenticateApiKey: vi.fn().mockResolvedValue(null),
}));

// ---------------------------------------------------------------------------
// Dev-mode tests (SECURE_COOKIES unset)
// ---------------------------------------------------------------------------

describe('auth cookie — dev mode (SECURE_COOKIES unset)', () => {
  beforeEach(() => {
    delete process.env.SECURE_COOKIES;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test('login sets calypso_auth cookie with SameSite=Strict', async () => {
    const appState = makeAppState({
      sqlResult: [{ id: 'user-id', username: 'testuser', password_hash: MOCK_HASH }],
    });

    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testuser', password: 'password' }),
    });
    const url = new URL(req.url);

    const res = await handleAuthRequest(req, url, appState);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);

    const setCookieHeaders = res!.headers.getSetCookie();
    const authCookie = setCookieHeaders.find((h) => h.startsWith('calypso_auth='));
    expect(authCookie).toBeDefined();
    expect(authCookie).toContain('SameSite=Strict');
    expect(authCookie).not.toContain('Secure');
    expect(authCookie).not.toContain('__Host-');
    expect(authCookie).toContain('HttpOnly');
    expect(authCookie).toContain('Path=/');
  });

  test('register sets calypso_auth cookie with SameSite=Strict', async () => {
    const sql = vi.fn(() =>
      Promise.resolve([]),
    ) as unknown as import('../../src/index').AppState['sql'];
    (sql as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => v;

    const appState = {
      sql,
      auditSql: sql,
      analyticsSql: sql,
    } satisfies import('../../src/index').AppState;

    const req = new Request('http://localhost/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'newuser', password: 'StrongPass1!' }),
    });
    const url = new URL(req.url);

    const res = await handleAuthRequest(req, url, appState);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(201);

    const setCookieHeaders = res!.headers.getSetCookie();
    const authCookie = setCookieHeaders.find((h) => h.startsWith('calypso_auth='));
    expect(authCookie).toBeDefined();
    expect(authCookie).toContain('SameSite=Strict');
    expect(authCookie).not.toContain('Secure');
    expect(authCookie).not.toContain('__Host-');
  });

  test('logout clears calypso_auth cookie', async () => {
    const appState = makeAppState();

    const req = new Request('http://localhost/api/auth/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'calypso_auth=mock-jwt-token',
      },
    });
    const url = new URL(req.url);

    const res = await handleAuthRequest(req, url, appState);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);

    const setCookieHeaders = res!.headers.getSetCookie();
    const clearCookie = setCookieHeaders.find((h) => h.startsWith('calypso_auth='));
    expect(clearCookie).toBeDefined();
    expect(clearCookie).toContain('Max-Age=0');
  });
});

// ---------------------------------------------------------------------------
// HTTPS-mode tests (SECURE_COOKIES=true)
// ---------------------------------------------------------------------------

describe('auth cookie — HTTPS mode (SECURE_COOKIES=true)', () => {
  beforeEach(() => {
    process.env.SECURE_COOKIES = 'true';
  });

  afterEach(() => {
    delete process.env.SECURE_COOKIES;
    vi.clearAllMocks();
  });

  test('login sets __Host-calypso_auth cookie with Secure and SameSite=Lax', async () => {
    const appState = makeAppState({
      sqlResult: [{ id: 'user-id', username: 'testuser', password_hash: MOCK_HASH }],
    });

    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testuser', password: 'password' }),
    });
    const url = new URL(req.url);

    const res = await handleAuthRequest(req, url, appState);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);

    const setCookieHeaders = res!.headers.getSetCookie();
    const authCookie = setCookieHeaders.find((h) => h.startsWith('__Host-calypso_auth='));
    expect(authCookie).toBeDefined();
    expect(authCookie).toContain('Secure');
    expect(authCookie).toContain('SameSite=Lax');
    expect(authCookie).toContain('HttpOnly');
    expect(authCookie).toContain('Path=/');
  });

  test('register sets __Host-calypso_auth cookie with Secure and SameSite=Lax', async () => {
    const sql = vi.fn(() =>
      Promise.resolve([]),
    ) as unknown as import('../../src/index').AppState['sql'];
    (sql as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => v;

    const appState = {
      sql,
      auditSql: sql,
      analyticsSql: sql,
    } satisfies import('../../src/index').AppState;

    const req = new Request('http://localhost/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'newuser', password: 'StrongPass1!' }),
    });
    const url = new URL(req.url);

    const res = await handleAuthRequest(req, url, appState);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(201);

    const setCookieHeaders = res!.headers.getSetCookie();
    const authCookie = setCookieHeaders.find((h) => h.startsWith('__Host-calypso_auth='));
    expect(authCookie).toBeDefined();
    expect(authCookie).toContain('Secure');
    expect(authCookie).toContain('SameSite=Lax');
  });

  test('logout clears __Host-calypso_auth cookie', async () => {
    const appState = makeAppState();

    const req = new Request('http://localhost/api/auth/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: '__Host-calypso_auth=mock-jwt-token',
      },
    });
    const url = new URL(req.url);

    const res = await handleAuthRequest(req, url, appState);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);

    const setCookieHeaders = res!.headers.getSetCookie();
    const clearCookie = setCookieHeaders.find((h) => h.startsWith('__Host-calypso_auth='));
    expect(clearCookie).toBeDefined();
    expect(clearCookie).toContain('Max-Age=0');
    expect(clearCookie).toContain('Secure');
  });
});

// ---------------------------------------------------------------------------
// Transition tolerance tests
// ---------------------------------------------------------------------------

describe('auth cookie — transition tolerance', () => {
  afterEach(() => {
    delete process.env.SECURE_COOKIES;
    vi.clearAllMocks();
  });

  test('getAuthenticatedUser accepts plain cookie name when in HTTPS mode', async () => {
    process.env.SECURE_COOKIES = 'true';

    const req = new Request('http://localhost/api/auth/me', {
      headers: { Cookie: 'calypso_auth=mock-jwt-token' },
    });

    const user = await getAuthenticatedUser(req);
    expect(user).not.toBeNull();
    expect(user!.username).toBe('testuser');
  });

  test('getAuthenticatedUser accepts __Host- cookie name when in dev mode', async () => {
    delete process.env.SECURE_COOKIES;

    const req = new Request('http://localhost/api/auth/me', {
      headers: { Cookie: '__Host-calypso_auth=mock-jwt-token' },
    });

    const user = await getAuthenticatedUser(req);
    expect(user).not.toBeNull();
    expect(user!.username).toBe('testuser');
  });

  test('getAuthenticatedUser accepts active cookie name', async () => {
    delete process.env.SECURE_COOKIES;

    const req = new Request('http://localhost/api/auth/me', {
      headers: { Cookie: 'calypso_auth=mock-jwt-token' },
    });

    const user = await getAuthenticatedUser(req);
    expect(user).not.toBeNull();
    expect(user!.username).toBe('testuser');
  });
});

// ---------------------------------------------------------------------------
// Preserved general attribute tests
// ---------------------------------------------------------------------------

describe('auth cookie other attributes', () => {
  beforeEach(() => {
    delete process.env.SECURE_COOKIES;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test('calypso_auth cookie is HttpOnly', async () => {
    const appState = makeAppState({
      sqlResult: [{ id: 'user-id', username: 'testuser', password_hash: MOCK_HASH }],
    });

    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testuser', password: 'password' }),
    });
    const url = new URL(req.url);

    const res = await handleAuthRequest(req, url, appState);
    const setCookieHeaders = res!.headers.getSetCookie();

    const authCookie = setCookieHeaders.find((h) => h.startsWith('calypso_auth='));
    expect(authCookie).toContain('HttpOnly');
  });

  test('calypso_auth cookie has Path=/', async () => {
    const appState = makeAppState({
      sqlResult: [{ id: 'user-id', username: 'testuser', password_hash: MOCK_HASH }],
    });

    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testuser', password: 'password' }),
    });
    const url = new URL(req.url);

    const res = await handleAuthRequest(req, url, appState);
    const setCookieHeaders = res!.headers.getSetCookie();

    const authCookie = setCookieHeaders.find((h) => h.startsWith('calypso_auth='));
    expect(authCookie).toContain('Path=/');
  });
});
