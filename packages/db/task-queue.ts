import { sql } from './index';

/**
 * Task status values matching the CHECK constraint in schema.sql.
 *
 * State machine (TQ-D-002):
 *   pending → claimed → running → submitting → completed | failed | dead
 *   claimed → pending  (stale recovery, attempt < max_attempts)
 *   claimed → dead     (stale recovery, attempt >= max_attempts)
 */
export type TaskQueueStatus =
  | 'pending'
  | 'claimed'
  | 'running'
  | 'submitting'
  | 'completed'
  | 'failed'
  | 'dead';

export interface TaskQueueRow {
  id: string;
  idempotency_key: string;
  agent_type: string;
  job_type: string;
  status: TaskQueueStatus;
  payload: Record<string, unknown>;
  correlation_id: string | null;
  created_by: string;
  claimed_by: string | null;
  claimed_at: Date | null;
  claim_expires_at: Date | null;
  delegated_token: string | null;
  result: Record<string, unknown> | null;
  error_message: string | null;
  attempt: number;
  max_attempts: number;
  next_retry_at: Date | null;
  priority: number;
  created_at: Date;
  updated_at: Date;
}

export interface EnqueueOptions {
  idempotency_key: string;
  agent_type: string;
  job_type: string;
  payload?: Record<string, unknown>;
  correlation_id?: string;
  created_by: string;
  priority?: number;
  max_attempts?: number;
}

/**
 * Idempotently enqueues a task (TQ-P-003 idempotent-task-creation).
 *
 * On conflict the existing row is returned unchanged. The caller receives a
 * 200-equivalent result — not a 409 — so retried API calls converge to the
 * same task without double-queuing.
 */
export async function enqueueTask(options: EnqueueOptions): Promise<TaskQueueRow> {
  const {
    idempotency_key,
    agent_type,
    job_type,
    payload = {},
    correlation_id = null,
    created_by,
    priority = 5,
    max_attempts = 3,
  } = options;

  const [row] = await sql<TaskQueueRow[]>`
    INSERT INTO task_queue
      (idempotency_key, agent_type, job_type, payload, correlation_id,
       created_by, priority, max_attempts)
    VALUES
      (${idempotency_key}, ${agent_type}, ${job_type}, ${sql.json(payload as never)},
       ${correlation_id}, ${created_by}, ${priority}, ${max_attempts})
    ON CONFLICT (idempotency_key) DO UPDATE
      SET updated_at = task_queue.updated_at
    RETURNING *
  `;
  return row;
}

export interface ClaimOptions {
  agent_type: string;
  claimed_by: string;
  delegated_token?: string;
  /** Claim duration in seconds. Defaults to 300 (5 minutes). */
  claim_ttl_seconds?: number;
}

/**
 * Atomically claims the next available task for the given agent type
 * (TQ-P-001 atomic-claim-exactly-one-winner).
 *
 * Uses FOR UPDATE SKIP LOCKED so concurrent workers never double-claim the
 * same row. Returns null when no task is available.
 */
export async function claimNextTask(options: ClaimOptions): Promise<TaskQueueRow | null> {
  const { agent_type, claimed_by, delegated_token = null, claim_ttl_seconds = 300 } = options;

  const rows = await sql<TaskQueueRow[]>`
    UPDATE task_queue
    SET
      status           = 'claimed',
      claimed_by       = ${claimed_by},
      claimed_at       = NOW(),
      claim_expires_at = NOW() + (${claim_ttl_seconds} * INTERVAL '1 second'),
      delegated_token  = ${delegated_token},
      attempt          = attempt + 1,
      updated_at       = NOW()
    WHERE id = (
      SELECT id FROM task_queue
      WHERE agent_type = ${agent_type}
        AND status = 'pending'
        AND (next_retry_at IS NULL OR next_retry_at <= NOW())
      ORDER BY priority ASC, created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `;
  return rows[0] ?? null;
}

export interface UpdateStatusOptions {
  id: string;
  status: TaskQueueStatus;
  error_message?: string;
  next_retry_at?: Date;
}

/**
 * Updates the status of a task, optionally recording an error message and
 * next retry timestamp.
 */
export async function updateTaskStatus(options: UpdateStatusOptions): Promise<TaskQueueRow | null> {
  const { id, status, error_message = null, next_retry_at = null } = options;

  const rows = await sql<TaskQueueRow[]>`
    UPDATE task_queue
    SET
      status        = ${status},
      error_message = ${error_message},
      next_retry_at = ${next_retry_at},
      updated_at    = NOW()
    WHERE id = ${id}
    RETURNING *
  `;
  return rows[0] ?? null;
}

export interface SubmitResultOptions {
  id: string;
  result: Record<string, unknown>;
}

/**
 * Records the result of a completed task and marks it as completed.
 */
export async function submitTaskResult(options: SubmitResultOptions): Promise<TaskQueueRow | null> {
  const { id, result } = options;

  const rows = await sql<TaskQueueRow[]>`
    UPDATE task_queue
    SET
      status     = 'completed',
      result     = ${sql.json(result as never)},
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `;
  return rows[0] ?? null;
}

/**
 * Recovers stale claims (TQ-D-003 stale-claim-recovery).
 *
 * Tasks in 'claimed' status whose claim_expires_at has passed are either
 * reset to 'pending' (if attempt < max_attempts) or transitioned to 'dead'.
 *
 * Returns the number of rows updated.
 */
export async function recoverStaleClaims(): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    WITH recovered AS (
      UPDATE task_queue
      SET
        status           = CASE
                             WHEN attempt >= max_attempts THEN 'dead'
                             ELSE 'pending'
                           END,
        claimed_by       = NULL,
        claimed_at       = NULL,
        claim_expires_at = NULL,
        delegated_token  = NULL,
        next_retry_at    = CASE
                             WHEN attempt >= max_attempts THEN NULL
                             ELSE NOW() + (POWER(2, attempt) * INTERVAL '1 second')
                           END,
        updated_at       = NOW()
      WHERE status = 'claimed'
        AND claim_expires_at < NOW()
      RETURNING 1
    )
    SELECT COUNT(*)::TEXT AS count FROM recovered
  `;
  return parseInt(rows[0]?.count ?? '0', 10);
}

/**
 * Starts the stale-claim recovery on a fixed interval.
 * The returned timer has .unref() called so it does not prevent process exit.
 */
export function startStaleClaimRecovery(intervalMs = 60_000): ReturnType<typeof setInterval> {
  const timer = setInterval(() => {
    recoverStaleClaims().catch((err) =>
      console.error('[task-queue] stale claim recovery failed:', err),
    );
  }, intervalMs);
  timer.unref();
  return timer;
}
