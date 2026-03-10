import { test, expect, beforeAll } from 'vitest';

// The server (localhost:31415) is started by the CI workflow before this suite runs.
// It calls migrate() on startup — no need to call it here.
const BASE = 'http://localhost:31415';
let authCookie = '';

beforeAll(async () => {
  // Register a test user and grab the session cookie
  const username = `test_${Date.now()}`;
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'testpass123' }),
  });
  const setCookie = res.headers.get('set-cookie') ?? '';
  authCookie = setCookie.split(';')[0];
});

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
    headers: { 'Content-Type': 'application/json', Cookie: authCookie },
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
    headers: { 'Content-Type': 'application/json', Cookie: authCookie },
    body: JSON.stringify({ priority: 'low' }),
  });
  expect(res.status).toBe(400);
});

test('GET /api/tasks returns 401 when unauthenticated', async () => {
  const res = await fetch(`${BASE}/api/tasks`);
  expect(res.status).toBe(401);
});
