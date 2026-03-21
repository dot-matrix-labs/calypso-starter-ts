# Worker Read-Only Database Access

## What it is

Agent/worker processes connect to PostgreSQL using a read-only database role. The role grants
`SELECT` on curated task queue views only — no `INSERT`, `UPDATE`, or `DELETE` on any table.
All writes from workers reach the database exclusively through authenticated API requests.

## Why it's needed

An AI agent with direct write access to a database can:
- Corrupt records without an audit trail
- Bypass API-layer schema validation and business rules
- Exfiltrate data through write surfaces not designed for PII handling
- Act on stale reads without conflict detection

Restricting workers to read-only DB access makes these outcomes structurally impossible — a
permission error from the database fires before any application logic runs, regardless of what
the agent code attempts.

## Database roles

```sql
-- Created once during genesis DB init (init-remote.ts)
CREATE ROLE agent_worker NOLOGIN;
GRANT CONNECT ON DATABASE calypso_app TO agent_worker;

-- Per agent type (one role per type, created at init time)
CREATE ROLE agent_coding  LOGIN PASSWORD '...' IN ROLE agent_worker;
CREATE ROLE agent_analysis LOGIN PASSWORD '...' IN ROLE agent_worker;

-- Grant read-only access to task queue views only
GRANT SELECT ON task_queue_view_coding   TO agent_coding;
GRANT SELECT ON task_queue_view_analysis TO agent_analysis;

-- Explicitly deny all writes (belt-and-suspenders)
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM agent_worker;
```

## Startup role verification

Workers verify their DB role is read-only on startup and panic if not:

```ts
const result = await db.query(`
  SELECT has_table_privilege(current_user, 'task_queue', 'INSERT') AS can_insert
`);
if (result.rows[0].can_insert) {
  logger.error('Worker DB role has INSERT on task_queue — refusing to start');
  process.exit(1);
}
```

## Write path

All agent writes go through the API:

```
Worker → POST /api/tasks/:id/result (with delegated token)
       → API validates, authorizes, and commits via app_rw role
```

The worker never holds `app_rw` credentials. Its only credential is the agent-type DB role
(read-only) and the short-lived delegated token for the specific task being executed.

## Blueprint references

- `WORKER-P-001` `read-only-database-access`
- `WORKER-P-002` `writes-through-authenticated-api`
- `WORKER-T-001` `direct-db-write-bypasses-validation` — threat this prevents
- `WORKER-T-002` `compromised-credential-grants-db-write` — threat this prevents
- `TQ-C-008` `startup-role-verification-tested`

## Dependencies

- **Genesis DB init** (`docs/genesis-db-init.md`) — roles created in `init-remote.ts`
- **Three-database pools** (`docs/three-database-pools.md`) — workers use agent-type pool only
- **Delegated tokens** (`docs/delegated-tokens.md`) — write path authentication

## Files to create / modify

- `packages/db/init-remote.ts` — add agent role creation
- `apps/worker/src/db.ts` — agent-type pool using read-only credentials
- `apps/worker/src/startup.ts` — role verification check on startup
