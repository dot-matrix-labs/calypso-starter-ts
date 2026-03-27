/**
 * @file cron/demo-health-check
 * Recurring health-check cron job for demo persona liveness.
 *
 * When DEMO_MODE=true, a recurring job runs every 2 minutes to verify that
 * demo personas exist and are active. Each run enqueues a health-check task
 * into task_queue with agent_type=cron, producing visible activity in the
 * admin task queue monitor.
 *
 * The job does NOT run when DEMO_MODE is not set or is not "true".
 *
 * ## Design
 * - Uses setInterval with an unref'd timer so the job does not block
 *   process exit in test or graceful shutdown scenarios.
 * - Each interval generates a unique idempotency_key containing the ISO
 *   timestamp (truncated to the minute) to prevent duplicate tasks within
 *   the same 2-minute window while allowing distinct entries across runs.
 * - created_by is set to the system actor 'system:demo-health-check' to
 *   distinguish cron-sourced tasks from user-sourced tasks.
 * - The payload contains only opaque identifiers (TQ-P-002): persona emails
 *   are included as audit context but not as resolvable credentials.
 *
 * ## Canonical references
 * - calypso-blueprint/ — task-queue design (TQ-A-001, TQ-P-002, TQ-P-003)
 * - apps/server/src/seed/demo-personas.ts — DEMO_PERSONAS definition
 */

import type { sql as SqlPool } from 'db';
import { enqueueTask } from 'db/task-queue';
import { DEMO_PERSONAS } from '../seed/demo-personas';

export interface DemoHealthCheckOptions {
  /** postgres.js connection pool injected at startup */
  sql: typeof SqlPool;
  /** Interval in milliseconds. Defaults to 2 minutes. */
  intervalMs?: number;
}

/** System actor ID recorded in task_queue.created_by */
export const DEMO_HEALTH_CHECK_ACTOR = 'system:demo-health-check';

/** agent_type label written to every health-check task row */
export const DEMO_HEALTH_CHECK_AGENT_TYPE = 'cron';

/** job_type label written to every health-check task row */
export const DEMO_HEALTH_CHECK_JOB_TYPE = 'demo.health_check';

/**
 * Run one health-check iteration.
 *
 * 1. Verify each demo persona exists in the entities table.
 * 2. Enqueue a single health-check task summarising the result.
 *
 * The task is always enqueued even when a persona is missing so that the
 * failure is visible in the admin task queue monitor.
 *
 * @param sql - postgres.js pool
 * @returns the enqueued TaskQueueRow
 */
export async function runDemoHealthCheck(sql: typeof SqlPool) {
  const runTs = new Date();
  // Idempotency key is scoped to the truncated minute so a retry within the
  // same 2-minute window does not create a duplicate task.
  const minuteKey = runTs.toISOString().slice(0, 16); // "YYYY-MM-DDTHH:MM"
  const idempotency_key = `demo-health-check:${minuteKey}`;

  const results: { email: string; exists: boolean }[] = [];

  for (const persona of DEMO_PERSONAS) {
    const rows = await sql<{ id: string }[]>`
      SELECT id
      FROM entities
      WHERE type = 'user'
        AND properties->>'email' = ${persona.email}
      LIMIT 1
    `;
    results.push({ email: persona.email, exists: rows.length > 0 });
  }

  const allHealthy = results.every((r) => r.exists);
  const missing = results.filter((r) => !r.exists).map((r) => r.email);

  const task = await enqueueTask({
    idempotency_key,
    agent_type: DEMO_HEALTH_CHECK_AGENT_TYPE,
    job_type: DEMO_HEALTH_CHECK_JOB_TYPE,
    payload: {
      checked_at: runTs.toISOString(),
      all_healthy: allHealthy,
      missing_personas: missing,
      persona_count: DEMO_PERSONAS.length,
    },
    created_by: DEMO_HEALTH_CHECK_ACTOR,
  });

  if (!allHealthy) {
    console.warn(`[demo] health-check: missing demo personas: ${missing.join(', ')}`);
  } else {
    console.log(
      `[demo] health-check: all ${DEMO_PERSONAS.length} personas healthy (task ${task.id})`,
    );
  }

  return task;
}

/**
 * Start the demo health-check cron job.
 *
 * Returns undefined immediately when DEMO_MODE is not "true" so the caller
 * does not need to guard the call site.
 *
 * @param options - sql pool and optional interval override
 * @returns the interval handle (already unref'd), or undefined when not started
 */
export function startDemoHealthCheck(
  options: DemoHealthCheckOptions,
): ReturnType<typeof setInterval> | undefined {
  if (process.env.DEMO_MODE !== 'true') {
    return undefined;
  }

  const { sql, intervalMs = 2 * 60 * 1000 } = options;

  console.log(`[demo] Starting health-check cron job (every ${intervalMs / 1000}s).`);

  // Run once immediately on startup so the first task appears without waiting
  // a full interval.
  runDemoHealthCheck(sql).catch((err) =>
    console.error('[demo] health-check initial run failed:', err),
  );

  const handle = setInterval(() => {
    runDemoHealthCheck(sql).catch((err) =>
      console.error('[demo] health-check interval run failed:', err),
    );
  }, intervalMs);

  // Unref so the timer does not prevent process exit.
  handle.unref();

  return handle;
}
