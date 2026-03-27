/**
 * Cron scheduler boot module.
 *
 * Creates and starts the singleton CronScheduler, registering all cron jobs.
 * Called once from the server entrypoint (index.ts).
 */

import { CronScheduler } from './scheduler';
import { registerStaleClaimRecoveryJob } from './jobs/stale-claim-recovery';
import { registerSecurityScannerJob } from './jobs/security-scanner';
import { registerSocComplianceReviewJob } from './jobs/soc-compliance-review';
import { registerRuntimeTracerJob } from './jobs/runtime-tracer';

let scheduler: CronScheduler | null = null;

/**
 * Starts the cron scheduler and registers all jobs. Idempotent — calling
 * more than once returns the existing scheduler.
 */
export function startCronScheduler(): CronScheduler {
  if (scheduler) {
    return scheduler;
  }

  scheduler = new CronScheduler();

  // Register jobs
  registerStaleClaimRecoveryJob(scheduler);
  registerSecurityScannerJob(scheduler);
  registerSocComplianceReviewJob(scheduler);
  registerRuntimeTracerJob(scheduler);

  scheduler.start();
  return scheduler;
}

/**
 * Stops the cron scheduler. Safe to call even if not started.
 */
export function stopCronScheduler(): void {
  if (scheduler) {
    scheduler.stop();
    scheduler = null;
  }
}
