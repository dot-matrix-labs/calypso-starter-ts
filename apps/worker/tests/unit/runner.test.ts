/**
 * Unit tests for the Codex task runner helpers.
 *
 * Tests environment variable loading and the API result submission URL
 * construction without spawning real subprocesses or making real HTTP calls.
 */

import { describe, test, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Mirror pure helpers for isolated testing
// ---------------------------------------------------------------------------

/** Mirror of environment loading logic from runner.ts */
function loadRunnerConfig(env: NodeJS.ProcessEnv): {
  codexPath: string;
  apiBaseUrl: string;
  workerId: string;
} {
  const apiBaseUrl = env.API_BASE_URL;
  if (!apiBaseUrl) throw new Error('Missing required environment variable: API_BASE_URL');

  return {
    codexPath: env.CODEX_PATH ?? '/usr/local/bin/codex',
    apiBaseUrl,
    workerId: env.WORKER_ID ?? 'test-worker',
  };
}

/** Mirror of API result submission URL construction */
function buildResultUrl(apiBaseUrl: string, taskId: string): string {
  return `${apiBaseUrl}/api/tasks/${encodeURIComponent(taskId)}/result`;
}

// ---------------------------------------------------------------------------
// Runner config loading
// ---------------------------------------------------------------------------

describe('loadRunnerConfig', () => {
  test('loads required API_BASE_URL', () => {
    const config = loadRunnerConfig({
      API_BASE_URL: 'https://example.com',
      AGENT_DATABASE_URL: 'postgres://localhost/test',
      AGENT_TYPE: 'coding',
    });
    expect(config.apiBaseUrl).toBe('https://example.com');
  });

  test('throws when API_BASE_URL is missing', () => {
    expect(() => loadRunnerConfig({})).toThrow('API_BASE_URL');
  });

  test('defaults codexPath to /usr/local/bin/codex', () => {
    const config = loadRunnerConfig({ API_BASE_URL: 'https://example.com' });
    expect(config.codexPath).toBe('/usr/local/bin/codex');
  });

  test('uses CODEX_PATH override when set', () => {
    const config = loadRunnerConfig({
      API_BASE_URL: 'https://example.com',
      CODEX_PATH: '/opt/codex/bin/codex',
    });
    expect(config.codexPath).toBe('/opt/codex/bin/codex');
  });

  test('uses WORKER_ID when set', () => {
    const config = loadRunnerConfig({
      API_BASE_URL: 'https://example.com',
      WORKER_ID: 'worker-abc123',
    });
    expect(config.workerId).toBe('worker-abc123');
  });

  test('defaults workerId to test-worker (hostname fallback in test env)', () => {
    const config = loadRunnerConfig({ API_BASE_URL: 'https://example.com' });
    expect(config.workerId).toBe('test-worker');
  });
});

// ---------------------------------------------------------------------------
// Result submission URL construction
// ---------------------------------------------------------------------------

describe('buildResultUrl', () => {
  test('constructs correct URL for simple task ID', () => {
    expect(buildResultUrl('https://api.example.com', 'abc-123')).toBe(
      'https://api.example.com/api/tasks/abc-123/result',
    );
  });

  test('URL-encodes task IDs containing special characters', () => {
    expect(buildResultUrl('https://api.example.com', 'task/with/slashes')).toBe(
      'https://api.example.com/api/tasks/task%2Fwith%2Fslashes/result',
    );
  });

  test('handles UUID-format task IDs', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(buildResultUrl('https://api.example.com', uuid)).toBe(
      `https://api.example.com/api/tasks/${uuid}/result`,
    );
  });
});

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------

describe('runner module exports', () => {
  test('startRunner is exported as a function', async () => {
    // We can't actually call startRunner in unit tests (requires DB + env),
    // but we can verify the export is a function.
    const mod = await import('../../src/runner.js');
    expect(typeof mod.startRunner).toBe('function');
  });
});
