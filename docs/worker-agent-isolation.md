# Worker Agent Type Isolation

## What it is

Each agent type is deployed with its own PostgreSQL role, its own filtered task queue view,
and its own vendor API credentials. An agent of type A cannot read type B's tasks, use type
B's API keys, or submit results under type B's identity. Isolation is enforced at the
database, API, and network policy layers.

## Why it's needed

Without agent type isolation:

- A compromised agent of any type has access to all task types and all users' data
- An agent that misbehaves can interfere with other agent types' work queues
- Vendor API key rotation for one agent type requires coordinating all agents
- Blast radius of any individual agent compromise spans the entire system

## Per-type database views

```sql
-- View for coding agent: filters to agent_type = 'coding', excludes sensitive columns
CREATE VIEW task_queue_view_coding AS
  SELECT id, job_type, status, payload, correlation_id, priority, created_at,
         attempt, max_attempts
  FROM task_queue
  WHERE agent_type = 'coding';

-- coding agent role can only SELECT from its own view
GRANT SELECT ON task_queue_view_coding TO agent_coding;
```

Sensitive columns excluded from views: `delegated_token`, `created_by`, `result`,
`error_message`. Workers receive the delegated token only through the claim API response
(not from the view).

## Row-level security

```sql
ALTER TABLE task_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY task_queue_coding_read
  ON task_queue FOR SELECT
  TO agent_coding
  USING (agent_type = 'coding');
```

Even if a view is bypassed, RLS prevents an `agent_coding` role from reading rows where
`agent_type != 'coding'`.

## API-layer type validation

When a worker submits a result, the API validates:

```ts
if (delegatedToken.agent_type !== task.agent_type) {
  throw new ForbiddenError('agent_type mismatch');
}
if (delegatedToken.agent_type !== claimedByAgentType) {
  throw new ForbiddenError('token does not match claiming agent type');
}
```

## Deployment isolation

Each agent type is a separate Kubernetes Deployment with:

- Its own environment variables (including vendor API keys)
- Its own network policy (only the specific API endpoints it needs)
- Its own DB secret (`AGENT_DATABASE_URL` with the per-type role credentials)

A Kubernetes NetworkPolicy restricts each worker pod to only reach the API gateway, not
the database directly.

## Adding a new agent type

1. Add a new role in `init-remote.ts`:
   `CREATE ROLE agent_<type> LOGIN PASSWORD '...' IN ROLE agent_worker;`
2. Add a filtered view in `schema.sql`:
   `CREATE VIEW task_queue_view_<type> AS SELECT ... WHERE agent_type = '<type>';`
3. Add an RLS policy in `schema.sql`
4. Add a Kubernetes Deployment manifest in `k8s/workers/<type>.yaml`
5. Add a NetworkPolicy for the new deployment

## Blueprint references

- `WORKER-P-008` `agent-type-isolation`
- `WORKER-P-003` `deployment-time-capability-declaration`
- `WORKER-T-003` `agent-reads-unauthorized-data` — RLS + views prevent this
- `WORKER-T-008` `cross-agent-type-access` — per-role views prevent this
- `TQ-D-004` `per-type-filtered-views`

## Dependencies

- **Worker read-only DB** (`docs/worker-read-only-db.md`) — base role setup
- **Genesis DB init** (`docs/genesis-db-init.md`) — per-type roles created at init time
- **Kubernetes manifests** (`docs/kubernetes-manifests.md`) — per-type Deployment and NetworkPolicy
- **Task queue schema** (`docs/task-queue-schema.md`) — `task_queue` table with `agent_type` column

## Files to create / modify

- `packages/db/init-remote.ts` — per-type role creation
- `packages/db/schema.sql` — per-type views and RLS policies
- `k8s/workers/<type>.yaml` — per-type Deployment manifest
- `apps/server/src/api/tasks-queue.ts` — agent_type validation in result endpoint
