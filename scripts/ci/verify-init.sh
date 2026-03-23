#!/usr/bin/env bash
# verify-init.sh — post-init verification for a calypso deployment.
#
# Verifies that init-host.sh left the cluster and database in a correct state.
# Runnable locally or from CI as a discrete step.
#
# Required env:
#   NAMESPACE           — k8s namespace (e.g. calypso-demo)
#   DB_MODE             — "local" or "remote"
#
# Optional (local mode only):
#   PF_PID              — PID of a running kubectl port-forward to kill on exit
#
# Sets (exported for subsequent steps):
#   DATABASE_URL
#   AUDIT_DATABASE_URL
#   ANALYTICS_DATABASE_URL
#   JWT_SECRET

set -euo pipefail

NAMESPACE="${NAMESPACE:?NAMESPACE is required}"
DB_MODE="${DB_MODE:-local}"

# ── 1. calypso-db-init-secret must be deleted ─────────────────────────────────

echo "==> Verify: calypso-db-init-secret deleted"
if kubectl get secret calypso-db-init-secret --namespace="${NAMESPACE}" 2>/dev/null; then
  echo "ERROR: calypso-db-init-secret still exists!" >&2
  exit 1
fi
echo "    OK — deleted."

# ── 2. No admin credentials in long-lived secrets ─────────────────────────────

echo "==> Verify: no ADMIN_DATABASE_URL in long-lived secrets"
for secret in calypso-api-secrets calypso-db-secrets; do
  if kubectl get secret "${secret}" --namespace="${NAMESPACE}" 2>/dev/null; then
    keys=$(kubectl get secret "${secret}" --namespace="${NAMESPACE}" \
      -o jsonpath='{.data}' 2>/dev/null \
      | python3 -c "import sys,json; d=json.load(sys.stdin); print(' '.join(d.keys()))" \
      || echo "")
    if echo "${keys}" | grep -qi "admin"; then
      echo "ERROR: admin credentials found in ${secret}!" >&2
      exit 1
    fi
  fi
done
echo "    OK — no admin keys present."

# ── 3. Expose local postgres (local mode only) ────────────────────────────────

if [[ "${DB_MODE}" == "local" ]]; then
  echo "==> Expose local postgres via port-forward"
  echo "127.0.0.1 postgres" | sudo tee -a /etc/hosts >/dev/null
  kubectl port-forward svc/postgres 5432:5432 -n "${NAMESPACE}" &
  PF_PID=$!
  export PF_PID
  sleep 3
  echo "    port-forward PID=${PF_PID}"
  [[ -n "${GITHUB_ENV:-}" ]] && echo "PF_PID=${PF_PID}" >> "$GITHUB_ENV" || true
fi

# ── 4. Extract connection URLs ────────────────────────────────────────────────

echo "==> Extract connection URLs from calypso-api-secrets"
DATABASE_URL=$(kubectl get secret calypso-api-secrets -n "${NAMESPACE}" \
  -o jsonpath='{.data.DATABASE_URL}' | base64 -d)
AUDIT_DATABASE_URL=$(kubectl get secret calypso-api-secrets -n "${NAMESPACE}" \
  -o jsonpath='{.data.AUDIT_DATABASE_URL}' | base64 -d)
ANALYTICS_DATABASE_URL=$(kubectl get secret calypso-api-secrets -n "${NAMESPACE}" \
  -o jsonpath='{.data.ANALYTICS_DATABASE_URL}' | base64 -d)
JWT_SECRET=$(kubectl get secret calypso-api-secrets -n "${NAMESPACE}" \
  -o jsonpath='{.data.JWT_SECRET}' | base64 -d)
export DATABASE_URL AUDIT_DATABASE_URL ANALYTICS_DATABASE_URL JWT_SECRET
echo "    DATABASE_URL=${DATABASE_URL//:*@/:***@}"

# Propagate to GitHub Actions env file when running in CI
if [[ -n "${GITHUB_ENV:-}" ]]; then
  {
    echo "DATABASE_URL=${DATABASE_URL}"
    echo "AUDIT_DATABASE_URL=${AUDIT_DATABASE_URL}"
    echo "ANALYTICS_DATABASE_URL=${ANALYTICS_DATABASE_URL}"
    echo "JWT_SECRET=${JWT_SECRET}"
    [[ -n "${PF_PID:-}" ]] && echo "PF_PID=${PF_PID}" || true
  } >> "$GITHUB_ENV"
fi

# ── 5. Run migrate ────────────────────────────────────────────────────────────

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
echo "==> Run migrate()"
DATABASE_URL="${DATABASE_URL}" \
AUDIT_DATABASE_URL="${AUDIT_DATABASE_URL}" \
ANALYTICS_DATABASE_URL="${ANALYTICS_DATABASE_URL}" \
  bun run "${REPO_ROOT}/packages/db/migrate.ts"
echo "    migrate OK"

# ── 6. Verify tables exist ────────────────────────────────────────────────────

echo "==> Verify tables"
docker run --rm --network=host postgres:16-alpine \
  psql "${DATABASE_URL}" -c "\dt" | grep -E "entity_types|entities"
echo "    calypso_app tables OK"

docker run --rm --network=host postgres:16-alpine \
  psql "${AUDIT_DATABASE_URL}" -c "\dt" | grep "audit_log"
echo "    calypso_audit tables OK"

docker run --rm --network=host postgres:16-alpine \
  psql "${ANALYTICS_DATABASE_URL}" -c "\dt" | grep -E "analytics_events|audit_replica"
echo "    calypso_analytics tables OK"

# ── 7. Verify audit_w INSERT grant ───────────────────────────────────────────

echo "==> Verify audit_w INSERT grant"
docker run --rm --network=host postgres:16-alpine \
  psql "${AUDIT_DATABASE_URL}" \
  -c "INSERT INTO audit_log (id, action, entity_type, entity_id, changes)
      VALUES ('ci-verify-$(date +%s)', 'create', 'test', 'test-1', '{}')"
echo "    INSERT OK"

echo ""
echo "==> Verification complete."
