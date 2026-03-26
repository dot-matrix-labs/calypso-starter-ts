/**
 * Lightweight in-process cron scheduler.
 *
 * Wraps croner to provide a simple job registration API. Each registered job
 * runs on its cron expression and can optionally enqueue tasks into
 * task_queue with agent_type=cron.
 *
 * Usage:
 *   import { CronScheduler } from './cron/scheduler';
 *   const scheduler = new CronScheduler();
 *   scheduler.register('stale-recovery', '* * * * *', async () => { ... });
 *   scheduler.start();
 */

import { Cron, type CronOptions } from 'croner';
import { enqueueTask } from 'db/task-queue';

export interface CronJobDefinition {
  /** Unique name for the job. Used as part of the idempotency key. */
  name: string;
  /** Cron expression (standard 5-field or 6-field with seconds). */
  expression: string;
  /**
   * The function to execute on each tick. Receives a helper to enqueue a
   * task_queue row with agent_type=cron pre-filled.
   */
  handler: (ctx: CronJobContext) => Promise<void> | void;
}

export interface CronJobContext {
  /** Job name as registered. */
  jobName: string;
  /**
   * Enqueue a task into task_queue with agent_type='cron' and created_by
   * set to `cron:<jobName>`. The caller provides job_type, payload, and
   * an optional idempotency key suffix.
   */
  enqueueCronTask: (opts: {
    job_type: string;
    payload?: Record<string, unknown>;
    idempotency_key_suffix?: string;
    priority?: number;
    max_attempts?: number;
  }) => Promise<void>;
}

export class CronScheduler {
  private jobs: Map<string, Cron> = new Map();
  private definitions: CronJobDefinition[] = [];
  private started = false;

  /**
   * Register a cron job definition. Jobs are not started until start() is
   * called, so registration order does not matter.
   */
  register(name: string, expression: string, handler: CronJobDefinition['handler']): void {
    if (this.jobs.has(name)) {
      throw new Error(`[cron] Job "${name}" is already registered`);
    }
    this.definitions.push({ name, expression, handler });
  }

  /**
   * Start all registered jobs. Each job creates a croner Cron instance that
   * fires on the configured expression.
   */
  start(): void {
    if (this.started) {
      console.warn('[cron] Scheduler already started');
      return;
    }
    this.started = true;

    for (const def of this.definitions) {
      const ctx = this.buildContext(def.name);
      const options: CronOptions = {
        name: def.name,
        protect: true, // skip tick if previous is still running
        catch: (err) => {
          console.error(`[cron] Job "${def.name}" failed:`, err);
        },
      };

      const cron = new Cron(def.expression, options, () => def.handler(ctx));
      this.jobs.set(def.name, cron);
      console.log(`[cron] Registered job "${def.name}" with expression "${def.expression}"`);
    }

    console.log(`[cron] Scheduler started with ${this.jobs.size} job(s)`);
  }

  /**
   * Stop all running cron jobs. Safe to call multiple times.
   */
  stop(): void {
    for (const [name, cron] of this.jobs) {
      cron.stop();
      console.log(`[cron] Stopped job "${name}"`);
    }
    this.jobs.clear();
    this.definitions = [];
    this.started = false;
  }

  /** Return the names of all registered jobs. */
  getJobNames(): string[] {
    return Array.from(this.jobs.keys());
  }

  /** Check whether the scheduler has been started. */
  isStarted(): boolean {
    return this.started;
  }

  /** Check whether a job with the given name is registered. */
  hasJob(name: string): boolean {
    return this.jobs.has(name);
  }

  private buildContext(jobName: string): CronJobContext {
    return {
      jobName,
      enqueueCronTask: async (opts) => {
        const suffix = opts.idempotency_key_suffix ?? new Date().toISOString();
        const idempotencyKey = `cron:${jobName}:${suffix}`;
        await enqueueTask({
          idempotency_key: idempotencyKey,
          agent_type: 'cron',
          job_type: opts.job_type,
          payload: opts.payload ?? {},
          created_by: `cron:${jobName}`,
          priority: opts.priority,
          max_attempts: opts.max_attempts,
        });
      },
    };
  }
}
