/**
 * Integration tests for DELETE /api/users/:id authorisation.
 *
 * Covers:
 *  - Unauthenticated DELETE returns 401
 *  - Authenticated non-superuser deleting a different user returns 403
 *  - Authenticated user deleting their own account returns 200
 *  - Superuser deleting any user returns 200
 */
import { test, expect, beforeAll, afterAll } from 'vitest';
import type { Subprocess } from 'bun';
import { startPostgres, type PgContainer } from '../helpers/pg-container';

const PORT = 31424;
const BASE = `http://localhost:${PORT}`;
const SERVER_READY_TIMEOUT_MS = 20_000;
const REPO_ROOT = new URL('../../../../', import.meta.url).pathname;
const SERVER_ENTRY = 'apps/server/src/index.ts';

let pg: PgContainer;
let server: Subprocess;
let superuserId = '';
let superuserCookie = '';
let userACookie = '';
let userBId = '';

beforeAll(async () => {
  pg = await startPostgres();

  // Start server with a placeholder SUPERUSER_ID so we can register users first
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

  // Register user A
  const resA = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: `usera_${Date.now()}`, password: 'testpass123' }),
  });
  userACookie = (resA.headers.get('set-cookie') ?? '').split(';')[0];

  // Register user B
  const resB = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: `userb_${Date.now()}`, password: 'testpass123' }),
  });
  const bodyB = await resB.json();
  userBId = bodyB.user?.id ?? '';

  // Restart server with SUPERUSER_ID set to the registered superuser
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

test('DELETE /api/users/:id returns 401 when unauthenticated', async () => {
  const res = await fetch(`${BASE}/api/users/${userBId}`, {
    method: 'DELETE',
  });
  expect(res.status).toBe(401);
});

test('DELETE /api/users/:id returns 403 when a non-superuser tries to delete another user', async () => {
  // User A tries to delete User B
  const res = await fetch(`${BASE}/api/users/${userBId}`, {
    method: 'DELETE',
    headers: { Cookie: userACookie },
  });
  expect(res.status).toBe(403);
});

test('DELETE /api/users/:id returns 200 when user deletes their own account', async () => {
  // Register a fresh user for self-deletion so other tests are unaffected
  const selfRes = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: `self_${Date.now()}`, password: 'testpass123' }),
  });
  const selfBody = await selfRes.json();
  const selfId = selfBody.user?.id ?? '';
  const selfCookie = (selfRes.headers.get('set-cookie') ?? '').split(';')[0];

  const res = await fetch(`${BASE}/api/users/${selfId}`, {
    method: 'DELETE',
    headers: { Cookie: selfCookie },
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.success).toBe(true);
});

test('DELETE /api/users/:id returns 200 when superuser deletes another user', async () => {
  // Register a target user for the superuser to delete
  const targetRes = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: `target_${Date.now()}`, password: 'testpass123' }),
  });
  const targetBody = await targetRes.json();
  const targetId = targetBody.user?.id ?? '';

  const res = await fetch(`${BASE}/api/users/${targetId}`, {
    method: 'DELETE',
    headers: { Cookie: superuserCookie },
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.success).toBe(true);
});

// ---------------------------------------------------------------------------

async function waitForServer(base: string): Promise<void> {
  const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await fetch(`${base}/api/tasks`);
      return;
    } catch {
      await Bun.sleep(300);
    }
  }
  throw new Error(`Server at ${base} did not become ready within ${SERVER_READY_TIMEOUT_MS}ms`);
}
