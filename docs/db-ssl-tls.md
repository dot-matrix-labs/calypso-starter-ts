# SSL/TLS Configuration for Remote PostgreSQL

## What it is

A `buildSslOptions()` function that reads a `DB_SSL` environment variable and returns the
correct `ssl` option for the `postgres` connection pool, enabling TLS for remote managed
PostgreSQL services.

## Why it's needed

The starter's database pool has no TLS support. Any deployment using a managed PostgreSQL
service (AWS RDS, Google Cloud SQL, Supabase, Railway, Neon) requires TLS to protect
credentials and query data in transit. Without it, the connection cannot even be established
against most managed providers.

## Modes

| `DB_SSL` value       | Behaviour                                              | `ssl` option returned              |
| -------------------- | ------------------------------------------------------ | ---------------------------------- |
| unset or `"disable"` | No TLS — for local k8s-internal Postgres               | `undefined`                        |
| `"require"`          | TLS enabled, server certificate **not** verified       | `{ rejectUnauthorized: false }`    |
| `"verify-full"`      | TLS enabled, server cert verified against `DB_CA_CERT` | `{ rejectUnauthorized: true, ca }` |
| anything else        | Warning logged, no TLS                                 | `undefined`                        |

For `verify-full`, the `DB_CA_CERT` environment variable must contain the PEM certificate.
If `DB_CA_CERT` is missing, it logs a warning and falls back to `require` mode.

**Important:** `DB_SSL=disable` must be handled as an explicit "no TLS" value, returning
`undefined`. The rinzler implementation previously had a bug where `disable` fell through
to the `require` code path (TLS without cert verification). This was fixed in rinzler PR #165.

## Usage

```ts
// packages/db/index.ts
import { buildSslOptions } from './index';

export const sql = postgres(appDbUrl, {
  max: 10,
  ssl: buildSslOptions(),
});
```

## Source reference (rinzler)

`packages/db/index.ts` — `buildSslOptions()` function and the SSL log line.
`packages/db/tests/ssl.test.ts` — unit tests for all five cases.

## Files to create / modify

- `packages/db/index.ts` — add `buildSslOptions()`, pass result to all three pool constructors
- `packages/db/tests/ssl.test.ts` — unit test all five env var combinations
