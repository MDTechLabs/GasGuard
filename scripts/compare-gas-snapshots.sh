#!/usr/bin/env bash
# Closes #649: compare forge gas snapshots against the baseline branch.
# Starter script; wiring this into a .github/workflows/gas-diff.yml job is a follow-up
# (requires a token with the `workflow` scope to push CI workflow file changes).
set -euo pipefail

BASELINE_REF="${1:-main}"
SNAPSHOT_FILE=".gas-snapshot"
BASELINE_FILE="$(mktemp)"

git show "${BASELINE_REF}:${SNAPSHOT_FILE}" > "${BASELINE_FILE}" 2>/dev/null || {
  echo "No baseline snapshot found on ${BASELINE_REF}; skipping diff." >&2
  exit 0
}

forge snapshot --check --diff "${BASELINE_FILE}" || true

echo "## Gas Snapshot Diff (vs ${BASELINE_REF})"
echo '```diff'
diff -u "${BASELINE_FILE}" "${SNAPSHOT_FILE}" || true
echo '```'

rm -f "${BASELINE_FILE}"
