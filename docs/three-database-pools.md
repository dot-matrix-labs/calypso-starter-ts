# Three-Database Pool Architecture

## What it is

Three separate PostgreSQL connection pools — one for the main application, one for the
append-only audit log, and one for analytics events — each connecting as a different
PostgreSQL role with appropriate permissions.

## Why it's needed

Using a single database pool for everything means the application's runtime credentials can
read, write, and delete audit records. Separating the pools enforces access control at the
PostgreSQL role level:

- `app_rw` — full read/write on `calypso_app`
- `audit_w` — INSERT-only on `calypso_audit` (cannot modify or delete past entries)
- `analytics_w` — INSERT-only on `calypso_analytics`

Even if the application is compromised, audit records cannot be tampered with using the
credentials it holds.

## Pool configuration

| Export         | Database            | Role          | Max connections | Env var                  |
| -------------- | ------------------- | ------------- | --------------- | ------------------------ |
| `sql`          | `calypso_app`       | `app_rw`      | 10              | `DATABASE_URL`           |
| `auditSql`     | `calypso_audit`     | `audit_w`     | 5               | `AUDIT_DATABASE_URL`     |
| `analyticsSql` | `calypso_analytics` | `analytics_w` | 3               | `ANALYTICS_DATABASE_URL` |

All three pools share the same SSL options from `buildSslOptions()`.

## Graceful degradation

If `AUDIT_DATABASE_URL` or `ANALYTICS_DATABASE_URL` are not set, the pools fall back to
`localhost` defaults. The server starts without crashing. This allows local development to
work with only `DATABASE_URL` configured.

## AppState update

`AppState` in `apps/server/src/index.ts` must be updated to expose all three pools to route
handlers so that audit and analytics writes can use the correct pool.

## Source reference (rinzler)

`packages/db/index.ts` — three pool exports and the SSL integration.

## Files to create / modify

- `packages/db/index.ts` — add `auditSql` and `analyticsSql` exports
- `packages/db/schema.sql` — add DDL stubs for audit and analytics databases
- `apps/server/src/index.ts` — update `AppState` type
