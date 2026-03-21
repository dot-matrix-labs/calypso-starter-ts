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

| Phase         | Script           | Runs as   | When                                |
| ------------- | ---------------- | --------- | ----------------------------------- |
| **Genesis**   | `init-remote.ts` | superuser | Once, before first deploy (k8s Job) |
| **Migration** | `migrate()`      | `app_rw`  | Every startup (idempotent)          |

Separating the phases means production containers never hold superuser credentials.

## Environment variables

Read from `calypso-db-init-secret` by the k8s Job:

| Variable               | Required | Default             | Description                               |
| ---------------------- | -------- | ------------------- | ----------------------------------------- |
| `ADMIN_DATABASE_URL`   | Yes      | —                   | Admin-level postgres connection URL       |
| `APP_RW_PASSWORD`      | Yes      | —                   | Password for the `app_rw` role            |
| `AUDIT_W_PASSWORD`     | Yes      | —                   | Password for the `audit_w` role           |
| `ANALYTICS_W_PASSWORD` | Yes      | —                   | Password for the `analytics_w` role       |
| `APP_DB`               | No       | `calypso_app`       | Application database name                 |
| `AUDIT_DB`             | No       | `calypso_audit`     | Audit database name                       |
| `ANALYTICS_DB`         | No       | `calypso_analytics` | Analytics database name                   |
| `DB_SSL`               | No       | —                   | `disable` / `require` / `verify-full`     |
| `DB_CA_CERT`           | No       | —                   | CA certificate PEM for `verify-full` mode |

## What `init-remote.ts` does

1. Validates required env vars (`ADMIN_DATABASE_URL`, all three role passwords). Exits non-zero immediately if any are missing.
2. Connects to PostgreSQL using `ADMIN_DATABASE_URL` with SSL options derived from `DB_SSL` / `DB_CA_CERT`.
3. Creates roles (`IF NOT EXISTS`): `app_rw`, `audit_w`, `analytics_w`. Updates passwords on existing roles via `ALTER ROLE`.
4. Creates databases (`IF NOT EXISTS`): `calypso_app`, `calypso_audit`, `calypso_analytics`. Grants `CONNECT` to each role on its database.
5. Configures `calypso_app` grants:
   - `GRANT ALL ON SCHEMA public TO app_rw`
   - `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_rw`
   - `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_rw`
   - `ALTER DEFAULT PRIVILEGES` for future tables and sequences created by the admin user
   - **PG17+ only:** `GRANT MAINTAIN ON ALL TABLES` + default privileges for MAINTAIN, version-guarded by `server_version_num >= 170000`. This lets `app_rw` run `CREATE INDEX` / `VACUUM` / `ANALYZE` on admin-owned tables. Silently skipped on PG16 and earlier.
6. Creates `calypso_audit` schema: `audit_log` table + indexes. Grants `INSERT, SELECT` to `audit_w` (plus `UPDATE(status)` on the status column only). No `DELETE` or `TRUNCATE`.
7. Creates `calypso_analytics` schema: `analytics_events` + `audit_replica` tables + indexes. Grants `INSERT, SELECT` to `analytics_w`.
8. Runs verification queries against `pg_roles`, `pg_database`, `information_schema.tables`, and `information_schema.role_table_grants`. Exits non-zero if any check fails.
9. All operations are idempotent — safe to re-run.

### Privilege model detail

Tables remain **owned by the admin user**, not by `app_rw`. This means:

- `app_rw` gets explicit DML grants (`SELECT/INSERT/UPDATE/DELETE`) rather than ownership
- On PG16 and earlier, `app_rw` can run migrations (`CREATE TABLE`, `CREATE INDEX`) via `GRANT ALL ON SCHEMA public`
- On PG17+, the `MAINTAIN` privilege is additionally required for `CREATE INDEX` on tables owned by another role — the script detects the PG version and grants it automatically
- `ALTER DEFAULT PRIVILEGES` ensures future tables/sequences created by the admin also get the correct grants

### SSL handling

The `sslOptions()` helper in `init-remote.ts` handles SSL identically to the application's `buildSslOptions()`:

- `DB_SSL` unset or `"disable"` → no TLS (`undefined`)
- `"require"` → TLS enabled, server cert **not** verified (`{ rejectUnauthorized: false }`)
- `"verify-full"` → TLS enabled, cert verified against `DB_CA_CERT` (`{ rejectUnauthorized: true, ca: ... }`)

## Error handling

The script exits non-zero if:

- Any required env var is missing
- The admin connection fails
- Any verification check fails after setup

This causes the k8s Job to restart, preventing the app from starting against an uninitialised database.

## Kubernetes integration

`k8s/db-init-job.yaml` is a one-shot Job that runs `init-remote.ts`. The `apps/server`
Deployment has an `initContainers` dependency on the Job completing successfully.

## Source reference (rinzler)

`packages/db/init-remote.ts` — copy and adapt. Remove rinzler-specific:

- Audit log `action` CHECK constraint values (replace with calypso-specific actions)
- Analytics `audit_replica` table (evaluate whether needed)

## Files to create

- `packages/db/init-remote.ts`
- `k8s/db-init-job.yaml`
- `packages/db/README.md` — document the two-phase init process
