/**
 * Unit tests for the split-channel worker credential model.
 *
 * Tests role name validation and credential pair creation.
 */

import { describe, test, expect } from 'vitest';
import {
  assertQueueCredentialScope,
  createChannelCredentials,
  type WorkerChannelCredentials,
} from './worker-channel';

// ---------------------------------------------------------------------------
// assertQueueCredentialScope
// ---------------------------------------------------------------------------

describe('assertQueueCredentialScope', () => {
  test('accepts a URL with the correct per-type agent role', () => {
    expect(() =>
      assertQueueCredentialScope('postgres://agent_coding:pw@localhost/db', 'coding'),
    ).not.toThrow();
  });

  test('accepts agent_analysis for analysis type', () => {
    expect(() =>
      assertQueueCredentialScope('postgres://agent_analysis:pw@localhost/db', 'analysis'),
    ).not.toThrow();
  });

  test('throws when role does not match agent type', () => {
    expect(() =>
      assertQueueCredentialScope('postgres://agent_analysis:pw@localhost/db', 'coding'),
    ).toThrow(/role mismatch/);
  });

  test('throws when a non-agent role is used', () => {
    expect(() => assertQueueCredentialScope('postgres://app_rw:pw@localhost/db', 'coding')).toThrow(
      /role mismatch/,
    );
  });

  test('throws when URL is malformed', () => {
    expect(() => assertQueueCredentialScope('not-a-url', 'coding')).toThrow(/not a valid/);
  });

  test('error message includes agent type', () => {
    expect(() =>
      assertQueueCredentialScope('postgres://wrong_role:pw@localhost/db', 'coding'),
    ).toThrow(/"coding"/);
  });

  test('error message includes expected role name', () => {
    expect(() =>
      assertQueueCredentialScope('postgres://wrong_role:pw@localhost/db', 'coding'),
    ).toThrow(/agent_coding/);
  });
});

// ---------------------------------------------------------------------------
// createChannelCredentials
// ---------------------------------------------------------------------------

describe('createChannelCredentials', () => {
  const VALID_URL = 'postgres://agent_coding:pw@localhost/db';

  test('returns a valid credential pair when inputs are correct', () => {
    const creds = createChannelCredentials(VALID_URL, 'jwt-token', 'coding', 'task-001');
    expect(creds.queueDatabaseUrl).toBe(VALID_URL);
    expect(creds.delegatedToken).toBe('jwt-token');
    expect(creds.agentType).toBe('coding');
    expect(creds.taskId).toBe('task-001');
  });

  test('throws when queue URL role does not match agent type', () => {
    expect(() =>
      createChannelCredentials(
        'postgres://agent_analysis:pw@localhost/db',
        'jwt-token',
        'coding',
        'task-001',
      ),
    ).toThrow(/role mismatch/);
  });

  test('the returned object satisfies the WorkerChannelCredentials interface', () => {
    const creds: WorkerChannelCredentials = createChannelCredentials(
      VALID_URL,
      'jwt-token',
      'coding',
      'task-002',
    );
    expect(creds).toHaveProperty('queueDatabaseUrl');
    expect(creds).toHaveProperty('delegatedToken');
    expect(creds).toHaveProperty('agentType');
    expect(creds).toHaveProperty('taskId');
  });
});

// ---------------------------------------------------------------------------
// Module export
// ---------------------------------------------------------------------------

describe('worker-channel module exports', () => {
  test('assertQueueCredentialScope is a function', () => {
    expect(typeof assertQueueCredentialScope).toBe('function');
  });

  test('createChannelCredentials is a function', () => {
    expect(typeof createChannelCredentials).toBe('function');
  });
});
