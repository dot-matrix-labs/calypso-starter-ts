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
3. Generates secrets:
   - `JWT_SECRET` — random 64-byte hex.
   - `ENCRYPTION_MASTER_KEY` — random 32-byte hex.
   - `SUPERUSER_PASSWORD` or `SUPERUSER_MNEMONIC`.
4. Writes a populated `k8s/secrets.yaml` from `k8s/secrets.example.yaml`.
5. Applies all k8s manifests in order.
6. Waits for the db-init-job to complete.
7. Polls `GET /healthz` until the app responds (or times out).

## Non-interactive mode

When all required env vars are pre-set (`REMOTE_PG_URL`, `APP_DOMAIN`, etc.), the script
skips all prompts. This enables use in CI/CD pipelines.

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
