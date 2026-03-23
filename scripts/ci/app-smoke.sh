#!/usr/bin/env bash
# app-smoke.sh — start the bun app server, assert /health returns 200, then stop it.
#
# Runnable locally or from CI.
#
# Required env:
#   DATABASE_URL, AUDIT_DATABASE_URL, ANALYTICS_DATABASE_URL, JWT_SECRET
#
# Optional env:
#   PORT          — port to bind (default: 31415)
#   PF_PID        — PID of a kubectl port-forward to kill on exit (local mode)

set -euo pipefail

PORT="${PORT:-31415}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

cleanup() {
  echo "==> Stopping app server"
  if [[ -n "${APP_PID:-}" ]]; then
    kill -9 "${APP_PID}" 2>/dev/null || true
  fi
  if [[ -n "${PF_PID:-}" ]]; then
    kill -9 "${PF_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# ── Start app server ──────────────────────────────────────────────────────────

echo "==> Start app server (PORT=${PORT})"
ENCRYPTION_DISABLED=true \
PORT="${PORT}" \
  bun run "${REPO_ROOT}/apps/server/src/index.ts" &
APP_PID=$!
echo "    PID=${APP_PID}"

# ── Wait for /health ──────────────────────────────────────────────────────────

echo "==> Waiting for /health"
for i in $(seq 1 20); do
  if curl -sf "http://localhost:${PORT}/health" >/dev/null 2>&1; then
    echo "    healthy after ${i} attempts"
    break
  fi
  if [[ "${i}" -eq 20 ]]; then
    echo "ERROR: app did not become healthy after 20 attempts" >&2
    exit 1
  fi
  echo "    attempt ${i}/20..."
  sleep 2
done

curl -sf "http://localhost:${PORT}/health"
echo ""
echo "==> App smoke test passed."
