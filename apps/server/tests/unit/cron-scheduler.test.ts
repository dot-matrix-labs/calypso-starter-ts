/**
 * Unit tests for the lightweight cron scheduler.
 *
 * Validates:
 *   - Job registration and duplicate prevention
 *   - Scheduler start/stop lifecycle
 *   - Multiple jobs fire independently
 *   - Cron context provides enqueueCronTask with correct agent_type
 *   - Scheduler idempotent start behavior
 */

import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

// Mock croner before importing the scheduler
vi.mock('croner', () => {
  class MockCron {
    name: string;
    fn: () => void;
    stopped = false;

    constructor(expression: string, options: { name?: string }, fn: () => void) {
      this.name = options.name ?? '';
      this.fn = fn;
      // Auto-fire once for testing
      MockCron.instances.push(this);
    }

    stop() {
      this.stopped = true;
    }

    static instances: MockCron[] = [];
    static reset() {
      MockCron.instances = [];
    }
  }

  return { Cron: MockCron };
});

// Mock db/task-queue
vi.mock('db/task-queue', () => ({
  enqueueTask: vi.fn(async () => ({
    id: 'mock-task-id',
    idempotency_key: 'mock-key',
    agent_type: 'cron',
    job_type: 'test',
    status: 'pending',
    payload: {},
    correlation_id: null,
    created_by: 'cron:test',
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
  })),
}));

import { CronScheduler } from '../../src/cron/scheduler';
import { enqueueTask } from 'db/task-queue';
import { Cron } from 'croner';

beforeEach(() => {
  vi.clearAllMocks();
  (Cron as unknown as { reset: () => void }).reset();
});

describe('CronScheduler', () => {
  let scheduler: CronScheduler;

  beforeEach(() => {
    scheduler = new CronScheduler();
  });

  afterEach(() => {
    scheduler.stop();
  });

  test('register adds a job definition', () => {
    scheduler.register('test-job', '* * * * *', async () => {});
    scheduler.start();
    expect(scheduler.hasJob('test-job')).toBe(true);
    expect(scheduler.getJobNames()).toContain('test-job');
  });

  test('register throws on duplicate job name', () => {
    scheduler.register('dup-job', '* * * * *', async () => {});
    scheduler.start();
    expect(() => scheduler.register('dup-job', '* * * * *', async () => {})).toThrow(
      'already registered',
    );
  });

  test('start creates Cron instances for all registered jobs', () => {
    scheduler.register('job-a', '*/5 * * * *', async () => {});
    scheduler.register('job-b', '0 * * * *', async () => {});
    scheduler.start();

    expect(scheduler.getJobNames()).toEqual(['job-a', 'job-b']);
    expect(scheduler.isStarted()).toBe(true);
    expect((Cron as unknown as { instances: unknown[] }).instances).toHaveLength(2);
  });

  test('start is idempotent', () => {
    scheduler.register('once-job', '* * * * *', async () => {});
    scheduler.start();
    scheduler.start(); // should not throw or create duplicate crons
    expect((Cron as unknown as { instances: unknown[] }).instances).toHaveLength(1);
  });

  test('stop clears all jobs', () => {
    scheduler.register('stop-job', '* * * * *', async () => {});
    scheduler.start();
    expect(scheduler.isStarted()).toBe(true);

    scheduler.stop();
    expect(scheduler.isStarted()).toBe(false);
    expect(scheduler.getJobNames()).toEqual([]);
  });

  test('multiple jobs fire independently', () => {
    const handlerA = vi.fn();
    const handlerB = vi.fn();

    scheduler.register('ind-a', '* * * * *', handlerA);
    scheduler.register('ind-b', '*/2 * * * *', handlerB);
    scheduler.start();

    // Trigger each job's handler directly via the mock
    const instances = (Cron as unknown as { instances: { fn: () => void }[] }).instances;
    instances[0].fn();
    instances[1].fn();

    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerB).toHaveBeenCalledTimes(1);
  });

  test('enqueueCronTask sets agent_type=cron and correct created_by', async () => {
    scheduler.register('enqueue-test', '* * * * *', async (ctx) => {
      await ctx.enqueueCronTask({
        job_type: 'test-sweep',
        payload: { count: 5 },
      });
    });
    scheduler.start();

    // Trigger the handler
    const instances = (Cron as unknown as { instances: { fn: () => void }[] }).instances;
    await instances[0].fn();

    expect(enqueueTask).toHaveBeenCalledTimes(1);
    const call = vi.mocked(enqueueTask).mock.calls[0][0];
    expect(call.agent_type).toBe('cron');
    expect(call.created_by).toBe('cron:enqueue-test');
    expect(call.job_type).toBe('test-sweep');
    expect(call.payload).toEqual({ count: 5 });
    expect(call.idempotency_key).toMatch(/^cron:enqueue-test:/);
  });

  test('enqueueCronTask uses custom idempotency_key_suffix when provided', async () => {
    scheduler.register('suffix-test', '* * * * *', async (ctx) => {
      await ctx.enqueueCronTask({
        job_type: 'custom-suffix',
        idempotency_key_suffix: 'my-custom-key',
      });
    });
    scheduler.start();

    const instances = (Cron as unknown as { instances: { fn: () => void }[] }).instances;
    await instances[0].fn();

    const call = vi.mocked(enqueueTask).mock.calls[0][0];
    expect(call.idempotency_key).toBe('cron:suffix-test:my-custom-key');
  });

  test('cron tasks have agent_type=cron in enqueue call', async () => {
    scheduler.register('agent-type-check', '* * * * *', async (ctx) => {
      await ctx.enqueueCronTask({ job_type: 'verify-agent' });
    });
    scheduler.start();

    const instances = (Cron as unknown as { instances: { fn: () => void }[] }).instances;
    await instances[0].fn();

    const call = vi.mocked(enqueueTask).mock.calls[0][0];
    expect(call.agent_type).toBe('cron');
  });
});

describe('CronScheduler job context', () => {
  test('context jobName matches registered name', async () => {
    const scheduler = new CronScheduler();
    let capturedName = '';

    scheduler.register('name-check', '* * * * *', async (ctx) => {
      capturedName = ctx.jobName;
    });
    scheduler.start();

    const instances = (Cron as unknown as { instances: { fn: () => void }[] }).instances;
    await instances[0].fn();

    expect(capturedName).toBe('name-check');
    scheduler.stop();
  });
});
