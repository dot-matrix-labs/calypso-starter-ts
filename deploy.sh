#!/usr/bin/env bash
# deploy.sh — health-gated ordered rollout for zero-downtime deployments.
#
# Usage:
#   ./deploy.sh <image-tag>
#
# Example:
#   ./deploy.sh sha-abc1234
#   ./deploy.sh v1.2.3
#
# Phases (each gates on a health check before the next begins):
#   1. DB migrations  — bun run packages/db/migrate.ts; gate: SELECT 1 on DB
#   2. API server     — kubectl set image deployment/calypso-app; gate: GET /health
#   3. Workers        — kubectl set image per worker type; gate: pod Ready condition
#   4. Static web     — aws s3 sync + CDN invalidation; gate: sync succeeds
#
# Environment variables (required at deploy time):
#   IMAGE_REPO        — container image repository (default: ghcr.io/<owner>/calypso-starter-ts)
#   API_URL           — base URL for the running API server (default: http://<host>:31415/health)
#   DATABASE_URL      — postgres connection string used by migration runner
#   CDN_DISTRIBUTION  — CloudFront distribution ID for cache invalidation (optional)
#   S3_BUCKET         — S3 bucket name for static web assets (optional)
#   WORKER_TYPES      — space-separated list of worker agent types (default: empty — skip worker phase)

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <image-tag>" >&2
  exit 1
fi

IMAGE_TAG="$1"
IMAGE_REPO="${IMAGE_REPO:-ghcr.io/dot-matrix-labs/calypso-starter-ts}"
IMAGE="${IMAGE_REPO}:${IMAGE_TAG}"

# Health gate settings
HEALTH_MAX_RETRIES="${HEALTH_MAX_RETRIES:-30}"
HEALTH_RETRY_INTERVAL="${HEALTH_RETRY_INTERVAL:-2}"

# API health check URL — must be reachable from the runner.
# Default assumes the app NodePort (31415) is reachable at the deploy host.
# Override with API_URL=https://your-domain if a public hostname is available.
APP_DEPLOYMENT="${APP_DEPLOYMENT:-calypso-app}"
APP_CONTAINER_NAME="${APP_CONTAINER_NAME:-app}"
API_HEALTHZ_URL="${API_URL:-http://${DEPLOY_HOST:-localhost}:31415}/health"

# Worker deployment names — e.g. "analytics ingestion" → worker-analytics, worker-ingestion
WORKER_TYPES="${WORKER_TYPES:-}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

log() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"
}

die() {
  log "ERROR: $*" >&2
  exit 1
}

# run_migration_job — creates a k8s Job that runs bun run packages/db/migrate.ts
# inside the app image (which has bun), waits for completion, then deletes the job.
# The DB is only reachable inside the cluster, so migrations must run there.
run_migration_job() {
  local image="$1"
  local namespace="${DEPLOY_NAMESPACE:-calypso-demo}"
  local job_name="calypso-migrate-$(date +%s)"

  log "Creating migration Job ${job_name} in namespace ${namespace}..."
  kubectl apply -f - <<MANIFEST
apiVersion: batch/v1
kind: Job
metadata:
  name: ${job_name}
  namespace: ${namespace}
  labels:
    app: calypso-migrate
spec:
  ttlSecondsAfterFinished: 600
  backoffLimit: 0
  template:
    metadata:
      labels:
        app: calypso-migrate
    spec:
      restartPolicy: Never
      imagePullSecrets:
        - name: ghcr-pull-secret
      containers:
        - name: migrate
          image: ${image}
          command: ["bun", "run", "packages/db/migrate.ts"]
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: calypso-api-secrets
                  key: DATABASE_URL
          resources:
            requests:
              cpu: "50m"
              memory: "128Mi"
            limits:
              cpu: "500m"
              memory: "512Mi"
MANIFEST

  log "Waiting for migration Job to complete (up to $((HEALTH_MAX_RETRIES * HEALTH_RETRY_INTERVAL))s)..."
  if ! kubectl wait "job/${job_name}" \
      --namespace="${namespace}" \
      --for=condition=complete \
      --timeout="${HEALTH_MAX_RETRIES}s"; then
    log "Migration Job failed — fetching logs..."
    kubectl logs --namespace="${namespace}" \
      --selector="app=calypso-migrate" --tail=100 || true
    kubectl delete job "${job_name}" --namespace="${namespace}" --ignore-not-found || true
    return 1
  fi

  log "Migration Job completed successfully."
  kubectl delete job "${job_name}" --namespace="${namespace}" --ignore-not-found || true
}

# wait_for_healthz <url> — polls the given URL until it returns {"status":"ok"}.
wait_for_healthz() {
  local url="$1"
  local attempt=0
  log "Waiting for healthz at ${url} (up to $((HEALTH_MAX_RETRIES * HEALTH_RETRY_INTERVAL))s)..."
  while [[ $attempt -lt $HEALTH_MAX_RETRIES ]]; do
    local response
    response=$(curl -sf --max-time 5 "${url}" 2>/dev/null || true)
    if echo "${response}" | grep -q '"status":"ok"'; then
      log "Healthz OK."
      return 0
    fi
    attempt=$((attempt + 1))
    log "  Not healthy yet (attempt ${attempt}/${HEALTH_MAX_RETRIES}), retrying in ${HEALTH_RETRY_INTERVAL}s..."
    sleep "${HEALTH_RETRY_INTERVAL}"
  done
  return 1
}

