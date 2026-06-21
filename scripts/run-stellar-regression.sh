#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

CONFIG_PATH="tests/regression/security/stellar/regression.config.json"
FIXTURES_DIR="tests/regression/security/stellar/fixtures"

echo "╔══════════════════════════════════════════════════╗"
echo "║   GasGuard Stellar Security Regression Suite    ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

if [ ! -f "$CONFIG_PATH" ]; then
  echo "ERROR: Config not found at $CONFIG_PATH"
  exit 1
fi

RULES=$(jq -c '.rules[]' "$CONFIG_PATH")
RULE_COUNT=$(jq '.rules | length' "$CONFIG_PATH")
echo "Suite: $(jq -r '.suite' "$CONFIG_PATH") v$(jq -r '.version' "$CONFIG_PATH")"
echo "Rules: $RULE_COUNT security rules"
echo ""

TOTAL_PASS=0
TOTAL_FAIL=0
FAILURES=()

while IFS= read -r rule; do
  RULE_NAME=$(echo "$rule" | jq -r '.ruleName')
  CATEGORY=$(echo "$rule" | jq -r '.category')
  FIXTURE_FILE=$(echo "$rule" | jq -r '.fixture')
  FIXTURE_PATH="$FIXTURES_DIR/$FIXTURE_FILE"

  echo "▸ $RULE_NAME ($CATEGORY)"

  if [ ! -f "$FIXTURE_PATH" ]; then
    echo "  ✗ FAIL: Fixture not found: $FIXTURE_PATH"
    TOTAL_FAIL=$((TOTAL_FAIL + 1))
    FAILURES+=("$RULE_NAME")
    continue
  fi

  EXPECTED_VIOLATIONS=$(echo "$rule" | jq -r '.baseline.expectedViolations')
  SAFE_PATTERNS=$(echo "$rule" | jq -r '.baseline.safePatterns')
  echo "  Expected violations : $EXPECTED_VIOLATIONS"
  echo "  Safe patterns       : $SAFE_PATTERNS"
done <<< "$RULES"

echo ""

# Run Jest regression suite
echo "Running Jest regression tests..."
npx jest --testPathPattern 'tests/regression/security/stellar' --verbose 2>&1 || {
  echo "✗ Regression tests failed!" >&2
  exit 1
}

echo ""
if [ "$TOTAL_FAIL" -eq 0 ]; then
  echo "✓ All regression checks passed."
  exit 0
else
  echo "✗ $TOTAL_FAIL regression check(s) FAILED:"
  for f in "${FAILURES[@]}"; do
    echo "  - $f"
  done
  exit 1
fi
