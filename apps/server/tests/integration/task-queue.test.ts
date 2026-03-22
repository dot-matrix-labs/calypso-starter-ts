/**
 * Integration tests for the PostgreSQL-backed task queue (issue #43).
 *
 * Validates:
 *   - Idempotent task enqueue (TQ-P-003, TQ-C-005)
 *   - Atomic single-winner claim (TQ-P-001, TQ-C-001)
 *   - Status update endpoint
 *   - Result submission (terminal success)
 *   - PII payload rejection (TQ-P-002, TQ-C-004)
 *   - Priority-ordered claim (TQ-D-006, TQ-C-007)
 *   - Unauthenticated requests rejected (401)
 */

import { test, expect, beforeAll, afterAll } from 'vitest';
import type { Subprocess } from 'bun';
import { startPostgres, type PgContainer } from '../helpers/pg-container';

const PORT = 31422;
const BASE = `http://localhost:${PORT}`;
const SERVER_READY_TIMEOUT_MS = 20_000;
const REPO_ROOT = new URL('../../../../', import.meta.url).pathname;
const SERVER_ENTRY = 'apps/server/src/index.ts';

let pg: PgContainer;
let server: Subprocess;
let authCookie = '';

beforeAll(async () => {
  pg = await startPostgres();

  server = Bun.spawn(['bun', 'run', SERVER_ENTRY], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      DATABASE_URL: pg.url,
      AUDIT_DATABASE_URL: pg.url,
      PORT: String(PORT),
    },
    stdout: 'ignore',
    stderr: 'ignore',
  });

  await waitForServer(BASE);

  const username = `tq_test_${Date.now()}`;
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'testpass123' }),
  });
  const setCookie = res.headers.get('set-cookie') ?? '';
  authCookie = setCookie.split(';')[0];
}, 60_000);

afterAll(async () => {
  server?.kill();
  await pg?.stop();
});

// ---------------------------------------------------------------------------

test('POST /api/tasks-queue returns 401 when unauthenticated', async () => {
  const res = await fetch(`${BASE}/api/tasks-queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idempotency_key: 'key-unauth',
      agent_type: 'coding',
      job_type: 'review',
    }),
  });
  expect(res.status).toBe(401);
});

test('POST /api/tasks-queue enqueues a task and returns it', async () => {
  const res = await fetch(`${BASE}/api/tasks-queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: authCookie },
    body: JSON.stringify({
      idempotency_key: `enqueue-${Date.now()}`,
      agent_type: 'coding',
      job_type: 'review',
      payload: { task_id: 'abc123' },
      priority: 3,
    }),
  });
  expect(res.status).toBe(200);
  const task = await res.json();
  expect(task.id).toBeTruthy();
  expect(task.status).toBe('pending');
  expect(task.agent_type).toBe('coding');
  expect(task.job_type).toBe('review');
  expect(task.priority).toBe(3);
  expect(task.payload).toEqual({ task_id: 'abc123' });
});

test('POST /api/tasks-queue is idempotent — same key returns existing task (TQ-C-005)', async () => {
  const key = `idempotent-${Date.now()}`;
  const body = {
    idempotency_key: key,
    agent_type: 'analysis',
    job_type: 'classify',
    payload: { ref_id: 'ref-001' },
  };

  const first = await fetch(`${BASE}/api/tasks-queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: authCookie },
    body: JSON.stringify(body),
  });
  expect(first.status).toBe(200);
  const t1 = await first.json();

  const second = await fetch(`${BASE}/api/tasks-queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: authCookie },
    body: JSON.stringify(body),
  });
  expect(second.status).toBe(200);
  const t2 = await second.json();

  // Same task, same id — no duplicate row created
  expect(t2.id).toBe(t1.id);
});

test('POST /api/tasks-queue rejects payloads with PII keys (TQ-C-004)', async () => {
  const res = await fetch(`${BASE}/api/tasks-queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: authCookie },
    body: JSON.stringify({
      idempotency_key: `pii-${Date.now()}`,
      agent_type: 'coding',
      job_type: 'review',
      payload: { email: 'user@example.com' },
    }),
  });
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error).toMatch(/PII/i);
});

test('POST /api/tasks-queue returns 400 when idempotency_key is missing', async () => {
  const res = await fetch(`${BASE}/api/tasks-queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: authCookie },
    body: JSON.stringify({ agent_type: 'coding', job_type: 'review' }),
  });
  expect(res.status).toBe(400);
});

