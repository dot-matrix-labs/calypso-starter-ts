# Host Initialisation Script

## What it is

An interactive bash script (`init-host.sh`) that provisions a new VPS or k3s host from
scratch: installs k3s, generates secrets, writes Kubernetes manifests, runs the database
genesis init, and validates the deployment.

## Why it's needed

Setting up a new host requires a documented sequence of steps that is currently manual and
error-prone. One script that handles the full sequence reduces first-deployment time from
hours to minutes and ensures nothing is missed.

## What `init-host.sh` does

1. Checks for and installs k3s if not present.
2. Prompts for (or reads from env vars):
   - Database mode: local (uses `k8s/postgres.yaml`) or remote managed (external PG URL).
   - App domain for TLS/ingress configuration.
   - Required credential values.
   - All `read` prompts are guarded with `[ -t 0 ]` (TTY check) — if stdin is not a terminal (CI/CD, piped input), prompts are skipped and the script uses env var values only.
3. Validates remote PostgreSQL connectivity using bash `/dev/tcp` (no `postgresql-client` or `psql` required). Confirms host:port is reachable; credential validation is deferred to the db-init Job.
   - In non-interactive mode (no TTY): fails immediately on connection failure instead of re-prompting.
   - In interactive mode: re-prompts for host/port on failure.
4. Generates secrets:
   - `JWT_SECRET` — random 64-byte hex.
   - `ENCRYPTION_MASTER_KEY` — random 32-byte hex.
   - `SUPERUSER_PASSWORD` or `SUPERUSER_MNEMONIC`.
5. Writes a populated `k8s/secrets.yaml` from `k8s/secrets.example.yaml`.
   - `REMOTE_PG_CA_CERT` is guarded with `${REMOTE_PG_CA_CERT:-}` after `unset` to prevent `set -e` crashes when the variable was never set.
6. Applies all k8s manifests in order.
7. Configures `ufw` firewall — runs `ufw disable` before `ufw --force reset` to avoid errors on first run when ufw has no existing rules.
8. Waits for the db-init-job to complete.
9. Polls `GET /healthz` until the app responds (or times out).

## Non-interactive mode

When all required env vars are pre-set (`REMOTE_PG_HOST`, `REMOTE_PG_PORT`, `APP_DOMAIN`,
etc.) and stdin is not a terminal, the script skips all prompts. Key behaviours:

- SSL mode prompt is skipped when `REMOTE_PG_SSL` is already set (TTY guard: `[ -t 0 ]`)
- Remote PG connectivity check aborts immediately on failure (no re-prompt loop)
- All optional integrations (WhatsApp, Resend, Brevo) use `${VAR:-}` defaults

This enables use in CI/CD pipelines and automated provisioning.

## Idempotency

Running the script a second time on the same host:

- Skips k3s installation (already installed).
- Does not regenerate secrets that already exist in the Kubernetes Secret.
- Re-applies manifests (`kubectl apply` is idempotent).
- Skips the db-init-job if it has already completed.

## `whoami.sh`

A companion script that reports the current deployment state without making changes:

```
Namespace:  calypso
Image tag:  ghcr.io/dot-matrix-labs/calypso-starter-ts:v1.2.3
Domain:     app.example.com
DB mode:    remote
Secrets:    calypso-secrets ✓ (all keys present)
```

Secret values are never printed — only their presence is checked.

## Dependency

Requires the **Kubernetes manifests** (`docs/kubernetes-manifests.md`) to exist before
`init-host.sh` can apply them.

## Source reference (rinzler)

`init-host.sh`, `whoami.sh` — copy and adapt. Remove rinzler-specific service names and
secret keys.
