/**
 * @file runner.ts
 *
 * Codex task runner — the main execution unit of the worker container.
 *
 * Architecture (blueprint: WORKER domain)
 * ----------------------------------------
 * 1. Connect to PostgreSQL using the agent-type read-only role.
 * 2. Assert read-only DB access on startup (TQ-C-008).
 * 3. Validate CLAUDE_CLI_PATH at startup when set (WORKER-C-002).
 * 4. Start the LISTEN/NOTIFY worker loop.
 * 5. Per iteration: claim one task from the queue, invoke the configured CLI
 *    binary (Claude CLI or Codex), and submit the result back to the API server
 *    using the delegated token embedded in the task row.
 *
 * Security constraints
 * ---------------------
 * - The DB role is read-only; writes are structurally impossible (WORKER-T-002).
 * - CLI binaries are invoked as subprocesses with no shell (WORKER-C-002).
 * - Results are submitted via the API path, never directly to the DB (WORKER-T-001).
 * - The delegated token is single-use and task-scoped (WORKER-T-005).
 *
 * Environment variables
 * ----------------------
 * - AGENT_DATABASE_URL              — read-only agent role connection string (required)
 * - AGENT_TYPE                      — agent type name, e.g. "coding" (required)
 * - API_BASE_URL                    — base URL of the Calypso API server (required)
 * - CLAUDE_CLI_PATH                 — path to the Claude CLI binary; validated at startup.
 *                                     When set, Claude credentials are restored from DB.
 *                                     When unset, the dev stub is used as fallback.
 * - CLAUDE_AUTH_FILE                — override path for Claude CLI credentials file.
 *                                     Defaults to ~/.config/anthropic/credentials.json.
 * - CODE_MOUNT_PATH                 — path to the read-only code volume (default: /repo).
 *                                     Set in container by the initContainer git clone.
 * - CODEX_PATH                      — path to the codex binary (default: /usr/local/bin/codex)
 * - WORKER_ID                       — unique identifier for this worker instance (default: hostname)
 * - AGENT_TIMEOUT_MS                — default hard timeout for all agent jobs in ms (default: 600000)
 * - AGENT_TIMEOUT_MS_<AGENT_TYPE>   — per-agent-type hard timeout override in ms
 *                                     (e.g. AGENT_TIMEOUT_MS_CODING=300000)
 * - AGENT_TIMEOUT_SIGTERM_GRACE_MS  — grace period between SIGTERM and SIGKILL in ms (default: 5000)
 *
 * Canonical docs
 * ---------------
 * - Worker blueprint: calypso-blueprint/rules/blueprints/worker.yaml
 * - Task queue schema: packages/db/task-queue.ts
 * - Worker waker: packages/db/task-queue-worker.ts
 * - Claude CLI integration: apps/worker/src/claude-cli.ts
 * - Sample agent job type: apps/worker/src/sample-agent-job.ts
 */

import { spawn } from 'child_process';
import os from 'os';
import { createAgentPool, loadAgentDbConfig } from './db';
import { assertReadOnlyRole } from './startup';
import { restoreCodexCredentials } from './codex-credentials';
import { restoreClaudeCredentials } from './claude-credentials';
import { invokeCli, validateClaudeCliPath } from './claude-cli';
import { SAMPLE_JOB_TYPE, buildCliPayload, validateCliResult } from './sample-agent-job';
import { resolveAgentTimeoutMs, resolveSigtermGraceMs } from './timeout';
import {
  SECURITY_SCAN_JOB_TYPE,
  SECURITY_SCAN_TIMEOUT_MS,
  buildSecurityScanCliPayload,
  validateSecurityScanResult,
} from './security-scanner-job';
import {
  SOC_COMPLIANCE_JOB_TYPE,
  SOC_COMPLIANCE_TIMEOUT_MS,
  buildSocComplianceCliPayload,
  validateSocComplianceResult,
} from './soc-compliance-agent-job';
import {
  RUNTIME_TRACE_JOB_TYPE,
  RUNTIME_TRACE_TIMEOUT_MS,
  buildRuntimeTraceCliPayload,
  validateRuntimeTraceResult,
} from './runtime-tracer-job';
import { runWorkerLoop } from 'db/task-queue-worker';
import { claimNextTask, updateTaskStatus } from 'db/task-queue';

const CODEX_PATH = process.env.CODEX_PATH ?? '/usr/local/bin/codex';
const CLAUDE_CLI_PATH = process.env.CLAUDE_CLI_PATH;
const WORKER_ID = process.env.WORKER_ID ?? os.hostname();

/**
 * Invoke the Codex CLI as a subprocess (no shell).
 *
 * The task payload is passed as a JSON string on stdin.  The CLI is expected
 * to write a JSON result object to stdout and exit 0 on success.
 *
 * A hard timeout is enforced: SIGTERM is sent after `timeoutMs`, followed by
 * SIGKILL after `sigtermGraceMs` if the process has not yet exited.
 */
