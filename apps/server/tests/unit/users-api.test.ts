import { describe, test, expect, vi, afterEach } from 'vitest';
import { handleUsersRequest } from '../../src/api/users';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal mock of AppState for the users handler. */
function makeAppState(rows: unknown[] = [], countRows: unknown[] = [{ count: '0' }]) {
  let callIndex = 0;
  const sequences = [rows, countRows];

  const sql = vi.fn((strings: TemplateStringsArray) => {
    const raw = strings.join('').trim().toUpperCase();

    if (raw.startsWith('SELECT COUNT')) {
      return Promise.resolve(countRows);
    }
    if (raw.startsWith('SELECT')) {
      return Promise.resolve(rows);
    }
    if (raw.startsWith('DELETE')) {
      return Promise.resolve([]);
    }
    return Promise.resolve(sequences[callIndex++] ?? []);
  }) as unknown as import('../../src/index').AppState['sql'];

  return {
    sql,
    auditSql: sql,
    analyticsSql: sql,
  } satisfies import('../../src/index').AppState;
}

/** Create an authenticated request. The auth cookie value is a fake JWT-like
 *  value; the handler calls `getAuthenticatedUser` which calls `verifyJwt`. We
 *  mock the jwt module to avoid needing a real JWT_SECRET. */
function makeRequest(method: string, path: string, cookie = '') {
  return new Request(`http://localhost${path}`, {
    method,
    headers: cookie ? { Cookie: cookie } : {},
  });
}

// ---------------------------------------------------------------------------

describe('handleUsersRequest()', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('returns null for non-/api/users paths', async () => {
    const appState = makeAppState();
    const req = makeRequest('DELETE', '/api/tasks/123');
    const url = new URL(req.url);
    const result = await handleUsersRequest(req, url, appState);
    expect(result).toBeNull();
  });

  test('returns 401 when not authenticated', async () => {
    const appState = makeAppState();
    const req = makeRequest('DELETE', '/api/users/some-id');
    const url = new URL(req.url);
    const result = await handleUsersRequest(req, url, appState);
    expect(result?.status).toBe(401);
  });

  test('returns 404 when target user does not exist', async () => {
    // Mock getAuthenticatedUser to return a user
    const authModule = await import('../../src/api/auth');
    vi.spyOn(authModule, 'getAuthenticatedUser').mockResolvedValue({
      id: 'caller-id',
      username: 'caller',
    });

    const appState = makeAppState([], [{ count: '0' }]);

    const req = makeRequest('DELETE', '/api/users/nonexistent-id', 'calypso_auth=fake-token');
    const url = new URL(req.url);
    const result = await handleUsersRequest(req, url, appState);
    expect(result?.status).toBe(404);
  });

  test('returns 409 when deleting the last superuser', async () => {
    const authModule = await import('../../src/api/auth');
    vi.spyOn(authModule, 'getAuthenticatedUser').mockResolvedValue({
      id: 'caller-id',
      username: 'caller',
    });

    // Target user is a superuser
    const targetUser = { id: 'super-id', properties: { role: 'superuser', username: 'admin' } };
    const countRow = [{ count: '1' }];

    const sql = vi.fn((strings: TemplateStringsArray) => {
      const raw = strings.join('').trim().toUpperCase();
      if (raw.startsWith('SELECT COUNT')) return Promise.resolve(countRow);
      if (raw.startsWith('SELECT')) return Promise.resolve([targetUser]);
      return Promise.resolve([]);
    }) as unknown as import('../../src/index').AppState['sql'];

    const appState = {
      sql,
      auditSql: sql,
      analyticsSql: sql,
    } satisfies import('../../src/index').AppState;

    const req = makeRequest('DELETE', '/api/users/super-id', 'calypso_auth=fake-token');
    const url = new URL(req.url);
    const result = await handleUsersRequest(req, url, appState);
    expect(result?.status).toBe(409);
    const body = await result?.json();
    expect(body.code).toBe('LAST_SUPERUSER');
  });

  test('allows deleting a superuser when another superuser exists', async () => {
    const authModule = await import('../../src/api/auth');
    vi.spyOn(authModule, 'getAuthenticatedUser').mockResolvedValue({
      id: 'caller-id',
      username: 'caller',
    });

    const targetUser = { id: 'super-id', properties: { role: 'superuser', username: 'admin' } };
    const countRow = [{ count: '2' }];

    const sql = vi.fn((strings: TemplateStringsArray) => {
      const raw = strings.join('').trim().toUpperCase();
      if (raw.startsWith('SELECT COUNT')) return Promise.resolve(countRow);
      if (raw.startsWith('SELECT')) return Promise.resolve([targetUser]);
      return Promise.resolve([]);
    }) as unknown as import('../../src/index').AppState['sql'];

    const appState = {
      sql,
      auditSql: sql,
      analyticsSql: sql,
    } satisfies import('../../src/index').AppState;

    const req = makeRequest('DELETE', '/api/users/super-id', 'calypso_auth=fake-token');
    const url = new URL(req.url);
    const result = await handleUsersRequest(req, url, appState);
    expect(result?.status).toBe(200);
    const body = await result?.json();
    expect(body.success).toBe(true);
  });

  test('allows deleting a regular (non-superuser) user', async () => {
    const authModule = await import('../../src/api/auth');
    vi.spyOn(authModule, 'getAuthenticatedUser').mockResolvedValue({
      id: 'caller-id',
      username: 'caller',
    });

    const targetUser = { id: 'regular-id', properties: { username: 'bob' } };

    const sql = vi.fn((strings: TemplateStringsArray) => {
      const raw = strings.join('').trim().toUpperCase();
      if (raw.startsWith('SELECT')) return Promise.resolve([targetUser]);
      return Promise.resolve([]);
    }) as unknown as import('../../src/index').AppState['sql'];

    const appState = {
      sql,
      auditSql: sql,
      analyticsSql: sql,
    } satisfies import('../../src/index').AppState;

    const req = makeRequest('DELETE', '/api/users/regular-id', 'calypso_auth=fake-token');
    const url = new URL(req.url);
    const result = await handleUsersRequest(req, url, appState);
    expect(result?.status).toBe(200);
    const body = await result?.json();
    expect(body.success).toBe(true);
  });
});
