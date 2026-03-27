/**
 * Runtime error tracing cron job.
 *
 * Enqueues a `runtime_trace` task into the task queue on a configurable
 * schedule (default: every 6 hours). The task is picked up by a worker
 * running with agent_type="cron" and executed via Claude CLI with a
 * runtime error tracing prompt.
 *
 * The cron job enqueues once per run. The worker performs read-only log
 * analysis and stores structured JSON findings in the task queue result.
 */

import type { CronScheduler } from '../scheduler';

/** Default cron expression: every 6 hours. */
const DEFAULT_EXPRESSION = '0 */6 * * *';

/**
 * Registers the runtime error tracing job on the given scheduler.
 *
 * @param scheduler   - The cron scheduler instance.
 * @param expression  - Cron expression. Defaults to every 6 hours.
 */
export function registerRuntimeTracerJob(
  scheduler: CronScheduler,
  expression = DEFAULT_EXPRESSION,
): void {
  scheduler.register('runtime-tracer', expression, async (ctx) => {
    const traceRef = `trace-${Date.now()}`;

    await ctx.enqueueCronTask({
      job_type: 'runtime_trace',
      payload: { trace_ref: traceRef },
      idempotency_key_suffix: traceRef,
      // Runtime traces are lower priority than interactive tasks.
      priority: 3,
      // A single attempt per scheduled run; failures appear in task queue.
      max_attempts: 1,
    });

    console.log(`[cron] runtime-tracer enqueued trace task with trace_ref=${traceRef}`);
  });
}
