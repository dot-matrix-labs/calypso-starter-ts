# Task Payload Validation

## What it is

Schema validation on task queue payloads that enforces two constraints: payloads must contain
only opaque resource identifiers and routing metadata (no business data), and a key denylist
rejects task creation if the payload JSONB contains any field name associated with PII.

## Why it's needed

Queue payloads are visible in database logs, monitoring dashboards, error reporters, and
dead-letter inspection tools — none of which are designed for PII handling. A payload that
contains `email`, `name`, or user content leaks that data to every infrastructure tool that
touches the queue table.

Workers do not need business data at claim time. They need only a resource ID to fetch the
data through the authenticated API at execution time. Keeping payloads opaque eliminates
the entire category of queue-level data leakage.

## Payload schema

```ts
interface TaskPayload {
  // Opaque resource references — UUIDs or entity IDs only
  [key: string]: string | number | boolean | null;
}
```

**Allowed:** `task_id`, `user_id`, `entity_id`, `correlation_id`, `job_type`, `priority`,
`source`, `target`, `ref`, `version`, `batch_id`.

**Denied (denylist):** `email`, `name`, `address`, `phone`, `ssn`, `content`, `body`,
`message`, `text`, `description`, `title`, `subject`, `password`, `secret`, `token`.

## Validation logic

```ts
const PAYLOAD_PII_DENYLIST = new Set([
  'email', 'name', 'address', 'phone', 'ssn',
  'content', 'body', 'message', 'text',
  'description', 'title', 'subject',
  'password', 'secret', 'token',
]);

function validateTaskPayload(payload: unknown): void {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new ValidationError('payload must be a flat JSON object');
  }
  for (const key of Object.keys(payload)) {
    if (PAYLOAD_PII_DENYLIST.has(key.toLowerCase())) {
      throw new ValidationError(
        `payload key "${key}" is not allowed — use a resource ID reference instead`
      );
    }
  }
}
```

This runs in the `POST /api/tasks` endpoint before the row is inserted.

## Blueprint references

- `TQ-P-002` `opaque-reference-payloads` — payloads carry references, never business data
- `TQ-C-004` `payload-contains-no-pii` — validation rejects denylist keys
- `TQ-T-002` `payload-leaks-business-data` — threat this pattern mitigates
- `TQ-X-002` `business-data-in-payload` — antipattern this pattern prevents

## Files to create / modify

- `apps/server/src/api/tasks-queue.ts` — add `validateTaskPayload()` to POST /api/tasks handler
- `apps/server/src/api/tasks-queue.test.ts` — unit tests: denylist keys rejected, opaque IDs accepted
