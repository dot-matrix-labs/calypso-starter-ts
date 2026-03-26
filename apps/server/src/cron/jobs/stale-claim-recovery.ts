/**
 * Stale-claim recovery cron job.
 *
 * Replaces the previous setInterval-based scheduler with a cron-scheduled
 * job that runs every minute. Each sweep recovers expired claims and emits
 * audit events, then enqueues a cron task into task_queue for visibility
 * in the admin task queue view.
 */

import { recoverStaleClaims } from 'db/task-queue';
import { auditRecoveredRows } from '../../policies/stale-claim-recovery-service';
import type { CronScheduler } from '../scheduler';

/**
 * Registers the stale-claim recovery job on the given scheduler.
 *
 * @param scheduler - The cron scheduler instance.
 * @param expression - Cron expression. Defaults to every minute.
 */
export function registerStaleClaimRecoveryJob(
  scheduler: CronScheduler,
  expression = '* * * * *',
): void {
  scheduler.register('stale-claim-recovery', expression, async (ctx) => {
    const rows = await recoverStaleClaims();

    if (rows.length > 0) {
      await auditRecoveredRows(rows);
    }

    // Enqueue a cron task so the sweep is visible in the admin task queue.
    await ctx.enqueueCronTask({
      job_type: 'stale-claim-recovery',
      payload: { recovered_count: rows.length, swept_at: new Date().toISOString() },
      idempotency_key_suffix: `sweep-${Date.now()}`,
    });
  });
}
