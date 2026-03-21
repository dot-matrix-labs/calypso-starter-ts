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

| `DB_SSL` value       | Behaviour                                              |
| -------------------- | ------------------------------------------------------ |
| unset or `"disable"` | No TLS — for local k8s-internal Postgres               |
| `"require"`          | TLS enabled, server certificate **not** verified       |
| `"verify-full"`      | TLS enabled, server cert verified against `DB_CA_CERT` |
| anything else        | Warning logged, no TLS                                 |

For `verify-full`, the `DB_CA_CERT` environment variable must contain the PEM certificate.
If `DB_CA_CERT` is missing, it logs a warning and falls back to `require` mode.

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
