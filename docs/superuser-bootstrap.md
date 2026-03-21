# Superuser Bootstrap Seeding

## What it is

On first deploy, if no superuser account exists, the server creates one automatically using
credentials from environment variables. The operation is idempotent — restarts after the
first user is created are no-ops.

## Why it's needed

After a fresh deployment there is no way to log in. An operator must currently insert a row
manually into the database to bootstrap access. This is undocumented, error-prone, and
breaks automated deployment pipelines.

## Behaviour

`bootstrap.ts` (or a function it calls before starting the server) runs on every startup:

1. Queries whether any user with `role = 'superuser'` exists.
2. If none exists, creates one:
   - Username/email from `SUPERUSER_EMAIL` env var.
   - Password from `SUPERUSER_PASSWORD` env var (hashed with bcrypt before storage).
   - If `SUPERUSER_PASSWORD` is not set but `SUPERUSER_MNEMONIC` is, derives a password
     deterministically from the mnemonic (BIP-39 word list → UTF-8 bytes → bcrypt).
   - If neither is set, logs a warning and skips seeding.
3. If a superuser already exists, logs a one-line message and proceeds normally.

## Protected delete

`DELETE /api/users/:id` returns 409 if the request would remove the last remaining superuser.
This prevents an operator from accidentally locking themselves out.

## Environment variables

| Var | Purpose |
|---|---|
| `SUPERUSER_EMAIL` | Email/username for the bootstrap account |
| `SUPERUSER_PASSWORD` | Plaintext password (hashed before storage) |
| `SUPERUSER_MNEMONIC` | BIP-39 mnemonic for deterministic password derivation (alternative to `SUPERUSER_PASSWORD`) |

## Kubernetes secret

In the k8s deployment, these variables come from the `calypso-secrets` Secret. The mnemonic
approach is preferred for k8s because it can be derived offline and verified without
connecting to the database.

## Dependency

Requires **secrets management** (`docs/secrets-management.md`) to be in place so that
`SUPERUSER_PASSWORD` and `SUPERUSER_MNEMONIC` are available via `getSecret()` before the
seeding logic runs.

## Source reference (rinzler)

`apps/server/src/bootstrap.ts` and `packages/db/seed.ts` — adapt, remove rinzler-specific
entity type seeds.
