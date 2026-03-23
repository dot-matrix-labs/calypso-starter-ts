/**
 * Integration tests for API key management (machine-to-machine authentication).
 *
 * Covers:
 *  - POST /api/admin/keys returns 401 when unauthenticated
 *  - POST /api/admin/keys returns 403 for non-superusers
 *  - POST /api/admin/keys creates a key and returns the raw key once (superuser)
 *  - POST /api/admin/keys returns 400 when label is missing
 *  - GET /api/admin/keys lists keys without exposing raw key values
 *  - DELETE /api/admin/keys/:id revokes an API key
 *  - DELETE /api/admin/keys/:id returns 404 for unknown id
 *  - Bearer token authenticates requests to /api/auth/me
 *  - Revoked key Bearer token is rejected
 */
import { test, expect, beforeAll, afterAll } from 'vitest';
import type { Subprocess } from 'bun';
import { startPostgres, type PgContainer } from '../helpers/pg-container';

const PORT = 31421;
const BASE = `http://localhost:${PORT}`;
const SERVER_READY_TIMEOUT_MS = 20_000;
const REPO_ROOT = new URL('../../../../', import.meta.url).pathname;
const SERVER_ENTRY = 'apps/server/src/index.ts';

let pg: PgContainer;
let server: Subprocess;
let superuserCookie = '';
let superuserId = '';
let regularCookie = '';

beforeAll(async () => {
  pg = await startPostgres();

  // Start server without a SUPERUSER_ID to register two users first
  server = Bun.spawn(['bun', 'run', SERVER_ENTRY], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      DATABASE_URL: pg.url,
      AUDIT_DATABASE_URL: pg.url,
      PORT: String(PORT),
      SUPERUSER_ID: '__placeholder__',
    },
    stdout: 'ignore',
    stderr: 'ignore',
  });
  await waitForServer(BASE);

  // Register superuser
  const suRes = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: `su_${Date.now()}`, password: 'testpass123' }),
  });
  const suBody = await suRes.json();
  superuserId = suBody.user?.id ?? '';
  superuserCookie = (suRes.headers.get('set-cookie') ?? '').split(';')[0];

  // Register regular user
  const regRes = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: `reg_${Date.now()}`, password: 'testpass123' }),
  });
  regularCookie = (regRes.headers.get('set-cookie') ?? '').split(';')[0];

  // Restart server with the SUPERUSER_ID set to the registered superuser's id
  server.kill();
  server = Bun.spawn(['bun', 'run', SERVER_ENTRY], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      DATABASE_URL: pg.url,
      AUDIT_DATABASE_URL: pg.url,
      PORT: String(PORT),
      SUPERUSER_ID: superuserId,
    },
    stdout: 'ignore',
    stderr: 'ignore',
  });
  await waitForServer(BASE);
}, 120_000);

afterAll(async () => {
  server?.kill();
  await pg?.stop();
});

// ---------------------------------------------------------------------------

test('POST /api/admin/keys returns 401 when unauthenticated', async () => {
  const res = await fetch(`${BASE}/api/admin/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: 'test-key' }),
  });
  expect(res.status).toBe(401);
});

test('POST /api/admin/keys returns 403 for non-superuser', async () => {
  const res = await fetch(`${BASE}/api/admin/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: regularCookie },
    body: JSON.stringify({ label: 'test-key' }),
  });
  expect(res.status).toBe(403);
});

test('POST /api/admin/keys returns 400 when label is missing', async () => {
  const res = await fetch(`${BASE}/api/admin/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: superuserCookie },
    body: JSON.stringify({}),
  });
  expect(res.status).toBe(400);
});

let createdKeyId = '';
let createdRawKey = '';

test('POST /api/admin/keys creates a key and returns the raw key once', async () => {
  const res = await fetch(`${BASE}/api/admin/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: superuserCookie },
    body: JSON.stringify({ label: 'ci-pipeline' }),
  });
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(typeof body.key).toBe('string');
  expect(body.key.length).toBeGreaterThan(0);
  expect(body.id).toBeTruthy();
  expect(body.label).toBe('ci-pipeline');
  expect(body.created_at).toBeTruthy();
  createdKeyId = body.id;
  createdRawKey = body.key;
});

test('GET /api/admin/keys lists keys without raw key values', async () => {
  const res = await fetch(`${BASE}/api/admin/keys`, {
    headers: { Cookie: superuserCookie },
  });
  expect(res.status).toBe(200);
  const keys = await res.json();
  expect(Array.isArray(keys)).toBe(true);
  const found = keys.find((k: { id: string }) => k.id === createdKeyId);
  expect(found).toBeTruthy();
  expect(found.key).toBeUndefined();
  expect(found.key_hash).toBeUndefined();
  expect(found.label).toBe('ci-pipeline');
});

test('GET /api/admin/keys returns 401 when unauthenticated', async () => {
  const res = await fetch(`${BASE}/api/admin/keys`);
  expect(res.status).toBe(401);
});

test('Bearer token authenticates requests', async () => {
  const res = await fetch(`${BASE}/api/auth/me`, {
    headers: { Authorization: `Bearer ${createdRawKey}` },
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.user).toBeTruthy();
});

test('Invalid Bearer token is rejected with 401', async () => {
  const res = await fetch(`${BASE}/api/auth/me`, {
    headers: { Authorization: 'Bearer invalidkey123' },
  });
  expect(res.status).toBe(401);
});

test('DELETE /api/admin/keys/:id revokes an API key', async () => {
  const res = await fetch(`${BASE}/api/admin/keys/${createdKeyId}`, {
    method: 'DELETE',
    headers: { Cookie: superuserCookie },
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.success).toBe(true);
});

test('Revoked key Bearer token is rejected after deletion', async () => {
  const res = await fetch(`${BASE}/api/auth/me`, {
    headers: { Authorization: `Bearer ${createdRawKey}` },
  });
  expect(res.status).toBe(401);
});

test('DELETE /api/admin/keys/:id returns 404 for unknown id', async () => {
  const res = await fetch(`${BASE}/api/admin/keys/nonexistent-id`, {
    method: 'DELETE',
    headers: { Cookie: superuserCookie },
  });
  expect(res.status).toBe(404);
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
