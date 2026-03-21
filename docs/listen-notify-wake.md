# LISTEN/NOTIFY Worker Wake

## What it is

A PostgreSQL `AFTER INSERT` trigger that calls `pg_notify('task_queue_<agent_type>', task_id)`
on each new task insertion. Workers `LISTEN` on their type-specific channel and wake immediately
rather than waiting for the next poll interval. The poll loop remains the authoritative discovery
mechanism; notifications only reduce latency.

## Why it's needed

Polling on a fixed interval (e.g. every 5 seconds) introduces average latency of half the interval
for interactive tasks where a user is waiting for a result. For task volumes where PostgreSQL is the
queue backend, notifications are free — they use an existing connection and require no additional
infrastructure.

Notifications are best-effort (lost during connection interruptions) which is acceptable because the
poll loop provides guaranteed discovery. A missed notification delays a task by at most one poll
interval.

## Trigger

```sql
CREATE OR REPLACE FUNCTION notify_task_inserted()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('task_queue_' || NEW.agent_type, NEW.id::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER task_queue_notify_insert
AFTER INSERT ON task_queue
FOR EACH ROW EXECUTE FUNCTION notify_task_inserted();
```

## Worker LISTEN loop

Workers establish a dedicated notification connection and use a select-or-timeout pattern:

```ts
await notifyConn.query(`LISTEN task_queue_${agentType}`);

async function waitForWork(): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, POLL_INTERVAL_MS);
    notifyConn.once('notification', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

while (running) {
  await tryClaimAndExecute();
  await waitForWork(); // wakes on notification OR poll interval
}
```

`POLL_INTERVAL_MS` defaults to 5000. Even if every notification is missed, the worker wakes
every 5 seconds and polls.

## Channel naming

Channel names are `task_queue_<agent_type>` — e.g. `task_queue_coding`, `task_queue_analysis`.
A notification on one channel does not wake workers of a different type.

## Blueprint references

- `TQ-D-005` `listen-notify-wake`
- `TQ-P-005` `notification-assists-polling-not-replaces` — notifications supplement, never replace
- `TQ-C-006` `notification-channel-per-type` — per-agent-type channels verified
- `TQ-X-004` `notification-as-sole-trigger` — antipattern this avoids

## Dependencies

- **Task queue schema** (`docs/task-queue-schema.md`) — trigger on `task_queue` table

## Files to create / modify

- `packages/db/schema.sql` — add trigger function and trigger
- `apps/worker/src/queue-listener.ts` — `waitForWork()` select-or-timeout pattern
