import { test, expect, beforeAll, afterAll } from 'vitest';
import type { Subprocess } from 'bun';
import { startPostgres, type PgContainer } from '../helpers/pg-container';

/**
 * Integration tests for PostgreSQL-backed JTI revocation.
 *
 * Validates:
 * - POST /api/auth/logout revokes the session token in the database
 * - Subsequent authenticated requests using the revoked token are rejected (401)
 * - A fresh login after logout issues a new valid token (not revoked)
 */

const PORT = 31418;
const BASE = `http://localhost:${PORT}`;
const SERVER_READY_TIMEOUT_MS = 20_000;
const REPO_ROOT = new URL('../../../../', import.meta.url).pathname;
const SERVER_ENTRY = 'apps/server/src/index.ts';

let pg: PgContainer;
let server: Subprocess;

const testUser = { username: `revoke_test_${Date.now()}`, password: 'testpass123' };

beforeAll(async () => {
  pg = await startPostgres();
  server = Bun.spawn(['bun', 'run', SERVER_ENTRY], {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: pg.url, PORT: String(PORT) },
    stdout: 'ignore',
    stderr: 'ignore',
  });
  await waitForServer(BASE);
}, 60_000);

afterAll(async () => {
  server?.kill();
  await pg?.stop();
});

// ---------------------------------------------------------------------------

test('register sets a session cookie', async () => {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(testUser),
  });
  expect(res.status).toBe(201);
  const setCookie = res.headers.get('set-cookie') ?? '';
  expect(setCookie).toContain('calypso_auth=');
});

test('logout revokes the token so subsequent requests return 401', async () => {
  // 1. Login to get a fresh cookie
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(testUser),
  });
  expect(loginRes.status).toBe(200);
  const setCookie = loginRes.headers.get('set-cookie') ?? '';
  const cookie = setCookie.split(';')[0]; // e.g. "calypso_auth=<token>"
  expect(cookie).toContain('calypso_auth=');

  // 2. Verify the token is valid before logout
  const meBeforeRes = await fetch(`${BASE}/api/auth/me`, {
    headers: { Cookie: cookie },
  });
  expect(meBeforeRes.status).toBe(200);

  // 3. Logout — server should revoke the JTI
  const logoutRes = await fetch(`${BASE}/api/auth/logout`, {
    method: 'POST',
    headers: { Cookie: cookie },
  });
  expect(logoutRes.status).toBe(200);

  // 4. The same token must now be rejected
  const meAfterRes = await fetch(`${BASE}/api/auth/me`, {
    headers: { Cookie: cookie },
  });
  expect(meAfterRes.status).toBe(401);
});

test('new login after logout issues a fresh valid token', async () => {
  // Login again — must get a new (non-revoked) token
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(testUser),
  });
  expect(loginRes.status).toBe(200);
  const setCookie = loginRes.headers.get('set-cookie') ?? '';
  const newCookie = setCookie.split(';')[0];

  const meRes = await fetch(`${BASE}/api/auth/me`, {
    headers: { Cookie: newCookie },
  });
  expect(meRes.status).toBe(200);
});

// ---------------------------------------------------------------------------

async function waitForServer(base: string): Promise<void> {
  const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await fetch(`${base}/api/auth/me`);
      return;
    } catch {
      await Bun.sleep(300);
    }
  }
  throw new Error(`Server at ${base} did not become ready within ${SERVER_READY_TIMEOUT_MS}ms`);
}
