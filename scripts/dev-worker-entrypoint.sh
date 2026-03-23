#!/usr/bin/env sh
# dev-worker-entrypoint.sh — startup sequence for the dev worker container.
#
# Steps:
#   1. Wait for PostgreSQL TCP to become reachable.
#   2. Wait for the app server to be up (it runs migrate() on startup).
#   3. Grant read-only view access to the agent role (idempotent).
#   4. Seed the dev worker credential in the database (idempotent).
#   5. exec the worker runner.

set -e

PGHOST="${PGHOST:-postgres}"
PGPORT="${PGPORT:-5432}"
APP_HOST="${APP_HOST:-app}"
APP_PORT="${APP_PORT:-31415}"
AGENT_TYPE="${AGENT_TYPE:-coding}"

# ---------------------------------------------------------------------------
# 1. Wait for PostgreSQL TCP
# ---------------------------------------------------------------------------
echo "[worker-entrypoint] Waiting for PostgreSQL at ${PGHOST}:${PGPORT}..."
timeout=60
elapsed=0
until bun -e "
  const net = require('net');
  const client = net.createConnection({ host: '${PGHOST}', port: ${PGPORT} });
  client.on('connect', () => { client.destroy(); process.exit(0); });
  client.on('error', () => process.exit(1));
" 2>/dev/null; do
  elapsed=$((elapsed + 1))
  if [ "$elapsed" -ge "$timeout" ]; then
    echo "[worker-entrypoint] ERROR: Timed out waiting for PostgreSQL after ${timeout}s" >&2
    exit 1
  fi
  sleep 1
done
echo "[worker-entrypoint] PostgreSQL is reachable."

# ---------------------------------------------------------------------------
# 2. Wait for the app server (ensures migrate() has completed and views exist)
# ---------------------------------------------------------------------------
echo "[worker-entrypoint] Waiting for app server at ${APP_HOST}:${APP_PORT}..."
timeout=120
elapsed=0
until bun -e "
  const net = require('net');
  const client = net.createConnection({ host: '${APP_HOST}', port: ${APP_PORT} });
  client.on('connect', () => { client.destroy(); process.exit(0); });
  client.on('error', () => process.exit(1));
" 2>/dev/null; do
  elapsed=$((elapsed + 1))
  if [ "$elapsed" -ge "$timeout" ]; then
    echo "[worker-entrypoint] ERROR: Timed out waiting for app server after ${timeout}s" >&2
    exit 1
  fi
  sleep 1
done
echo "[worker-entrypoint] App server is reachable."

# ---------------------------------------------------------------------------
# 3. Grant read-only view access to the agent role (idempotent)
#    Runs as DATABASE_URL user (app_rw in dev) which owns the schema.
# ---------------------------------------------------------------------------
echo "[worker-entrypoint] Granting view access to agent_${AGENT_TYPE} role..."
bun -e "
  const postgres = require('postgres').default ?? require('postgres');
  const sql = postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 5 });
  const agentType = process.env.AGENT_TYPE ?? 'coding';
  const roleName = 'agent_' + agentType;
  const viewName = 'task_queue_view_' + agentType;
  async function run() {
    await sql.unsafe('GRANT USAGE ON SCHEMA public TO ' + roleName);
    await sql.unsafe('GRANT SELECT ON ' + viewName + ' TO ' + roleName);
    // Grant SELECT on worker_credentials so credential fetch works
    await sql.unsafe('GRANT SELECT ON worker_credentials TO ' + roleName);
    // Grant CONNECT on pg_notify channel (SELECT on task_queue is NOT granted)
    console.log('[worker-entrypoint] Grants applied for ' + roleName);
    await sql.end({ timeout: 3 });
  }
  run().catch(err => { console.error(err); process.exit(1); });
"
echo "[worker-entrypoint] View access granted."

# ---------------------------------------------------------------------------
# 4. Seed the dev worker credential (idempotent)
# ---------------------------------------------------------------------------
echo "[worker-entrypoint] Seeding dev worker credential for agent_type=${AGENT_TYPE}..."
bun run /app/scripts/dev-seed-worker-credentials.ts
echo "[worker-entrypoint] Dev worker credential ready."

# ---------------------------------------------------------------------------
# 5. Start the worker runner
# ---------------------------------------------------------------------------
echo "[worker-entrypoint] Starting worker runner..."
exec bun run /app/apps/worker/src/index.ts