async function invokeCodex(
  taskPayload: unknown,
  timeoutMs: number,
  sigtermGraceMs: number,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(CODEX_PATH, ['--json-result'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | null = null;

    // Hard timeout: SIGTERM then SIGKILL.
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        child.kill('SIGKILL');
      }, sigtermGraceMs);
      reject(new Error(`Codex exceeded timeout of ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (killTimer !== null) clearTimeout(killTimer);
      if (timedOut) return; // Already rejected via timeout path.

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

    child.on('error', (err) => {
      clearTimeout(timer);
      if (killTimer !== null) clearTimeout(killTimer);
      if (!timedOut) reject(err);
    });

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
 *
 * A hard timeout is enforced on subprocess execution. On expiry the subprocess
 * receives SIGTERM, then SIGKILL after the grace period. The task is marked
 * failed with a timeout reason and the worker returns to the claim loop.
 */
async function tryClaimAndExecute(
  db: ReturnType<typeof createAgentPool>,
  agentType: string,
  apiBaseUrl: string,
  timeoutMs: number,
  sigtermGraceMs: number,
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

    console.log(`[runner] Claimed task ${task.id} (type=${task.job_type}, timeout=${timeoutMs}ms)`);

    // Route to the appropriate CLI based on job type.
    // claude_sample jobs go through the Claude CLI integration; security_scan,
    // soc_compliance_review, and runtime_trace jobs go through Claude CLI with
    // a hard timeout and read-only access; all others use the existing Codex path.
    let result: Record<string, unknown>;
    if (task.job_type === SAMPLE_JOB_TYPE) {
      const cliPayload = buildCliPayload(task.id, agentType, task.payload);
      const rawResult = await invokeCli({
        cliPath: CLAUDE_CLI_PATH,
        taskPayload: cliPayload,
        timeoutMs,
        sigtermGraceMs,
      });
      result = validateCliResult(rawResult);
    } else if (task.job_type === SECURITY_SCAN_JOB_TYPE) {
      const cliPayload = buildSecurityScanCliPayload(task.id, agentType, task.payload);
      const rawResult = await invokeCli({
        cliPath: CLAUDE_CLI_PATH,
        taskPayload: cliPayload,
        timeoutMs: SECURITY_SCAN_TIMEOUT_MS,
        sigtermGraceMs,
      });
      result = validateSecurityScanResult(rawResult);
    } else if (task.job_type === SOC_COMPLIANCE_JOB_TYPE) {
      const cliPayload = buildSocComplianceCliPayload(task.id, agentType, task.payload);
      const rawResult = await invokeCli({
        cliPath: CLAUDE_CLI_PATH,
        taskPayload: cliPayload,
        timeoutMs: SOC_COMPLIANCE_TIMEOUT_MS,
        sigtermGraceMs,
      });
      result = validateSocComplianceResult(rawResult);
    } else if (task.job_type === RUNTIME_TRACE_JOB_TYPE) {
      const cliPayload = buildRuntimeTraceCliPayload(task.id, agentType, task.payload);
      const rawResult = await invokeCli({
        cliPath: CLAUDE_CLI_PATH,
        taskPayload: cliPayload,
        timeoutMs: RUNTIME_TRACE_TIMEOUT_MS,
        sigtermGraceMs,
      });
      result = validateRuntimeTraceResult(rawResult);
    } else {
      result = await invokeCodex(task.payload, timeoutMs, sigtermGraceMs);
    }

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

  // Validate CLAUDE_CLI_PATH at startup when configured.
  // When unset the Claude CLI module falls back to the dev stub automatically.
  if (CLAUDE_CLI_PATH) {
    await validateClaudeCliPath(CLAUDE_CLI_PATH).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[runner] ${msg}`);
      process.exit(1);
    });
    console.log(`[runner] Claude CLI validated at ${CLAUDE_CLI_PATH}`);
  } else {
    console.log('[runner] CLAUDE_CLI_PATH not set — Claude CLI jobs will use dev stub fallback');
  }

  // Verify that the DB role is read-only before entering the loop (TQ-C-008).
  await assertReadOnlyRole(db as Parameters<typeof assertReadOnlyRole>[0]);

  console.log(`[runner] DB role verified read-only`);

  if (CLAUDE_CLI_PATH) {
    // Restore Claude CLI credentials from the encrypted bundle stored in the
    // database.  Fails closed if the bundle is missing, expired, or cannot be
    // decrypted.  Credentials are written to the Claude CLI auth file path so
    // the binary can authenticate when invoked against the read-only code mount.
    await restoreClaudeCredentials(agentType).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[runner] Claude credential restore failed: ${msg}`);
      process.exit(1);
    });
    console.log(`[runner] Claude CLI credentials restored — entering worker loop`);
  } else {
    // Restore Codex subscription credentials from the encrypted bundle stored
    // in the database.  Fails closed if the bundle is missing, expired, or
    // cannot be decrypted.
    await restoreCodexCredentials(agentType);
    console.log(`[runner] Codex credentials restored — entering worker loop`);
  }

  // Resolve hard timeout for this agent type.
  const timeoutMs = resolveAgentTimeoutMs(agentType);
  const sigtermGraceMs = resolveSigtermGraceMs();
  console.log(
    `[runner] Hard timeout configured — timeout=${timeoutMs}ms, sigtermGrace=${sigtermGraceMs}ms`,
  );

  const { stop } = await runWorkerLoop({
    agentType,
    databaseUrl: agentDatabaseUrl,
    tryClaimAndExecute: () =>
      tryClaimAndExecute(db, agentType, apiBaseUrl, timeoutMs, sigtermGraceMs),
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