# wait_for_pod_ready <deployment> — polls kubectl until all pods in the deployment are Ready.
wait_for_pod_ready() {
  local deployment="$1"
  log "Waiting for pods in ${deployment} to become Ready..."
  kubectl rollout status "deployment/${deployment}" --timeout="${HEALTH_MAX_RETRIES}s"
}

# ---------------------------------------------------------------------------
# Phase 1: DB migrations
# ---------------------------------------------------------------------------

log "=== Phase 1: DB migrations ==="

if ! run_migration_job "${IMAGE}"; then
  die "Migration Job failed — aborting rollout."
fi

log "Phase 1 complete."

# ---------------------------------------------------------------------------
# Phase 2: API server rollout
# ---------------------------------------------------------------------------

log "=== Phase 2: API server rollout ==="

log "Updating ${APP_DEPLOYMENT} deployment to image: ${IMAGE}"
kubectl set image "deployment/${APP_DEPLOYMENT}" "${APP_CONTAINER_NAME}=${IMAGE}"

log "Waiting for API rollout to complete..."
if ! kubectl rollout status "deployment/${APP_DEPLOYMENT}" --timeout="$((HEALTH_MAX_RETRIES * HEALTH_RETRY_INTERVAL))s"; then
  log "Rollout status timed out — triggering rollback..."
  kubectl rollout undo "deployment/${APP_DEPLOYMENT}"
  die "API server rollout failed — rolled back deployment."
fi

log "Verifying API health at ${API_HEALTHZ_URL}..."
if ! wait_for_healthz "${API_HEALTHZ_URL}"; then
  log "API health check failed — triggering rollback..."
  kubectl rollout undo "deployment/${APP_DEPLOYMENT}"
  die "API server did not become healthy — rolled back deployment."
fi

log "Phase 2 complete."

# ---------------------------------------------------------------------------
# Phase 3: Worker rollouts (per agent type, one at a time)
# ---------------------------------------------------------------------------

log "=== Phase 3: Worker rollouts ==="

if [[ -z "${WORKER_TYPES}" ]]; then
  log "No WORKER_TYPES defined — skipping worker phase."
else
  for worker_type in ${WORKER_TYPES}; do
    deployment="worker-${worker_type}"
    log "Updating ${deployment} to image: ${IMAGE}"
    kubectl set image "deployment/${deployment}" "worker=${IMAGE}"

    log "Waiting for ${deployment} rollout to complete..."
    if ! kubectl rollout status "deployment/${deployment}" --timeout="$((HEALTH_MAX_RETRIES * HEALTH_RETRY_INTERVAL))s"; then
      log "Rollout status timed out for ${deployment} — triggering rollback..."
      kubectl rollout undo "deployment/${deployment}"
      die "Worker rollout failed for ${deployment} — rolled back deployment."
    fi

    log "Verifying pod readiness for ${deployment}..."
    if ! wait_for_pod_ready "${deployment}"; then
      log "Pod readiness check failed for ${deployment} — triggering rollback..."
      kubectl rollout undo "deployment/${deployment}"
      die "Worker ${deployment} did not become Ready — rolled back deployment."
    fi

    log "Worker ${deployment} is healthy."
  done
fi

log "Phase 3 complete."

# ---------------------------------------------------------------------------
# Phase 4: Static web assets
# ---------------------------------------------------------------------------

log "=== Phase 4: Static web assets ==="

if [[ -z "${S3_BUCKET:-}" ]]; then
  log "S3_BUCKET not set — skipping static web phase."
else
  STATIC_DIST_PATH="${STATIC_DIST_PATH:-apps/web/dist}"

  if [[ ! -d "${STATIC_DIST_PATH}" ]]; then
    die "Static assets directory not found: ${STATIC_DIST_PATH}"
  fi

  log "Syncing static assets to s3://${S3_BUCKET}/ ..."
  if ! aws s3 sync "${STATIC_DIST_PATH}" "s3://${S3_BUCKET}/" --delete; then
    log "S3 sync failed — attempting to re-sync previous version tag..."
    # Re-sync from a previous tag if available (best-effort recovery)
    PREV_STATIC_DIST="${PREV_STATIC_DIST_PATH:-}"
    if [[ -n "${PREV_STATIC_DIST}" && -d "${PREV_STATIC_DIST}" ]]; then
      log "Re-syncing previous static assets from ${PREV_STATIC_DIST}..."
      aws s3 sync "${PREV_STATIC_DIST}" "s3://${S3_BUCKET}/" --delete || true
    fi
    die "Static web sync failed."
  fi

  if [[ -n "${CDN_DISTRIBUTION:-}" ]]; then
    log "Invalidating CDN distribution ${CDN_DISTRIBUTION}..."
    if ! aws cloudfront create-invalidation \
        --distribution-id "${CDN_DISTRIBUTION}" \
        --paths "/*"; then
      log "WARNING: CDN invalidation failed — clients may see stale assets until TTL expires."
    fi
  fi

  log "Static web assets deployed."
fi

log "Phase 4 complete."

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------

log "Rollout of ${IMAGE} completed successfully."
