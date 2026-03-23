import postgres from 'postgres';
import { resolveDatabaseUrls, buildSslOptions } from './index';

/**
 * Default poll interval in milliseconds (5 seconds).
 * Workers fall back to polling at this interval if no LISTEN notification arrives.
 */
export const POLL_INTERVAL_MS = 5_000;

/**
 * Creates a dedicated single-connection postgres client for LISTEN/NOTIFY.
 * The main pool must not be used for LISTEN because it multiplexes connections.
 */
function createListenConnection(databaseUrl: string): postgres.Sql {
  return postgres(databaseUrl, {
    max: 1,
    idle_timeout: 0,
    connect_timeout: 10,
    ssl: buildSslOptions(),
    connection: { client_min_messages: 'warning' },
  });
}

export interface WorkerWaker {
  /**
   * Waits for work to be available.
   * Resolves immediately on a LISTEN notification for the worker's channel,
   * or after `pollIntervalMs` if no notification arrives (best-effort).
   */
  waitForWork(): Promise<void>;

  /**
   * Stops the waker: unlistens from the channel and closes the connection.
   * Must be called to free resources when the worker loop exits.
   */
  stop(): Promise<void>;
}

/**
 * Creates a WorkerWaker that uses PostgreSQL LISTEN/NOTIFY to reduce task
 * pickup latency (TQ-D-005 listen-notify-wake).
 *
 * The waker establishes a dedicated connection (separate from the main pool)
 * and listens on `task_queue_<agentType>`. The trigger in schema.sql fires
 * `pg_notify('task_queue_' || NEW.agent_type, NEW.id::text)` after each
 * INSERT into task_queue.
 *
 * @param agentType   The agent type this worker handles (e.g. 'coding').
 * @param pollIntervalMs  Fall-back poll interval in ms (default: 5000).
 * @param databaseUrl     Optional database URL; defaults to DATABASE_URL env var.
 */
export async function createWorkerWaker(
  agentType: string,
  pollIntervalMs: number = POLL_INTERVAL_MS,
  databaseUrl?: string,
): Promise<WorkerWaker> {
  const url = databaseUrl ?? resolveDatabaseUrls().app;
  const listenSql = createListenConnection(url);
  const channel = `task_queue_${agentType}`;

  // Pending resolve callbacks — one per outstanding waitForWork() call.
  const pending: Array<() => void> = [];

  // Set up the LISTEN connection. The promise resolves once LISTEN is active.
  const listenMeta = await listenSql.listen(channel, (_payload: string) => {
    // Wake every outstanding waitForWork() call when a notification arrives.
    const toWake = pending.splice(0);
    for (const resolve of toWake) resolve();
  });

  async function waitForWork(): Promise<void> {
    return new Promise<void>((resolve) => {
      let done = false;

      // Register this waiter so the notification handler can wake it.
      const wrapped = () => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      pending.push(wrapped);

      // Fallback: resolve after the poll interval regardless of notifications.
      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          // Remove from pending to prevent a double-resolve on late notification.
          const idx = pending.indexOf(wrapped);
          if (idx !== -1) pending.splice(idx, 1);
          resolve();
        }
      }, pollIntervalMs);

      // Allow the timer to be garbage-collected if process would otherwise hang.
      if (typeof timer === 'object' && 'unref' in timer) {
        (timer as ReturnType<typeof setTimeout>).unref?.();
      }
    });
  }

  async function stop(): Promise<void> {
    try {
      await listenMeta.unlisten();
    } catch {
      // Best-effort unlisten; connection may already be closed.
    }
    await listenSql.end({ timeout: 5 });
  }

  return { waitForWork, stop };
}

/**
 * Options for `runWorkerLoop`.
 */
export interface WorkerLoopOptions {
  agentType: string;
  /**
   * Called once per loop iteration to claim and execute one task.
   * The implementation should claim from the task queue and process it.
   * It must not throw — errors should be handled internally.
   */
  tryClaimAndExecute: () => Promise<void>;
  /** Fall-back poll interval in ms. Defaults to POLL_INTERVAL_MS. */
  pollIntervalMs?: number;
  /** Optional database URL override for the LISTEN connection. */
  databaseUrl?: string;
}

/**
 * Runs the worker loop:
 *   `while (running) { await tryClaimAndExecute(); await waitForWork(); }`
 *
 * Returns a `stop()` function that signals the loop to exit after the current
 * iteration completes and cleans up the LISTEN connection.
 *
 * @example
 * ```ts
 * const { stop } = await runWorkerLoop({
 *   agentType: 'coding',
 *   tryClaimAndExecute: async () => {
 *     const task = await claimNextTask({ agent_type: 'coding', claimed_by: 'worker-1' });
 *     if (task) await processTask(task);
 *   },
 * });
 * // Later:
 * await stop();
 * ```
 */
export async function runWorkerLoop(
  options: WorkerLoopOptions,
): Promise<{ stop: () => Promise<void> }> {
  const { agentType, tryClaimAndExecute, pollIntervalMs, databaseUrl } = options;

  const waker = await createWorkerWaker(agentType, pollIntervalMs, databaseUrl);
  let running = true;

  const loopPromise = (async () => {
    while (running) {
      await tryClaimAndExecute();
      if (!running) break;
      await waker.waitForWork();
    }
  })();

  async function stop(): Promise<void> {
    running = false;
    await loopPromise;
    await waker.stop();
  }

  return { stop };
}
