# Task Queue Schema

## What it is

A PostgreSQL-backed task queue using a single `task_queue` table with idempotent task creation,
a strict status state machine, atomic claim via `UPDATE ... RETURNING`, and partial indexes for
efficient polling and stale-claim recovery.

## Why it's needed

Workers need a durable, concurrent-safe source of work. PostgreSQL is already the system's
transactional store — adding a separate message broker (Redis, RabbitMQ, SQS) introduces a
second consistency domain and a second failure mode for no benefit at the task volumes this
system targets. Without a well-designed queue schema:

- Concurrent claim attempts can cause two workers to execute the same task (double-execution).
- Retry logic scattered across workers diverges over time.
- Idempotent task submission requires per-endpoint deduplication in every caller.

## Schema

```sql
CREATE TABLE task_queue (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key  TEXT        NOT NULL UNIQUE,
  agent_type       TEXT        NOT NULL,
  job_type         TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'pending'
                               CHECK (status IN (
                                 'pending','claimed','running',
                                 'submitting','completed','failed','dead'
                               )),
  payload          JSONB       NOT NULL DEFAULT '{}',
  correlation_id   TEXT,
  created_by       UUID        REFERENCES users(id),
  claimed_by       TEXT,
  claimed_at       TIMESTAMPTZ,
  claim_expires_at TIMESTAMPTZ,
  delegated_token  TEXT,
  result           JSONB,
  error_message    TEXT,
  attempt          INT         NOT NULL DEFAULT 0,
  max_attempts     INT         NOT NULL DEFAULT 3,
  next_retry_at    TIMESTAMPTZ,
  priority         INT         NOT NULL DEFAULT 100,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Efficient poll query: pending tasks for a given agent type
CREATE INDEX idx_task_queue_poll
  ON task_queue (agent_type, status, priority ASC, created_at ASC)
  WHERE status = 'pending';

-- Efficient stale-claim recovery scan
CREATE INDEX idx_task_queue_stale
  ON task_queue (status, claim_expires_at)
  WHERE status = 'claimed';
```

## Status state machine

```
pending → claimed → running → submitting → completed
                                         → failed
          (stale recovery resets to)
pending ←── (any claimed task past claim_expires_at)
                         → dead  (attempt >= max_attempts)
```

Valid transitions:
- `pending → claimed` — atomic claim by a worker
- `claimed → running` — worker begins execution
- `running → submitting` — worker is sending result
- `submitting → completed` — result accepted
- `submitting → failed` — business-rule rejection (terminal, no retry)
- `claimed → pending` — stale claim recovery (attempt < max_attempts)
- `claimed → dead` — stale claim recovery (attempt >= max_attempts)

Invalid transitions (rejected by API): `dead → pending`, `completed → any`, `failed → any`.

## Atomic claim

```sql
UPDATE task_queue
SET
  status           = 'claimed',
  claimed_by       = $worker_id,
  claimed_at       = NOW(),
  claim_expires_at = NOW() + INTERVAL '5 minutes',
  attempt          = attempt + 1,
  updated_at       = NOW()
WHERE id = (
  SELECT id FROM task_queue
  WHERE agent_type = $agent_type
    AND status = 'pending'
    AND (next_retry_at IS NULL OR next_retry_at <= NOW())
  ORDER BY priority ASC, created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING *;
```

Zero rows returned = no task available or lost the race; retry on next poll.

## Idempotent task creation

The `idempotency_key` UNIQUE constraint prevents duplicate tasks. On conflict, the existing
row is returned (status 200) rather than rejected (status 409):

```sql
INSERT INTO task_queue (idempotency_key, agent_type, job_type, payload, created_by, priority)
VALUES ($key, $agent_type, $job_type, $payload, $user_id, $priority)
ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = updated_at
RETURNING *;
```

## Blueprint references

- `TQ-D-001` `postgres-queue-table` — single table design
- `TQ-D-002` `status-lifecycle-machine` — state machine enforcement
- `TQ-P-001` `atomic-claim-exactly-one-winner` — UPDATE ... FOR UPDATE SKIP LOCKED
- `TQ-P-003` `idempotent-task-creation` — UNIQUE idempotency_key

## Dependencies

- **Three-database pools** (`docs/three-database-pools.md`) — queue table lives in `calypso_app`
- **Audit logging** (`docs/audit-logging.md`) — stale recovery writes audit entries

## Files to create / modify

- `packages/db/schema.sql` — add `task_queue` table and indexes
- `apps/server/src/api/tasks-queue.ts` — claim, update-status, and result-submission endpoints
- `apps/server/src/api/tasks-queue.test.ts` — concurrent-claim atomicity test
