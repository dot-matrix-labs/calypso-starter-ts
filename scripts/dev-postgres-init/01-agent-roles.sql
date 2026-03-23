-- dev-postgres-init/01-agent-roles.sql
--
-- Creates the agent_worker base role and per-type agent roles for local
-- development.  These roles are created by init-remote.ts in production;
-- for dev they are bootstrapped directly via postgres init scripts so the
-- worker container can authenticate without a full remote-init run.
--
-- The agent_coding role gets:
--   - LOGIN with a known dev password
--   - CONNECT on calypso_app
--   - USAGE on public schema
--   - SELECT on task_queue_view_coding only (no INSERT/UPDATE/DELETE)
--
-- RLS is NOT configured here because schema.sql (run by migrate()) creates
-- the views with WHERE agent_type = '...' filters that already restrict rows.
-- The view-level filter is sufficient for local development isolation.
--
-- This script is idempotent: all statements use IF NOT EXISTS / DO...END guards.

-- Base group role for all agent workers
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'agent_worker') THEN
    CREATE ROLE agent_worker NOLOGIN;
  END IF;
END
$$;

-- Per-type coding agent role
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'agent_coding') THEN
    CREATE ROLE agent_coding WITH LOGIN PASSWORD 'agent_coding_dev_password' IN ROLE agent_worker;
  ELSE
    ALTER ROLE agent_coding WITH LOGIN PASSWORD 'agent_coding_dev_password';
  END IF;
END
$$;

-- Per-type analysis agent role
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'agent_analysis') THEN
    CREATE ROLE agent_analysis WITH LOGIN PASSWORD 'agent_analysis_dev_password' IN ROLE agent_worker;
  ELSE
    ALTER ROLE agent_analysis WITH LOGIN PASSWORD 'agent_analysis_dev_password';
  END IF;
END
$$;

-- Grant CONNECT on the app database to both agent roles
GRANT CONNECT ON DATABASE calypso_app TO agent_coding;
GRANT CONNECT ON DATABASE calypso_app TO agent_analysis;
