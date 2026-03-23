/**
 * Integration tests for PostgreSQL LISTEN/NOTIFY worker wake (issue #38).
 *
 * Validates:
 *  - waitForWork() resolves promptly on task insertion via pg_notify trigger
 *  - waitForWork() falls back to poll interval when no notification arrives
 *  - Notifications for agent_type A do not wake a waker for agent_type B
 *  - runWorkerLoop() calls tryClaimAndExecute on each wake cycle and stops cleanly
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { startPostgres, type PgContainer } from './pg-container';
import { createWorkerWaker, runWorkerLoop, POLL_INTERVAL_MS } from './task-queue-worker';
import { migrate } from './index';

let pg: PgContainer;
let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  pg = await startPostgres();
  sql = postgres(pg.url, { max: 5 });
  await migrate({ databaseUrl: pg.url });
}, 60_000);

afterAll(async () => {
  await sql.end({ timeout: 5 });
  await pg?.stop();
});

// ---------------------------------------------------------------------------

describe('createWorkerWaker', () => {
  test('waitForWork() resolves promptly when a task is inserted (notify path)', async () => {
    const waker = await createWorkerWaker('coding', 5_000, pg.url);
    try {
      const t0 = Date.now();
      const waiterPromise = waker.waitForWork();

      // Insert a task — the trigger fires pg_notify('task_queue_coding', id)
      await sql`
          INSERT INTO task_queue
            (id, idempotency_key, agent_type, job_type, created_by)
          VALUES
            (gen_random_uuid()::TEXT,
             'waker-test-' || gen_random_uuid()::TEXT,
             'coding', 'review', 'test')
        `;

      await waiterPromise;
      const elapsed = Date.now() - t0;

      // Should resolve well before the poll interval
      expect(elapsed).toBeLessThan(2_000);
    } finally {
      await waker.stop();
    }
  }, 15_000);

  test('waitForWork() falls back to poll interval when no notification arrives', async () => {
    const shortPoll = 300; // Use a very short poll interval for the test
    const waker = await createWorkerWaker('no_tasks_agent', shortPoll, pg.url);
    try {
      const t0 = Date.now();
      await waker.waitForWork();
      const elapsed = Date.now() - t0;

      // Should resolve around the poll interval (allow generous upper bound)
      expect(elapsed).toBeGreaterThanOrEqual(shortPoll - 50);
      expect(elapsed).toBeLessThan(shortPoll * 5);
    } finally {
      await waker.stop();
    }
  }, 10_000);

  test('notification for agent_type "analysis" does not wake a "coding" waker', async () => {
    const shortPoll = 400;
    const codingWaker = await createWorkerWaker('coding_isolated', shortPoll, pg.url);
    try {
      const waiterPromise = codingWaker.waitForWork();

      // Insert a task for a different agent type — should NOT wake coding_isolated
      await sql`
          INSERT INTO task_queue
            (id, idempotency_key, agent_type, job_type, created_by)
          VALUES
            (gen_random_uuid()::TEXT,
             'cross-agent-' || gen_random_uuid()::TEXT,
             'analysis', 'classify', 'test')
        `;

      const t0 = Date.now();
      await waiterPromise;
      const elapsed = Date.now() - t0;

      // The coding_isolated waker must not have resolved early due to the
      // analysis notification — it should fall through the poll interval.
      // (elapsed is measured from after the insert, so the poll timeout is
      //  the dominant factor here.)
      expect(elapsed).toBeGreaterThanOrEqual(shortPoll - 100);
    } finally {
      await codingWaker.stop();
    }
  }, 10_000);

  test('POLL_INTERVAL_MS is 5000', () => {
    expect(POLL_INTERVAL_MS).toBe(5_000);
  });
});

describe('runWorkerLoop', () => {
  test('calls tryClaimAndExecute on each wake and stops cleanly', async () => {
    const calls: number[] = [];
    let callCount = 0;

    const { stop } = await runWorkerLoop({
      agentType: 'loop_test_agent',
      pollIntervalMs: 100,
      databaseUrl: pg.url,
      tryClaimAndExecute: async () => {
        callCount++;
        calls.push(Date.now());
        // Stop after 3 iterations
        if (callCount >= 3) await stop();
      },
    });

    // Wait for the loop to stop (stop() is called from inside the loop)
    // The outer stop() call may race; that's fine — runWorkerLoop is idempotent.
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (callCount >= 3) {
          clearInterval(check);
          resolve();
        }
      }, 50);
    });

    expect(callCount).toBeGreaterThanOrEqual(3);
  }, 15_000);
});
