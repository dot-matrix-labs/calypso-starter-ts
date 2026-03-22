import { test, expect, beforeAll, afterAll } from 'vitest';
import type { Subprocess } from 'bun';
import { startPostgres, type PgContainer } from '../helpers/pg-container';

// Each test run gets its own isolated postgres container + server process.
// No external infrastructure required — just Docker.

const PORT = 31416; // separate from dev server (31415) to allow parallel use
const BASE = `http://localhost:${PORT}`;
const SERVER_READY_TIMEOUT_MS = 20_000;
// Path relative to repo root — Bun needs to run from there to resolve workspace packages.
const REPO_ROOT = new URL('../../../../', import.meta.url).pathname;
const SERVER_ENTRY = 'apps/server/src/index.ts';

let pg: PgContainer;
let server: Subprocess;
let authCookie = '';
let csrfToken = '';

beforeAll(async () => {
  // 1. Start an isolated postgres container
  pg = await startPostgres();

  // 2. Start the server as a subprocess, pointed at the container
  server = Bun.spawn(['bun', 'run', SERVER_ENTRY], {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: pg.url, AUDIT_DATABASE_URL: pg.url, PORT: String(PORT) },
    stdout: 'ignore',
    stderr: 'ignore',
  });

  // 3. Wait until the server is accepting requests
  await waitForServer(BASE);

  // 4. Register a test user and capture the session cookie + CSRF token
  const username = `test_${Date.now()}`;
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'testpass123' }),
  });
  // Collect all Set-Cookie headers (auth session + CSRF token)
  const setCookies = res.headers.getSetCookie
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie') ?? ''];
  const cookiePairs: string[] = [];
  for (const raw of setCookies) {
    const pair = raw.split(';')[0].trim();
    if (pair) cookiePairs.push(pair);
    // Extract CSRF token value
    if (pair.startsWith('__Host-csrf-token=')) {
      csrfToken = pair.split('=').slice(1).join('=');
    }
  }
  authCookie = cookiePairs.join('; ');
}, 60_000);

afterAll(async () => {
  server?.kill();
  await pg?.stop();
});

// ---------------------------------------------------------------------------

test('GET /api/tasks returns 200 with an array', async () => {
  const res = await fetch(`${BASE}/api/tasks`, {
    headers: { Cookie: authCookie },
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body)).toBe(true);
});

test('POST /api/tasks creates a task and returns 201', async () => {
  const res = await fetch(`${BASE}/api/tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: authCookie,
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify({ name: 'Integration test task', priority: 'high' }),
  });
  expect(res.status).toBe(201);
  const task = await res.json();
  expect(task.id).toBeTruthy();
  expect(task.name).toBe('Integration test task');
  expect(task.priority).toBe('high');
  expect(task.status).toBe('todo');
});

test('POST /api/tasks returns 400 when name is missing', async () => {
  const res = await fetch(`${BASE}/api/tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: authCookie,
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify({ priority: 'low' }),
  });
  expect(res.status).toBe(400);
});

test('POST /api/tasks returns 403 when CSRF token is missing', async () => {
  const res = await fetch(`${BASE}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: authCookie },
    body: JSON.stringify({ name: 'CSRF test task' }),
  });
  expect(res.status).toBe(403);
});

test('GET /api/tasks returns 401 when unauthenticated', async () => {
  const res = await fetch(`${BASE}/api/tasks`);
  expect(res.status).toBe(401);
});

// ---------------------------------------------------------------------------

/** Poll the server's health until it responds or we time out. */
async function waitForServer(base: string): Promise<void> {
  const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await fetch(`${base}/api/tasks`);
      return; // any response (even 401) means the server is up
    } catch {
      await Bun.sleep(300);
    }
  }
  throw new Error(`Server at ${base} did not become ready within ${SERVER_READY_TIMEOUT_MS}ms`);
}
