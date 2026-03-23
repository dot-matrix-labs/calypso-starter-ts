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
   - Derives a password deterministically from the `SUPERUSER_MNEMONIC` env var
     (BIP-39 word list → UTF-8 bytes → bcrypt).
   - If the mnemonic is not set, logs a warning and skips seeding.
3. If a superuser already exists, logs a one-line message and proceeds normally.

## Protected delete

`DELETE /api/users/:id` returns 409 if the request would remove the last remaining superuser.
This prevents an operator from accidentally locking themselves out.

## Environment variables

| Var                  | Purpose                                                |
| -------------------- | ------------------------------------------------------ |
| `SUPERUSER_EMAIL`    | Email/username for the bootstrap account               |
| `SUPERUSER_MNEMONIC` | BIP-39 mnemonic for deterministic password derivation. |

## Kubernetes secret

In the k8s deployment, these variables come from the `calypso-api-secrets` Secret.

## Dependency

Requires **secrets management** (`docs/secrets-management.md`) to be in place so that
`SUPERUSER_MNEMONIC` is available via `getSecret()` before the
seeding logic runs.

## Source reference (rinzler)

`apps/server/src/bootstrap.ts` and `packages/db/seed.ts` — adapt, remove rinzler-specific
entity type seeds.
