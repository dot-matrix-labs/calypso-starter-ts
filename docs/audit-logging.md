# Audit Logging

## What it is

An append-only, hash-chained audit log in a separate database (`calypso_audit`). Every
state-mutating operation writes an audit entry before the primary write completes.

## Why it's needed

Without an audit log there is no way to answer:
- "Who created / modified / deleted this record and when?"
- "Has the audit log been tampered with?"
- Compliance questions (GDPR right to erasure, SOC 2 CC6.x, etc.)

The hash chain makes tampering detectable — modifying any past entry invalidates all
subsequent hashes.

## Schema (`calypso_audit` database)

```sql
CREATE TABLE audit_events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id     UUID,                   -- NULL for system-initiated events
  action       TEXT        NOT NULL,   -- e.g. 'task.create', 'user.delete'
  entity_type  TEXT        NOT NULL,
  entity_id    TEXT        NOT NULL,
  before       JSONB,                  -- state before (NULL for creates)
  after        JSONB,                  -- state after (NULL for deletes)
  ip           TEXT,
  user_agent   TEXT,
  ts           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  prev_hash    TEXT        NOT NULL,
  hash         TEXT        NOT NULL
);
```

## Hash chain

Each row's `hash` is:
```
SHA-256(prev_hash + JSON.stringify({ actor_id, action, entity_type, entity_id, before, after, ts }))
```

The first row uses `AUDIT_GENESIS_HASH` (from env) as its `prev_hash`. This is a random
value generated at deployment time.

`GET /api/audit/verify` (superuser only) reads all rows in insertion order, recomputes each
hash, and returns:
```json
{ "valid": true }
// or
{ "valid": false, "firstInvalidId": "uuid-of-first-tampered-row" }
```

## Audit-log-first pattern

`emitAuditEvent(event)` is called **before** the primary database write:

```ts
await emitAuditEvent({ actor_id, action: 'task.create', entity_type: 'task', ... });
await sql`INSERT INTO tasks ...`;
```

If the audit write fails (e.g. `auditSql` connection is down), the primary write does not
proceed and the endpoint returns 500. This ensures every committed write has a corresponding
audit entry.

## `emitAuditEvent` API

```ts
interface AuditEvent {
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
  user_agent?: string;
}

export async function emitAuditEvent(event: AuditEvent): Promise<void>
```

## Dependency

Requires **three-database pool architecture** (`docs/three-database-pools.md`) — uses
`auditSql` pool.

## Source reference (rinzler)

`apps/server/src/api/audit.ts` — copy and adapt. Remove rinzler-specific action types;
use generic `task.create`, `task.update`, `task.delete`, `user.create`, etc.
