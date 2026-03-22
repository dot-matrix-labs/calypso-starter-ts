/**
 * Unit tests for single-use task-scoped delegated tokens (issue #40).
 *
 * These tests exercise issueDelegatedToken and verifyDelegatedToken in
 * isolation.  The revocation-store check requires a real Postgres connection;
 * tests that exercise single-use semantics are marked as integration and
 * live in tests/integration/.
 *
 * Tests here cover everything that can be verified without a database:
 *   - Token payload shape
 *   - Expiry rejection
 *   - Scope mismatch rejection
 *   - task_id mismatch rejection
 */

import { describe, expect, test, vi } from 'vitest';
import { issueDelegatedToken } from '../../src/auth/delegated-token';
import { verifyJwt } from '../../src/auth/jwt';

// ---------------------------------------------------------------------------
// issueDelegatedToken
// ---------------------------------------------------------------------------

describe('issueDelegatedToken', () => {
  test('returns a JWT with correct payload claims', async () => {
    const token = await issueDelegatedToken({
      userId: 'user-abc',
      taskId: 'task-xyz',
      agentType: 'claude-code',
    });

    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3);

    const payload = await verifyJwt<{
      sub: string;
      task_id: string;
      agent_type: string;
      jti: string;
      scope: string;
      exp: number;
    }>(token);

    expect(payload.sub).toBe('user-abc');
    expect(payload.task_id).toBe('task-xyz');
    expect(payload.agent_type).toBe('claude-code');
    expect(payload.scope).toBe('task_result');
    expect(typeof payload.jti).toBe('string');
    expect(payload.jti.length).toBeGreaterThan(0);
    expect(typeof payload.exp).toBe('number');
  });

  test('jti is unique per issuance', async () => {
    const t1 = await issueDelegatedToken({ userId: 'u', taskId: 't1', agentType: 'ag' });
    const t2 = await issueDelegatedToken({ userId: 'u', taskId: 't2', agentType: 'ag' });

    const p1 = await verifyJwt<{ jti: string }>(t1);
    const p2 = await verifyJwt<{ jti: string }>(t2);

    expect(p1.jti).not.toBe(p2.jti);
  });

  test('token expires approximately 15 minutes from now', async () => {
    const before = Math.floor(Date.now() / 1000);
    const token = await issueDelegatedToken({ userId: 'u', taskId: 't', agentType: 'ag' });
    const after = Math.floor(Date.now() / 1000);

    const payload = await verifyJwt<{ exp: number }>(token);
    const ttl = payload.exp - before;

    // Should be ~900 seconds (15 minutes); allow ±5 seconds for test clock drift
    expect(ttl).toBeGreaterThanOrEqual(895);
    expect(ttl).toBeLessThanOrEqual(after + 900 - before + 5);
  });
});

// ---------------------------------------------------------------------------
// verifyDelegatedToken — checks that can be validated without a real DB
// These tests mock the sql import used inside verifyDelegatedToken.
// ---------------------------------------------------------------------------

// We need to mock the 'db' module before importing verifyDelegatedToken.
// Use vi.mock at the top level so Vitest hoists it.
vi.mock('db', () => {
  // Return a tagged-template sql function that simulates "no rows" (JTI not revoked).
  const sql = Object.assign(
    // Template-literal call
    async () => [],
    {
      // Allow sql.json() used elsewhere
      json: (v: unknown) => v,
    },
  );
  return { sql, auditSql: sql, analyticsSql: sql };
});

// Import after mock is registered
const { verifyDelegatedToken } = await import('../../src/auth/delegated-token');

describe('verifyDelegatedToken', () => {
  test('accepts a valid unused token', async () => {
    const token = await issueDelegatedToken({
      userId: 'user-1',
      taskId: 'task-1',
      agentType: 'claude-code',
    });

    const payload = await verifyDelegatedToken(token, {
      expectedTaskId: 'task-1',
      expectedAgentType: 'claude-code',
      expectedCreatedBy: 'user-1',
    });

    expect(payload.sub).toBe('user-1');
    expect(payload.task_id).toBe('task-1');
    expect(payload.scope).toBe('task_result');
  });

  test('rejects when task_id does not match', async () => {
    const token = await issueDelegatedToken({
      userId: 'user-1',
      taskId: 'task-1',
      agentType: 'claude-code',
    });

    await expect(
      verifyDelegatedToken(token, {
        expectedTaskId: 'task-WRONG',
        expectedAgentType: 'claude-code',
        expectedCreatedBy: 'user-1',
      }),
    ).rejects.toThrow('Token task_id mismatch');
  });

  test('rejects when agent_type does not match', async () => {
    const token = await issueDelegatedToken({
      userId: 'user-1',
      taskId: 'task-1',
      agentType: 'claude-code',
    });

    await expect(
      verifyDelegatedToken(token, {
        expectedTaskId: 'task-1',
        expectedAgentType: 'wrong-agent',
        expectedCreatedBy: 'user-1',
      }),
    ).rejects.toThrow('Token agent_type mismatch');
  });

  test('rejects when sub (created_by) does not match', async () => {
    const token = await issueDelegatedToken({
      userId: 'user-1',
      taskId: 'task-1',
      agentType: 'claude-code',
    });

    await expect(
      verifyDelegatedToken(token, {
        expectedTaskId: 'task-1',
        expectedAgentType: 'claude-code',
        expectedCreatedBy: 'user-WRONG',
      }),
    ).rejects.toThrow('Token sub mismatch');
  });

  test('rejects an expired token', async () => {
    // Sign a token with a negative TTL so it is already expired
    const { signJwt } = await import('../../src/auth/jwt');
    const expiredToken = await signJwt(
      {
        sub: 'user-1',
        task_id: 'task-1',
        agent_type: 'claude-code',
        jti: crypto.randomUUID(),
        scope: 'task_result',
      },
      -1 / 3600, // -1 second TTL
    );

    await expect(
      verifyDelegatedToken(expiredToken, {
        expectedTaskId: 'task-1',
        expectedAgentType: 'claude-code',
        expectedCreatedBy: 'user-1',
      }),
    ).rejects.toThrow('Token expired');
  });

  test('rejects a token with the wrong scope', async () => {
    // Issue a token with a different scope by signing directly
    const { signJwt } = await import('../../src/auth/jwt');
    const badScopeToken = await signJwt({
      sub: 'user-1',
      task_id: 'task-1',
      agent_type: 'claude-code',
      jti: crypto.randomUUID(),
      scope: 'analytics:read', // wrong scope
    });

    await expect(
      verifyDelegatedToken(badScopeToken, {
        expectedTaskId: 'task-1',
        expectedAgentType: 'claude-code',
        expectedCreatedBy: 'user-1',
      }),
    ).rejects.toThrow('Token scope is not task_result');
  });
});
