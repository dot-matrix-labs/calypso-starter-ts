# Kubernetes Manifests for k3s Deployment

## What it is

A complete set of Kubernetes manifests for deploying the starter on a k3s (or any k8s)
cluster, including the application, a self-hosted PostgreSQL, and a one-shot database
initialisation job.

## Why it's needed

Every project built on this template currently has to author k8s manifests from scratch.
A well-structured, parameterised set of manifests reduces per-project deployment cost from
days to hours and encodes operational best practices (secrets as Secret objects, no
hardcoded values, init job pattern for DB setup).

## Files

### `k8s/app.yaml`

Deployment + Service for the application container:
- Image tag parameterised via `deploy.sh` (not hardcoded).
- All environment variables sourced from the `calypso-secrets` Secret.
- Liveness/readiness probes on `GET /healthz`.
- Resource limits set.

### `k8s/postgres.yaml`

StatefulSet + PersistentVolumeClaim for self-hosted PostgreSQL:
- Single replica (for development/small deployments).
- Persistent storage via PVC.
- Credentials sourced from a Secret.

### `k8s/db-init-job.yaml`

One-shot Kubernetes Job that runs `init-remote.ts`:
- `restartPolicy: OnFailure` — retries until the genesis init succeeds.
- Runs before the first app Deployment is applied.
- Uses `SUPERUSER_DATABASE_URL` from the Secret.
- See `docs/genesis-db-init.md` for what the script does.

### `k8s/secrets.example.yaml`

A commented template listing every required Kubernetes secret key with descriptions. Operators
copy this, fill in real values, and apply it before any other manifest.

No plaintext credentials appear in any other manifest file — everything is a `secretKeyRef`.

### `deploy.sh`

```bash
#!/usr/bin/env bash
# Usage: ./deploy.sh <image-tag>
set -euo pipefail
kubectl set image deployment/calypso-app app=ghcr.io/<owner>/calypso-starter-ts:$1
kubectl rollout status deployment/calypso-app
```

Applies manifests and rolls the Deployment to pick up a new image tag. Waits for rollout
to complete before exiting.

## Apply order

```bash
kubectl apply -f k8s/secrets.yaml          # your populated copy of secrets.example.yaml
kubectl apply -f k8s/postgres.yaml
kubectl apply -f k8s/db-init-job.yaml
kubectl wait --for=condition=complete job/calypso-db-init
kubectl apply -f k8s/app.yaml
```

## Dependencies

- **Genesis DB init** (`docs/genesis-db-init.md`) — `db-init-job.yaml` runs `init-remote.ts`.
- **Secrets management** (`docs/secrets-management.md`) — `app.yaml` references the same
  secret keys as `KNOWN_SECRETS`.

## Source reference (rinzler)

`k8s/app.yaml`, `k8s/postgres.yaml`, `k8s/db-init-job.yaml`, `k8s/secrets.example.yaml`,
`deploy.sh` — copy and adapt. Update image names, labels, and secret key names.
