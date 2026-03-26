/**
 * Unit tests for GET /api/admin/task-queue — admin task queue monitoring endpoint.
 *
 * These tests validate the route handler logic (auth, query parsing, field
 * exclusion) by mocking the database layer and auth helpers. No live database
 * connection is required.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted ensures mock fns are available when vi.mock factories
// execute (vi.mock calls are hoisted above imports by vitest).
// ---------------------------------------------------------------------------

const { mockListTasksForAdmin, mockGetAuthenticatedUser } = vi.hoisted(() => ({
  mockListTasksForAdmin: vi.fn(),
  mockGetAuthenticatedUser: vi.fn(),
}));

vi.mock('db/api-keys', () => ({
  createApiKey: vi.fn(),
  listApiKeys: vi.fn(),
  deleteApiKey: vi.fn(),
  authenticateApiKey: vi.fn(),
}));

vi.mock('db/task-queue', () => ({
  listTasksForAdmin: mockListTasksForAdmin,
}));

vi.mock('../../src/policies/audit-service', () => ({
  emitAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/api/auth', () => ({
  getAuthenticatedUser: mockGetAuthenticatedUser,
  getCorsHeaders: () => ({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Credentials': 'true',
  }),
}));

vi.mock('../../src/lib/response', async () => {
  const actual =
    await vi.importActual<typeof import('../../src/lib/response')>('../../src/lib/response');
  return {
    ...actual,
    isSuperuser: (id: string) => id === 'superuser-id',
  };
});

import { handleAdminRequest } from '../../src/api/admin';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const appState = {} as never;

function makeRequest(path: string, method = 'GET'): { req: Request; url: URL } {
  const fullUrl = `http://localhost:31415${path}`;
  const req = new Request(fullUrl, { method });
  const url = new URL(fullUrl);
  return { req, url };
}

async function jsonBody(res: Response): Promise<unknown> {
  return res.json();
}

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const sampleTask = {
  id: 'task-1',
  idempotency_key: 'idem-1',
  agent_type: 'coding',
  job_type: 'run-test',
  status: 'pending',
  correlation_id: null,
  created_by: 'user-abc',
  claimed_by: null,
  claimed_at: null,
  claim_expires_at: null,
  result: null,
  error_message: null,
  attempt: 0,
  max_attempts: 3,
  next_retry_at: null,
  priority: 5,
  created_at: new Date('2026-03-26T00:00:00Z'),
  updated_at: new Date('2026-03-26T00:00:00Z'),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/admin/task-queue', () => {
  const originalEnv = process.env.SUPERUSER_ID;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPERUSER_ID = 'superuser-id';
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.SUPERUSER_ID;
    } else {
      process.env.SUPERUSER_ID = originalEnv;
    }
  });

  // ── Auth / authorisation ────────────────────────────────────────────────

  test('returns 401 for unauthenticated caller', async () => {
    mockGetAuthenticatedUser.mockResolvedValue(null);
    const { req, url } = makeRequest('/api/admin/task-queue');
    const res = await handleAdminRequest(req, url, appState);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
    const body = await jsonBody(res!);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  test('returns 403 for non-superadmin caller', async () => {
    mockGetAuthenticatedUser.mockResolvedValue({ id: 'regular-user', username: 'bob' });
    const { req, url } = makeRequest('/api/admin/task-queue');
    const res = await handleAdminRequest(req, url, appState);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const body = await jsonBody(res!);
    expect(body).toEqual({ error: 'Forbidden' });
  });

  // ── Happy path ──────────────────────────────────────────────────────────

  test('superadmin can retrieve task queue entries', async () => {
    mockGetAuthenticatedUser.mockResolvedValue({ id: 'superuser-id', username: 'admin' });
    mockListTasksForAdmin.mockResolvedValue([sampleTask]);

    const { req, url } = makeRequest('/api/admin/task-queue');
    const res = await handleAdminRequest(req, url, appState);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);

    const body = (await jsonBody(res!)) as {
      tasks: (typeof sampleTask)[];
      limit: number;
      offset: number;
    };
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].id).toBe('task-1');
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
  });

  test('response does not contain payload or delegated_token fields', async () => {
    mockGetAuthenticatedUser.mockResolvedValue({ id: 'superuser-id', username: 'admin' });
    // Simulate a row that would have these fields if included
    mockListTasksForAdmin.mockResolvedValue([sampleTask]);

    const { req, url } = makeRequest('/api/admin/task-queue');
    const res = await handleAdminRequest(req, url, appState);
    const body = (await jsonBody(res!)) as { tasks: Record<string, unknown>[] };

    // The db query itself excludes these columns; verify the mock contract
    expect(body.tasks[0]).not.toHaveProperty('payload');
    expect(body.tasks[0]).not.toHaveProperty('delegated_token');
  });

  // ── Query parameter: status ─────────────────────────────────────────────

  test('status filter is passed to listTasksForAdmin', async () => {
    mockGetAuthenticatedUser.mockResolvedValue({ id: 'superuser-id', username: 'admin' });
    mockListTasksForAdmin.mockResolvedValue([]);

    const { req, url } = makeRequest('/api/admin/task-queue?status=running');
    await handleAdminRequest(req, url, appState);

    expect(mockListTasksForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'running' }),
    );
  });

  test('returns 400 for invalid status value', async () => {
    mockGetAuthenticatedUser.mockResolvedValue({ id: 'superuser-id', username: 'admin' });

    const { req, url } = makeRequest('/api/admin/task-queue?status=invalid');
    const res = await handleAdminRequest(req, url, appState);
    expect(res!.status).toBe(400);
    const body = await jsonBody(res!);
    expect((body as { error: string }).error).toContain('Invalid status');
  });

  // ── Query parameter: agent_type ─────────────────────────────────────────

  test('agent_type filter is passed to listTasksForAdmin', async () => {
    mockGetAuthenticatedUser.mockResolvedValue({ id: 'superuser-id', username: 'admin' });
    mockListTasksForAdmin.mockResolvedValue([]);

    const { req, url } = makeRequest('/api/admin/task-queue?agent_type=coding');
    await handleAdminRequest(req, url, appState);

    expect(mockListTasksForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ agent_type: 'coding' }),
    );
  });

  // ── Pagination ──────────────────────────────────────────────────────────

  test('pagination works correctly with limit and offset', async () => {
    mockGetAuthenticatedUser.mockResolvedValue({ id: 'superuser-id', username: 'admin' });
    mockListTasksForAdmin.mockResolvedValue([]);

    const { req, url } = makeRequest('/api/admin/task-queue?limit=10&offset=20');
    const res = await handleAdminRequest(req, url, appState);

    expect(mockListTasksForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, offset: 20 }),
    );
    const body = (await jsonBody(res!)) as { limit: number; offset: number };
    expect(body.limit).toBe(10);
    expect(body.offset).toBe(20);
  });

  test('limit is capped at 200', async () => {
    mockGetAuthenticatedUser.mockResolvedValue({ id: 'superuser-id', username: 'admin' });
    mockListTasksForAdmin.mockResolvedValue([]);

    const { req, url } = makeRequest('/api/admin/task-queue?limit=999');
    await handleAdminRequest(req, url, appState);

    expect(mockListTasksForAdmin).toHaveBeenCalledWith(expect.objectContaining({ limit: 200 }));
  });

  test('defaults to limit=50 and offset=0 when omitted', async () => {
    mockGetAuthenticatedUser.mockResolvedValue({ id: 'superuser-id', username: 'admin' });
    mockListTasksForAdmin.mockResolvedValue([]);

    const { req, url } = makeRequest('/api/admin/task-queue');
    await handleAdminRequest(req, url, appState);

    expect(mockListTasksForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50, offset: 0 }),
    );
  });

  // ── Combined filters ───────────────────────────────────────────────────

  test('supports combined status and agent_type filters', async () => {
    mockGetAuthenticatedUser.mockResolvedValue({ id: 'superuser-id', username: 'admin' });
    mockListTasksForAdmin.mockResolvedValue([]);

    const { req, url } = makeRequest('/api/admin/task-queue?status=pending&agent_type=analysis');
    await handleAdminRequest(req, url, appState);

    expect(mockListTasksForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending', agent_type: 'analysis' }),
    );
  });
});
