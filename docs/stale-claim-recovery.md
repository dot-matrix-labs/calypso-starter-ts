# Stale Claim Recovery

## What it is

A scheduled background job that scans for `task_queue` rows in `claimed` status past their
`claim_expires_at` deadline and resets them to `pending` (with exponential backoff) or
transitions them to `dead` when retries are exhausted.

## Why it's needed

A worker that crashes after claiming a task leaves the task in `claimed` status indefinitely.
Without recovery, these tasks are permanently stuck — no other worker will claim them because
the status is not `pending`. Stale recovery is the safety net that bounds the time a task
can be stuck regardless of worker behaviour.

## How it works

A periodic job runs every 60 seconds:

```sql
UPDATE task_queue
SET
  status        = CASE
                    WHEN attempt >= max_attempts THEN 'dead'
                    ELSE 'pending'
                  END,
  next_retry_at = CASE
                    WHEN attempt >= max_attempts THEN NULL
                    ELSE NOW() + (INTERVAL '1 second' * POWER(2, attempt))
                  END,
  claim_expires_at = NULL,
  claimed_by       = NULL,
  updated_at       = NOW()
WHERE status = 'claimed'
  AND claim_expires_at < NOW()
RETURNING id, status, attempt, agent_type, job_type;
```

Each recovered row is emitted to the audit log:
- `action: 'task.stale_recovery'` if reset to `pending`
- `action: 'task.dead'` if transitioned to `dead`

## Exponential backoff

| Attempt | Delay before re-queuing |
|---------|------------------------|
| 1       | 2 seconds              |
| 2       | 4 seconds              |
| 3       | 8 seconds              |
| N       | 2^N seconds            |

`next_retry_at` is respected by the poll query:
`WHERE status = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= NOW())`

## Scheduling

In Bun server (`apps/server/src/index.ts`):

```ts
setInterval(recoverStaleClaims, 60_000).unref();
```

`.unref()` prevents the timer from keeping the process alive during shutdown.

## Blueprint reference

- `TQ-D-003` `stale-claim-recovery`
- `TQ-T-001` `stale-claim-allows-duplicate-execution` — this pattern mitigates it
- `TQ-C-002` `stale-recovery-tested` — requires a test: kill worker mid-claim, verify recovery

## Dependencies

- **Task queue schema** (`docs/task-queue-schema.md`) — requires `claim_expires_at` index
- **Audit logging** (`docs/audit-logging.md`) — recovery events emitted to audit log

## Files to create / modify

- `apps/server/src/workers/stale-recovery.ts` — `recoverStaleClaims()` function
- `apps/server/src/index.ts` — schedule recovery on startup
- `tests/stale-recovery.test.ts` — integration test: claim a task, simulate crash, verify recovery
