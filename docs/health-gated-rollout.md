# Health-Gated Rollout Sequence

## What it is

A scripted, ordered deployment sequence: database migrations first, then API server, then
workers, then static web assets last. Each phase must pass a health check before the next
phase begins. A failed phase aborts the rollout rather than continuing to the next component.

## Why it's needed

Deploying all components simultaneously risks:
- Workers starting before the schema migration is complete, hitting missing columns
- API server starting with the old schema while workers expect the new one
- Static web assets pointing to API endpoints that don't exist yet

The ordered sequence with health gates ensures each component enters service in a consistent
state and the release is either fully applied or cleanly rolled back at the failed phase.

## Rollout sequence

```
1. DB migrations
   └── run migrate() against calypso_app
   └── health gate: SELECT 1 succeeds on migrated DB
   └── FAIL → stop, do not proceed

2. API server rollout
   └── kubectl rollout restart deployment/calypso-api
   └── health gate: GET /healthz returns { status: 'ok' }
   └── FAIL → kubectl rollout undo deployment/calypso-api, stop

3. Worker rollout (per agent type)
   └── kubectl rollout restart deployment/worker-<type>  (one type at a time)
   └── health gate: worker pod Ready condition
   └── FAIL → kubectl rollout undo deployment/worker-<type>, stop

4. Static web (CDN invalidation / S3 sync)
   └── sync web-dist.tar.gz to CDN origin
   └── invalidate CDN cache
   └── FAIL → re-sync previous version
```

## `deploy.sh` implementation

```bash
#!/usr/bin/env bash
set -euo pipefail

TAG=${1:?Usage: deploy.sh <tag>}

echo "=== Phase 1: DB migrations ==="
bun run db:migrate
wait_for_db_health

echo "=== Phase 2: API server ==="
kubectl set image deployment/calypso-api app=ghcr.io/${REPO}:${TAG}
kubectl rollout status deployment/calypso-api --timeout=120s
wait_for_healthz http://api.internal/healthz

echo "=== Phase 3: Workers ==="
for AGENT_TYPE in coding analysis; do
  kubectl set image deployment/worker-${AGENT_TYPE} worker=ghcr.io/${REPO}-worker:${TAG}
  kubectl rollout status deployment/worker-${AGENT_TYPE} --timeout=120s
done

echo "=== Phase 4: Static web ==="
aws s3 sync ./web-dist s3://${WEB_BUCKET}/
aws cloudfront create-invalidation --distribution-id ${CF_DIST_ID} --paths '/*'

echo "=== Rollout complete: ${TAG} ==="
```

## Health gate helpers

```bash
wait_for_db_health() {
  for i in $(seq 1 30); do
    bun run db:ping && return 0
    sleep 2
  done
  echo "DB health gate failed" >&2; exit 1
}

wait_for_healthz() {
  local url=$1
  for i in $(seq 1 30); do
    curl -sf "${url}" | jq -e '.status == "ok"' && return 0
    sleep 2
  done
  echo "Health gate failed: ${url}" >&2; exit 1
}
```

## Schema forward-compatibility window

During the rollout window, new API code runs against both the old and new schema. Migrations
must be forward-compatible:
- New columns must have `DEFAULT` values or be `NULLABLE`
- Old columns must not be dropped in the same migration as new columns are added
- Renaming is always done as add + deprecate + later drop across separate releases

## Blueprint references

- `DEPLOY-P-008` `rollouts-are-ordered-and-health-gated`
- `DEPLOY-P-007` `schema-upgrades-forward-compatible`
- `DEPLOY-P-005` `deployment-is-a-build-not-a-ceremony`
- `DEPLOY-T-009` `previous-version-unavailable-for-rollback` — `kubectl rollout undo` provides this

## Dependencies

- **CI release hardening** (`docs/ci-release-hardening.md`) — `GET /healthz` endpoint required
- **Kubernetes manifests** (`docs/kubernetes-manifests.md`) — rollout target deployments
- **Docker containerisation** (`docs/docker-containerisation.md`) — images must exist in GHCR

## Files to create / modify

- `deploy.sh` — ordered health-gated deploy script
- `scripts/wait-for-healthz.sh` — reusable health gate helper
- `apps/server/src/index.ts` — `GET /healthz` already exists; ensure it checks DB connectivity
