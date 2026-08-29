#!/usr/bin/env bash
#
# Example: Serialization Upgrade Detection in CI/CD Pipeline
#
# This script demonstrates how to use the serialization upgrade detection
# system in a continuous integration pipeline to prevent contract state corruption.

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
PROJECT_DIR="${1:-.}"
OLD_VERSION_REF="${2:-main}"
NEW_VERSION_REF="${3:-HEAD}"

echo "🔍 Serialization Upgrade Compatibility Check"
echo "=============================================="
echo "Old version: $OLD_VERSION_REF"
echo "New version: $NEW_VERSION_REF"
echo ""

# Get old contract code
echo "📦 Fetching old contract code from $OLD_VERSION_REF..."
OLD_CONTRACT=$(git show "$OLD_VERSION_REF:apps/api/src/contract.rs" 2>/dev/null || echo "")

if [ -z "$OLD_CONTRACT" ]; then
    echo -e "${YELLOW}⚠️  Could not find old contract code${NC}"
    OLD_CONTRACT=""
fi

# Get new contract code
echo "📦 Fetching new contract code from $NEW_VERSION_REF..."
NEW_CONTRACT=$(cat "$PROJECT_DIR/apps/api/src/contract.rs" 2>/dev/null || echo "")

if [ -z "$NEW_CONTRACT" ]; then
    echo -e "${RED}❌ Could not find new contract code${NC}"
    exit 1
fi

# Run the compatibility check using gasguard CLI
echo ""
echo "🔬 Analyzing struct changes..."
echo ""

# This is a conceptual example - actual implementation would use:
# 1. A Rust library with the detection logic
# 2. A CLI wrapper for the detection functions
# 3. JSON output for CI integration

cat > /tmp/check_serialization.rs << 'EOF'
// This would be part of the gasguard CLI
use gasguard_rules::stellar::upgradeability::{
    SerializationUpgradeCompatibilityRule,
    UnsafeSerializationPatternRule
};

fn main() {
    let old_code = std::env::var("OLD_CONTRACT").unwrap_or_default();
    let new_code = std::env::var("NEW_CONTRACT").unwrap_or_default();
    
    if old_code.is_empty() {
        println!("ℹ️  No previous version found - first deployment");
        std::process::exit(0);
    }
    
    let rule = SerializationUpgradeCompatibilityRule::new(old_code);
    let violations = rule.check_upgrade(&new_code, "contract.rs");
    
    let pattern_violations = UnsafeSerializationPatternRule::check(&new_code, "contract.rs");
    
    let all_violations = [&violations[..], &pattern_violations[..]].concat();
    
    if all_violations.is_empty() {
        println!("✅ All serialization checks passed!");
        std::process::exit(0);
    }
    
    let mut has_critical = false;
    for violation in all_violations {
        match violation.severity {
            ViolationSeverity::Critical => {
                has_critical = true;
                eprintln!("🔴 CRITICAL: {}", violation.description);
            }
            ViolationSeverity::High => {
                eprintln!("🟠 HIGH: {}", violation.description);
            }
            ViolationSeverity::Medium => {
                eprintln!("🟡 MEDIUM: {}", violation.description);
            }
            _ => {
                println!("ℹ️  {}", violation.description);
            }
        }
        eprintln!("   Suggestion: {}", violation.suggestion);
    }
    
    if has_critical {
        std::process::exit(1);
    } else {
        std::process::exit(0)
    }
}
EOF

echo "Example check completed (conceptual)"
echo ""

# Check for specific unsafe patterns
PATTERNS_FOUND=0

if grep -q "// pub.*:" "$PROJECT_DIR/apps/api/src/contract.rs" 2>/dev/null; then
    echo -e "${YELLOW}⚠️  Warning: Commented-out fields detected${NC}"
    echo "   These may indicate removed fields from the old contract"
    PATTERNS_FOUND=$((PATTERNS_FOUND + 1))
fi

if [ ! -z "$OLD_CONTRACT" ]; then
    OLD_FIELD_COUNT=$(echo "$OLD_CONTRACT" | grep -c "pub.*:" || true)
    NEW_FIELD_COUNT=$(echo "$NEW_CONTRACT" | grep -c "pub.*:" || true)
    
    if [ "$NEW_FIELD_COUNT" -lt "$OLD_FIELD_COUNT" ]; then
        echo -e "${RED}❌ CRITICAL: Fields were removed from the contract struct${NC}"
        echo "   Old field count: $OLD_FIELD_COUNT"
        echo "   New field count: $NEW_FIELD_COUNT"
        PATTERNS_FOUND=$((PATTERNS_FOUND + 1))
    fi
fi

# Summary
echo ""
echo "Summary"
echo "======="
if [ "$PATTERNS_FOUND" -eq 0 ]; then
    echo -e "${GREEN}✅ No compatibility issues detected${NC}"
    exit 0
else
    echo -e "${RED}❌ $PATTERNS_FOUND compatibility issues found${NC}"
    exit 1
fi
