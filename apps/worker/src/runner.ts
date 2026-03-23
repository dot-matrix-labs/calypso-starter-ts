/**
 * @file runner.ts
 *
 * Codex task runner — the main execution unit of the worker container.
 *
 * Architecture (blueprint: WORKER domain)
 * ----------------------------------------
 * 1. Connect to PostgreSQL using the agent-type read-only role.
 * 2. Assert read-only DB access on startup (TQ-C-008).
 * 3. Start the LISTEN/NOTIFY worker loop.
 * 4. Per iteration: claim one task from the queue, invoke the Codex binary,
 *    and submit the result back to the API server using the delegated token
 *    embedded in the task row.
 *
 * Security constraints
 * ---------------------
 * - The DB role is read-only; writes are structurally impossible (WORKER-T-002).
 * - The Codex binary is invoked as a subprocess with no shell (WORKER-C-002).
 * - Results are submitted via the API path, never directly to the DB (WORKER-T-001).
 * - The delegated token is single-use and task-scoped (WORKER-T-005).
 *
 * Environment variables
 * ----------------------
 * - AGENT_DATABASE_URL — read-only agent role connection string (required)
 * - AGENT_TYPE         — agent type name, e.g. "coding" (required)
 * - API_BASE_URL       — base URL of the Calypso API server (required)
 * - CODEX_PATH         — path to the codex binary (default: /usr/local/bin/codex)
 * - WORKER_ID          — unique identifier for this worker instance (default: hostname)
 *
 * Canonical docs
 * ---------------
 * - Worker blueprint: calypso-blueprint/rules/blueprints/worker.yaml
 * - Task queue schema: packages/db/task-queue.ts
 * - Worker waker: packages/db/task-queue-worker.ts
 */

import { spawn } from 'child_process';
import os from 'os';
import { createAgentPool, loadAgentDbConfig } from './db';
import { assertReadOnlyRole } from './startup';
import { restoreCodexCredentials } from './codex-credentials';
import { runWorkerLoop } from 'db/task-queue-worker';
import { claimNextTask, updateTaskStatus } from 'db/task-queue';

const CODEX_PATH = process.env.CODEX_PATH ?? '/usr/local/bin/codex';
const WORKER_ID = process.env.WORKER_ID ?? os.hostname();

/**
 * Invoke the Codex CLI as a subprocess (no shell).
 *
 * The task payload is passed as a JSON string on stdin.  The CLI is expected
 * to write a JSON result object to stdout and exit 0 on success.
 */
async function invokeCodex(taskPayload: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(CODEX_PATH, ['--json-result'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Codex exited ${code}: ${stderr.slice(0, 500)}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as Record<string, unknown>);
      } catch {
        reject(new Error(`Codex output is not valid JSON: ${stdout.slice(0, 500)}`));
      }
    });

    child.on('error', reject);

    // Write task payload to stdin and close to signal EOF.
    child.stdin.write(JSON.stringify(taskPayload));
    child.stdin.end();
  });
}

/**
 * Submit the task result to the API server using the delegated token.
 */
async function submitResultViaApi(
  taskId: string,
  delegatedToken: string,
  result: Record<string, unknown>,
  apiBaseUrl: string,
): Promise<void> {
  const url = `${apiBaseUrl}/api/tasks/${encodeURIComponent(taskId)}/result`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${delegatedToken}`,
    },
    body: JSON.stringify({ result }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '(unreadable)');
    throw new Error(`API result submission failed (${response.status}): ${body.slice(0, 200)}`);
  }
}

/**
 * Claim and execute one task from the queue.
 *
 * Returns without doing anything if no task is available.
 * All errors are caught and logged; the loop must not throw.
 */
async function tryClaimAndExecute(
  db: ReturnType<typeof createAgentPool>,
  agentType: string,
  apiBaseUrl: string,
): Promise<void> {
  let task: Awaited<ReturnType<typeof claimNextTask>> = null;

  try {
    task = await claimNextTask({
      agent_type: agentType,
      claimed_by: WORKER_ID,
    });

    if (!task) {
      return; // No pending tasks — wait for next notification or poll interval.
    }

    console.log(`[runner] Claimed task ${task.id} (type=${task.job_type})`);

    // Invoke Codex with the task payload.
    const result = await invokeCodex(task.payload);

    console.log(`[runner] Task ${task.id} completed`);

    // Submit result via API using the delegated token embedded in the task row.
    if (!task.delegated_token) {
      throw new Error(`Task ${task.id} has no delegated token — cannot submit result`);
    }

    await submitResultViaApi(task.id, task.delegated_token, result, apiBaseUrl);

    console.log(`[runner] Task ${task.id} result submitted`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[runner] Task ${task?.id ?? '?'} failed: ${msg}`);

    // Mark the task as failed so stale-claim recovery can retry or dead-letter it.
    if (task) {
      await updateTaskStatus({
        id: task.id,
        status: 'failed',
        error_message: msg.slice(0, 1000),
      }).catch((e: unknown) => {
        console.error(`[runner] Failed to mark task ${task!.id} as failed:`, e);
      });
    }
  }
}

/**
 * Start the worker runner.
 *
 * Sets up the DB pool, verifies the read-only role, then enters the
 * LISTEN/NOTIFY worker loop until a SIGTERM is received.
 */
export async function startRunner(): Promise<void> {
  const apiBaseUrl = process.env.API_BASE_URL;
  if (!apiBaseUrl) {
    console.error('[runner] Missing required environment variable: API_BASE_URL');
    process.exit(1);
  }

  const { agentDatabaseUrl, agentType } = loadAgentDbConfig();
  const db = createAgentPool(agentDatabaseUrl);

  console.log(`[runner] Starting — agent_type=${agentType}, worker_id=${WORKER_ID}`);

  // Verify that the DB role is read-only before entering the loop (TQ-C-008).
  await assertReadOnlyRole(db as Parameters<typeof assertReadOnlyRole>[0]);

  console.log(`[runner] DB role verified read-only`);

  // Restore Codex subscription credentials from the encrypted bundle stored
  // in the database.  Fails closed if the bundle is missing, expired, or
  // cannot be decrypted.
  await restoreCodexCredentials(agentType);

  console.log(`[runner] Codex credentials restored — entering worker loop`);

  const { stop } = await runWorkerLoop({
    agentType,
    databaseUrl: agentDatabaseUrl,
    tryClaimAndExecute: () => tryClaimAndExecute(db, agentType, apiBaseUrl),
  });

  // Graceful shutdown on SIGTERM (sent by container orchestrator on scale-down).
  process.once('SIGTERM', async () => {
    console.log('[runner] SIGTERM received — stopping worker loop');
    await stop();
    await db.end({ timeout: 5 });
    process.exit(0);
  });

  process.once('SIGINT', async () => {
    console.log('[runner] SIGINT received — stopping worker loop');
    await stop();
    await db.end({ timeout: 5 });
    process.exit(0);
  });
}
