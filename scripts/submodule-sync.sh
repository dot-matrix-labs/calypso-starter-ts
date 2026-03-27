#!/usr/bin/env bash
# scripts/submodule-sync.sh — Recursively initialise and update all submodules.
#
# Usage:
#   bash scripts/submodule-sync.sh
#
# Exits 0 when every submodule is up to date.
# Exits 1 with a diagnostic message naming the failing submodule on error.
#
# The script is idempotent: running it a second time on an already-synced tree
# produces no output beyond the success message and exits 0.

set -euo pipefail

REPO_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"

echo "Syncing submodules in ${REPO_ROOT} ..."

# Collect the list of registered submodule paths so we can report failures by name.
mapfile -t SUBMODULE_PATHS < <(git -C "${REPO_ROOT}" config --file .gitmodules --get-regexp path | awk '{print $2}')

for path in "${SUBMODULE_PATHS[@]}"; do
  echo "  → ${path}"
  if ! git -C "${REPO_ROOT}" submodule update --init --recursive -- "${path}" 2>&1; then
    echo "ERROR: submodule sync failed for '${path}'" >&2
    exit 1
  fi
done

echo "All submodules are up to date."
