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
#   2. API server     — kubectl set image deployment/calypso-api; gate: GET /healthz
#   3. Workers        — kubectl set image per worker type; gate: pod Ready condition
#   4. Static web     — aws s3 sync + CDN invalidation; gate: sync succeeds
#
# Environment variables (required at deploy time):
#   IMAGE_REPO        — container image repository (default: ghcr.io/<owner>/calypso-starter-ts)
#   API_URL           — base URL for the running API server (default: http://calypso-api/healthz)
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
IMAGE_REPO="${IMAGE_REPO:-ghcr.io/<owner>/calypso-starter-ts}"
IMAGE="${IMAGE_REPO}:${IMAGE_TAG}"

# Health gate settings
HEALTH_MAX_RETRIES="${HEALTH_MAX_RETRIES:-30}"
HEALTH_RETRY_INTERVAL="${HEALTH_RETRY_INTERVAL:-2}"

# API health check URL — defaults to in-cluster service address
API_HEALTHZ_URL="${API_URL:-http://calypso-api}/healthz"

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

# wait_for_db_health — polls DATABASE_URL with SELECT 1 up to HEALTH_MAX_RETRIES times.
wait_for_db_health() {
  local attempt=0
  log "Waiting for database health (up to $((HEALTH_MAX_RETRIES * HEALTH_RETRY_INTERVAL))s)..."
  while [[ $attempt -lt $HEALTH_MAX_RETRIES ]]; do
    if psql "${DATABASE_URL}" -c "SELECT 1" --no-align --tuples-only --quiet 2>/dev/null | grep -q "^1$"; then
      log "Database is healthy."
      return 0
    fi
    attempt=$((attempt + 1))
    log "  DB not ready (attempt ${attempt}/${HEALTH_MAX_RETRIES}), retrying in ${HEALTH_RETRY_INTERVAL}s..."
    sleep "${HEALTH_RETRY_INTERVAL}"
  done
  return 1
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

if [[ -z "${DATABASE_URL:-}" ]]; then
  die "DATABASE_URL is not set — cannot run migrations."
fi

log "Running database migrations..."
if ! bun run packages/db/migrate.ts; then
  die "Migration failed — aborting rollout."
fi

log "Verifying database health after migration..."
if ! wait_for_db_health; then
  die "Database did not become healthy after migration — aborting rollout."
fi

log "Phase 1 complete."

# ---------------------------------------------------------------------------
# Phase 2: API server rollout
# ---------------------------------------------------------------------------

log "=== Phase 2: API server rollout ==="

log "Updating calypso-api deployment to image: ${IMAGE}"
kubectl set image "deployment/calypso-api" "app=${IMAGE}"

log "Waiting for API rollout to complete..."
if ! kubectl rollout status deployment/calypso-api --timeout="$((HEALTH_MAX_RETRIES * HEALTH_RETRY_INTERVAL))s"; then
  log "Rollout status timed out — triggering rollback..."
  kubectl rollout undo deployment/calypso-api
  die "API server rollout failed — rolled back deployment."
fi

log "Verifying API health at ${API_HEALTHZ_URL}..."
if ! wait_for_healthz "${API_HEALTHZ_URL}"; then
  log "API health check failed — triggering rollback..."
  kubectl rollout undo deployment/calypso-api
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