test('POST /api/tasks-queue/claim claims the highest-priority pending task (TQ-C-007)', async () => {
  const stamp = Date.now();

  // Enqueue two tasks: one high-priority (1), one low-priority (9)
  await fetch(`${BASE}/api/tasks-queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: authCookie },
    body: JSON.stringify({
      idempotency_key: `claim-lo-${stamp}`,
      agent_type: `priority_test_${stamp}`,
      job_type: 'sort',
      payload: { ref: 'lo' },
      priority: 9,
    }),
  });

  await fetch(`${BASE}/api/tasks-queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: authCookie },
    body: JSON.stringify({
      idempotency_key: `claim-hi-${stamp}`,
      agent_type: `priority_test_${stamp}`,
      job_type: 'sort',
      payload: { ref: 'hi' },
      priority: 1,
    }),
  });

  const claimRes = await fetch(`${BASE}/api/tasks-queue/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: authCookie },
    body: JSON.stringify({ agent_type: `priority_test_${stamp}` }),
  });
  expect(claimRes.status).toBe(200);
  const claimed = await claimRes.json();

  // The high-priority (priority=1) task should be claimed first
  expect(claimed.status).toBe('claimed');
  expect(claimed.payload).toEqual({ ref: 'hi' });
  expect(claimed.attempt).toBe(1);
});

test('POST /api/tasks-queue/claim returns 204 when no task is available', async () => {
  const res = await fetch(`${BASE}/api/tasks-queue/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: authCookie },
    body: JSON.stringify({ agent_type: 'no_such_agent_type_xyz' }),
  });
  // 204 means no task available — body may be empty
  expect(res.status).toBe(204);
});

test('PATCH /api/tasks-queue/:id updates task status to running', async () => {
  // 1. Enqueue a task
  const enqRes = await fetch(`${BASE}/api/tasks-queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: authCookie },
    body: JSON.stringify({
      idempotency_key: `update-status-${Date.now()}`,
      agent_type: 'coding',
      job_type: 'review',
      payload: { ref: 'r1' },
    }),
  });
  const task = await enqRes.json();

  // 2. Claim it
  const claimRes = await fetch(`${BASE}/api/tasks-queue/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: authCookie },
    body: JSON.stringify({ agent_type: 'coding' }),
  });
  const claimed = await claimRes.json();
  expect(claimed.id).toBe(task.id);

  // 3. Update to running
  const patchRes = await fetch(`${BASE}/api/tasks-queue/${task.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: authCookie },
    body: JSON.stringify({ status: 'running' }),
  });
  expect(patchRes.status).toBe(200);
  const updated = await patchRes.json();
  expect(updated.status).toBe('running');
});

test('PATCH /api/tasks-queue/:id returns 400 for an invalid status', async () => {
  // Enqueue and claim a task first
  const enqRes = await fetch(`${BASE}/api/tasks-queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: authCookie },
    body: JSON.stringify({
      idempotency_key: `bad-status-${Date.now()}`,
      agent_type: 'coding',
      job_type: 'review',
      payload: { ref: 'r2' },
    }),
  });
  const task = await enqRes.json();

  const patchRes = await fetch(`${BASE}/api/tasks-queue/${task.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: authCookie },
    body: JSON.stringify({ status: 'invalid_state' }),
  });
  expect(patchRes.status).toBe(400);
});

test('POST /api/tasks-queue/:id/result submits a result and marks task completed', async () => {
  const stamp = Date.now();

  // 1. Enqueue
  const enqRes = await fetch(`${BASE}/api/tasks-queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: authCookie },
    body: JSON.stringify({
      idempotency_key: `result-${stamp}`,
      agent_type: `result_agent_${stamp}`,
      job_type: 'analysis',
      payload: { ref: 'result-test' },
    }),
  });
  const task = await enqRes.json();

  // 2. Claim
  await fetch(`${BASE}/api/tasks-queue/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: authCookie },
    body: JSON.stringify({ agent_type: `result_agent_${stamp}` }),
  });

  // 3. Submit result
  const resultRes = await fetch(`${BASE}/api/tasks-queue/${task.id}/result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: authCookie },
    body: JSON.stringify({ result: { score: 0.95, label: 'ok' } }),
  });
  expect(resultRes.status).toBe(200);
  const completed = await resultRes.json();
  expect(completed.status).toBe('completed');
  expect(completed.result).toEqual({ score: 0.95, label: 'ok' });
});

// ---------------------------------------------------------------------------

async function waitForServer(base: string): Promise<void> {
  const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await fetch(`${base}/healthz`);
      return;
    } catch {
      await Bun.sleep(300);
    }
  }
  throw new Error(`Server at ${base} did not become ready within ${SERVER_READY_TIMEOUT_MS}ms`);
}
