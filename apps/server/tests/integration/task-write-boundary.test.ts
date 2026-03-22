import { test, expect, beforeAll, afterAll } from 'vitest';
import type { Subprocess } from 'bun';
import { startPostgres, type PgContainer } from '../helpers/pg-container';

const PORT = 31417;
const BASE = `http://localhost:${PORT}`;
const SERVER_READY_TIMEOUT_MS = 20_000;
const REPO_ROOT = new URL('../../../../', import.meta.url).pathname;
const SERVER_ENTRY = 'apps/server/src/index.ts';

let pg: PgContainer;
let server: Subprocess;
let authCookie = '';
let csrfToken = '';

beforeAll(async () => {
  pg = await startPostgres();

  server = Bun.spawn(['bun', 'run', SERVER_ENTRY], {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: pg.url, AUDIT_DATABASE_URL: pg.url, PORT: String(PORT) },
    stdout: 'ignore',
    stderr: 'ignore',
  });

  await waitForServer(BASE);

  const username = `task_patch_${Date.now()}`;
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

test('PATCH /api/tasks/:id preserves current behavior through the task write boundary', async () => {
  const createRes = await fetch(`${BASE}/api/tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: authCookie,
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify({ name: 'Patch me', owner: 'alice', priority: 'medium' }),
  });
  expect(createRes.status).toBe(201);
  const created = await createRes.json();

  const patchRes = await fetch(`${BASE}/api/tasks/${created.id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Cookie: authCookie,
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify({ status: 'in_progress', owner: 'bob' }),
  });

  expect(patchRes.status).toBe(200);
  const updated = await patchRes.json();
  expect(updated.id).toBe(created.id);
  expect(updated.status).toBe('in_progress');
  expect(updated.owner).toBe('bob');
  expect(updated.name).toBe('Patch me');
});

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
