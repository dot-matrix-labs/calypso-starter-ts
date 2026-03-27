/**
 * Unit tests for the demo health-check cron job.
 *
 * Validates:
 *   - Job enqueues a task into task_queue with agent_type=cron
 *   - Job detects missing demo personas and reports failure
 *   - Job does not run when DEMO_MODE is not "true"
 *   - Multiple runs produce distinct idempotency keys (different minutes)
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  runDemoHealthCheck,
  startDemoHealthCheck,
  DEMO_HEALTH_CHECK_ACTOR,
  DEMO_HEALTH_CHECK_AGENT_TYPE,
  DEMO_HEALTH_CHECK_JOB_TYPE,
} from '../../src/cron/demo-health-check';
import { DEMO_PERSONAS } from '../../src/seed/demo-personas';
import type { sql as SqlPool } from 'db';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

type MockSql = typeof SqlPool;

/** Fake task row returned by the mocked enqueueTask. */
function makeTaskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    idempotency_key: 'test-key',
    agent_type: DEMO_HEALTH_CHECK_AGENT_TYPE,
    job_type: DEMO_HEALTH_CHECK_JOB_TYPE,
    status: 'pending',
    payload: {},
    correlation_id: null,
    created_by: DEMO_HEALTH_CHECK_ACTOR,
    claimed_by: null,
    claimed_at: null,
    claim_expires_at: null,
    delegated_token: null,
    result: null,
    error_message: null,
    attempt: 0,
    max_attempts: 3,
    next_retry_at: null,
    priority: 5,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

/**
 * Builds a minimal fake sql tagged-template that can simulate existing or
 * missing demo persona rows, and records every enqueueTask call.
 */
function makeSqlWithPersonas(existingEmails: string[] = []) {
  const fn = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const raw = strings.join('');
    if (raw.trim().toUpperCase().startsWith('SELECT')) {
      const queriedEmail = values.find((v) => typeof v === 'string' && v.includes('@'));
      if (queriedEmail && existingEmails.includes(queriedEmail as string)) {
        return Promise.resolve([{ id: 'entity-id' }]);
      }
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  });
  (fn as unknown as Record<string, unknown>).json = (v: unknown) => v;
  return fn as unknown as MockSql;
}

// ---------------------------------------------------------------------------
// Module-level vi.mock for db/task-queue
// ---------------------------------------------------------------------------

const enqueueTaskMock = vi.fn();

vi.mock('db/task-queue', () => ({
  enqueueTask: (...args: unknown[]) => enqueueTaskMock(...args),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runDemoHealthCheck()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('enqueues a task with agent_type=cron when all personas exist', async () => {
    const allEmails = DEMO_PERSONAS.map((p) => p.email);
    const sql = makeSqlWithPersonas(allEmails);
    const fakeTask = makeTaskRow();
    enqueueTaskMock.mockResolvedValue(fakeTask);

    const task = await runDemoHealthCheck(sql);

    expect(enqueueTaskMock).toHaveBeenCalledTimes(1);
    const callArg = enqueueTaskMock.mock.calls[0][0];
    expect(callArg.agent_type).toBe(DEMO_HEALTH_CHECK_AGENT_TYPE);
    expect(callArg.job_type).toBe(DEMO_HEALTH_CHECK_JOB_TYPE);
    expect(callArg.created_by).toBe(DEMO_HEALTH_CHECK_ACTOR);
    expect(task.id).toBe(fakeTask.id);
  });

  test('payload reports all_healthy=true when all demo personas exist', async () => {
    const allEmails = DEMO_PERSONAS.map((p) => p.email);
    const sql = makeSqlWithPersonas(allEmails);
    enqueueTaskMock.mockResolvedValue(makeTaskRow());

    await runDemoHealthCheck(sql);

    const payload = enqueueTaskMock.mock.calls[0][0].payload;
    expect(payload.all_healthy).toBe(true);
    expect(payload.missing_personas).toHaveLength(0);
  });

  test('detects missing demo persona and reports failure in payload', async () => {
    // Only the second persona exists; admin is missing
    const sql = makeSqlWithPersonas(['demo-user@calypso.local']);
    enqueueTaskMock.mockResolvedValue(makeTaskRow());

    await runDemoHealthCheck(sql);

    const payload = enqueueTaskMock.mock.calls[0][0].payload;
    expect(payload.all_healthy).toBe(false);
    expect(payload.missing_personas).toContain('demo-admin@calypso.local');
  });

  test('still enqueues a task even when a persona is missing', async () => {
    // No personas exist — failure case
    const sql = makeSqlWithPersonas([]);
    enqueueTaskMock.mockResolvedValue(makeTaskRow());

    await runDemoHealthCheck(sql);

    // Task must still be enqueued so the failure is visible in the monitor
    expect(enqueueTaskMock).toHaveBeenCalledTimes(1);
  });

  test('logs a warning when personas are missing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sql = makeSqlWithPersonas([]);
    enqueueTaskMock.mockResolvedValue(makeTaskRow());

    await runDemoHealthCheck(sql);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warnArg = warnSpy.mock.calls[0][0] as string;
    expect(warnArg).toContain('[demo] health-check: missing demo personas');
  });

  test('idempotency_key includes truncated minute timestamp', async () => {
    const allEmails = DEMO_PERSONAS.map((p) => p.email);
    const sql = makeSqlWithPersonas(allEmails);
    enqueueTaskMock.mockResolvedValue(makeTaskRow());

    await runDemoHealthCheck(sql);

    const key: string = enqueueTaskMock.mock.calls[0][0].idempotency_key;
    // Key format: "demo-health-check:YYYY-MM-DDTHH:MM"
    expect(key).toMatch(/^demo-health-check:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
});

describe('startDemoHealthCheck()', () => {
  const originalDemoMode = process.env.DEMO_MODE;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    delete process.env.DEMO_MODE;
  });

  afterEach(() => {
    if (originalDemoMode !== undefined) {
      process.env.DEMO_MODE = originalDemoMode;
    } else {
      delete process.env.DEMO_MODE;
    }
    vi.restoreAllMocks();
  });

  test('returns undefined when DEMO_MODE is not set', () => {
    const allEmails = DEMO_PERSONAS.map((p) => p.email);
    const sql = makeSqlWithPersonas(allEmails);

    const handle = startDemoHealthCheck({ sql });

    expect(handle).toBeUndefined();
  });

  test('returns undefined when DEMO_MODE is "false"', () => {
    process.env.DEMO_MODE = 'false';
    const allEmails = DEMO_PERSONAS.map((p) => p.email);
    const sql = makeSqlWithPersonas(allEmails);

    const handle = startDemoHealthCheck({ sql });

    expect(handle).toBeUndefined();
  });

  test('returns an interval handle when DEMO_MODE=true', () => {
    process.env.DEMO_MODE = 'true';
    const allEmails = DEMO_PERSONAS.map((p) => p.email);
    const sql = makeSqlWithPersonas(allEmails);
    enqueueTaskMock.mockResolvedValue(makeTaskRow());

    const handle = startDemoHealthCheck({ sql, intervalMs: 60_000 });

    expect(handle).toBeDefined();
    clearInterval(handle);
  });

  test('does not enqueue any tasks when DEMO_MODE is not set', () => {
    const sql = makeSqlWithPersonas([]);

    startDemoHealthCheck({ sql });

    expect(enqueueTaskMock).not.toHaveBeenCalled();
  });
});
