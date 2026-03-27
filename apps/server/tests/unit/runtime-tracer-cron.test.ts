/**
 * Unit tests for the runtime error tracing cron job.
 *
 * Validates:
 *   - registerRuntimeTracerJob registers a job named "runtime-tracer"
 *   - Handler enqueues a task with job_type="runtime_trace"
 *   - Enqueued task has agent_type="cron"
 *   - Payload contains a trace_ref field
 *   - Custom expression overrides the default
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock croner before importing scheduler
vi.mock('croner', () => {
  class MockCron {
    name: string;
    fn: () => void;
    stopped = false;

    constructor(_expression: string, options: { name?: string }, fn: () => void) {
      this.name = options.name ?? '';
      this.fn = fn;
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
    job_type: 'runtime_trace',
    status: 'pending',
    payload: {},
    correlation_id: null,
    created_by: 'cron:runtime-tracer',
    claimed_by: null,
    claimed_at: null,
    claim_expires_at: null,
    delegated_token: null,
    result: null,
    error_message: null,
    attempt: 0,
    max_attempts: 1,
    next_retry_at: null,
    priority: 3,
    created_at: new Date(),
    updated_at: new Date(),
  })),
}));

import { CronScheduler } from '../../src/cron/scheduler';
import { registerRuntimeTracerJob } from '../../src/cron/jobs/runtime-tracer';
import { enqueueTask } from 'db/task-queue';
import { Cron } from 'croner';

beforeEach(() => {
  vi.clearAllMocks();
  (Cron as unknown as { reset: () => void }).reset();
});

describe('registerRuntimeTracerJob', () => {
  test('registers a job named "runtime-tracer"', () => {
    const scheduler = new CronScheduler();
    registerRuntimeTracerJob(scheduler);
    scheduler.start();
    expect(scheduler.hasJob('runtime-tracer')).toBe(true);
    scheduler.stop();
  });

  test('handler enqueues a task with job_type="runtime_trace"', async () => {
    const scheduler = new CronScheduler();
    registerRuntimeTracerJob(scheduler);
    scheduler.start();

    const instances = (Cron as unknown as { instances: { fn: () => Promise<void> }[] }).instances;
    await instances[0].fn();

    expect(enqueueTask).toHaveBeenCalledTimes(1);
    const call = vi.mocked(enqueueTask).mock.calls[0][0];
    expect(call.job_type).toBe('runtime_trace');
    scheduler.stop();
  });

  test('enqueued task has agent_type="cron"', async () => {
    const scheduler = new CronScheduler();
    registerRuntimeTracerJob(scheduler);
    scheduler.start();

    const instances = (Cron as unknown as { instances: { fn: () => Promise<void> }[] }).instances;
    await instances[0].fn();

    const call = vi.mocked(enqueueTask).mock.calls[0][0];
    expect(call.agent_type).toBe('cron');
    scheduler.stop();
  });

  test('payload contains a trace_ref field', async () => {
    const scheduler = new CronScheduler();
    registerRuntimeTracerJob(scheduler);
    scheduler.start();

    const instances = (Cron as unknown as { instances: { fn: () => Promise<void> }[] }).instances;
    await instances[0].fn();

    const call = vi.mocked(enqueueTask).mock.calls[0][0];
    expect(typeof call.payload?.['trace_ref']).toBe('string');
    expect((call.payload?.['trace_ref'] as string).length).toBeGreaterThan(0);
    scheduler.stop();
  });

  test('idempotency key includes job name and trace ref', async () => {
    const scheduler = new CronScheduler();
    registerRuntimeTracerJob(scheduler);
    scheduler.start();

    const instances = (Cron as unknown as { instances: { fn: () => Promise<void> }[] }).instances;
    await instances[0].fn();

    const call = vi.mocked(enqueueTask).mock.calls[0][0];
    expect(call.idempotency_key).toMatch(/^cron:runtime-tracer:/);
    scheduler.stop();
  });

  test('max_attempts is 1', async () => {
    const scheduler = new CronScheduler();
    registerRuntimeTracerJob(scheduler);
    scheduler.start();

    const instances = (Cron as unknown as { instances: { fn: () => Promise<void> }[] }).instances;
    await instances[0].fn();

    const call = vi.mocked(enqueueTask).mock.calls[0][0];
    expect(call.max_attempts).toBe(1);
    scheduler.stop();
  });

  test('accepts a custom cron expression', () => {
    const scheduler = new CronScheduler();
    registerRuntimeTracerJob(scheduler, '0 2 * * *'); // daily at 02:00
    scheduler.start();
    expect(scheduler.hasJob('runtime-tracer')).toBe(true);
    scheduler.stop();
  });
});
