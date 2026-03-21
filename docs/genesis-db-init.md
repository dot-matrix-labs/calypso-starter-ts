# Genesis Database Initialisation

## What it is

A standalone script (`packages/db/init-remote.ts`) that creates databases, roles, and grants
on a fresh PostgreSQL instance using superuser credentials. Runs once as a pre-deploy
Kubernetes Job before the first application deployment.

## Why it's needed

The current `migrate()` function runs at startup as the application role (`app_rw`). It can
only execute DDL that `app_rw` is permitted to run (table creation within existing databases).
It **cannot** create databases or roles.

On managed cloud PostgreSQL (AWS RDS, Google Cloud SQL, Neon, Supabase), the `app_rw`
credentials are all you get at runtime. The databases and roles must be provisioned separately
using an admin connection — which only exists during the initial setup.

## Two-phase initialisation

| Phase | Script | Runs as | When |
|---|---|---|---|
| **Genesis** | `init-remote.ts` | superuser | Once, before first deploy (k8s Job) |
| **Migration** | `migrate()` | `app_rw` | Every startup (idempotent) |

Separating the phases means production containers never hold superuser credentials.

## What `init-remote.ts` does

1. Connects to PostgreSQL using `SUPERUSER_DATABASE_URL`
2. Creates databases: `calypso_app`, `calypso_audit`, `calypso_analytics` (`IF NOT EXISTS`)
3. Creates roles: `app_rw`, `audit_w`, `analytics_w` (`IF NOT EXISTS`)
4. Grants appropriate privileges to each role on its database
5. Enables extensions: `pgcrypto`, `uuid-ossp` in each database
6. All operations are idempotent — safe to re-run

## Error handling

The script exits non-zero if the superuser connection fails. This causes the k8s Job to
restart, preventing the app from starting against an uninitialised database.

## Kubernetes integration

`k8s/db-init-job.yaml` is a one-shot Job that runs `init-remote.ts`. The `apps/server`
Deployment has an `initContainers` dependency on the Job completing successfully.

## Source reference (rinzler)

`packages/db/init-remote.ts` — copy and adapt. Remove rinzler-specific entity type seeds.

## Files to create

- `packages/db/init-remote.ts`
- `k8s/db-init-job.yaml`
- `packages/db/README.md` — document the two-phase init process
