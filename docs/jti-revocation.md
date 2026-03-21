# PostgreSQL-Backed JTI Revocation

## What it is

A database-backed JWT revocation list that replaces the current in-process Map/Set. Revoked
token JTIs are stored in a `revoked_tokens` table and survive server restarts.

## Why it's needed

The current revocation cache is in process memory. This has two problems:

1. **Restart amnesia** — all revocations are lost on server restart, re-admitting logged-out
   sessions.
2. **No multi-instance support** — if the app runs on multiple instances (e.g. after a
   deployment overlap), a token revoked on instance A is still valid on instance B.

Storing revocations in PostgreSQL fixes both.

## Schema

```sql
CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti         TEXT PRIMARY KEY,
  revoked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL
);
```

## Behaviour

- `revokeToken(jti, expiresAt)` — INSERTs a row. Called on logout.
- `isRevoked(jti)` — SELECTs by primary key. Called on every authenticated request.
- A cleanup job runs at startup and every 24 hours to DELETE rows where
  `expires_at < NOW()`, preventing unbounded table growth.

## Performance

The primary key on `jti` ensures O(log n) lookups. Token JTIs are random 128-bit values
(UUID v4 or similar), so there is no hot-spot risk. The table size is bounded by
`max_sessions * session_lifetime / cleanup_interval`.

## Source reference (rinzler)

`apps/server/src/auth/jwt.ts` — updated `revokeToken` and `isRevoked` functions.

## Files to modify

- `packages/db/schema.sql` — add `revoked_tokens` table
- `apps/server/src/auth/jwt.ts` — replace in-memory store with DB reads/writes
