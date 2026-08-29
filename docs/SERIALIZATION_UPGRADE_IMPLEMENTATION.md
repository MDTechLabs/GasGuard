# Serialization Upgrade Detection - Implementation Guide

## Quick Start

The serialization upgrade detection system analyzes Soroban contract upgrades to prevent state corruption caused by incompatible serialization changes.

### Location

```
packages/rules/src/stellar/upgradeability/
├── mod.rs                      # Module exports & upgrade checker trait
├── schema_analyzer.rs          # Struct schema extraction & analysis
├── serialization_rules.rs      # Detection rules for incompatibilities
└── tests.rs                    # Integration tests & examples
```

## Features Implemented

### ✅ Incompatible Change Detection

The system detects and warns about:

1. **Field Removal** (Critical)
   - Non-optional fields removed from structs
   - Causes deserialization failures

2. **Type Changes** (Critical)
   - Field types modified incompatibly (u64 → i128)
   - Results in data corruption or deserialization errors

3. **Required Field Addition** (High)
   - New fields added without defaults
   - Existing instances can't be upgraded

4. **Optional to Required** (High)
   - Optional fields became required
   - Existing instances may lack the field

5. **Serde Derive Changes** (High)
   - Serialize/Deserialize derives removed
   - Breaks contract state persistence

### ✅ Safe Pattern Recognition

The system recognizes safe changes:
- Adding optional fields
- Making fields optional
- Adding fields with default values
- Adding fields with serde(default)

## Module Structure

### SchemaAnalyzer

Extracts and analyzes Rust struct definitions:

```rust
use gasguard_rules::stellar::upgradeability::SchemaAnalyzer;

// Extract all struct schemas from source
let schemas = SchemaAnalyzer::extract_schemas(source_code);

// Analyze compatibility
let issues = SchemaAnalyzer::detect_incompatibilities(&old_schema, &new_schema);
```

**Capabilities:**
- Parses `#[derive(...)]` macros
- Detects Serde derives and attributes
- Extracts field types and optional status
- Preserves line numbers for error reporting

### SerializationUpgradeCompatibilityRule

Main rule for checking upgrade compatibility:

```rust
use gasguard_rules::stellar::upgradeability::SerializationUpgradeCompatibilityRule;

let rule = SerializationUpgradeCompatibilityRule::new(old_code);
let violations = rule.check_upgrade(new_code, "contract.rs");
```

**Returns:**
- `RuleViolation` objects with:
  - Severity level
  - Description
  - Suggestion for fix
  - Line/column information

### UnsafeSerializationPatternRule

Pattern-based detection for common mistakes:

```rust
use gasguard_rules::stellar::upgradeability::UnsafeSerializationPatternRule;

let violations = UnsafeSerializationPatternRule::check(source, "contract.rs");
```

**Detects:**
- Removed Serde derives
- Uncommented field removals
- Modified structs without migration functions

### UpgradeCompatibilityChecker Trait

High-level interface for integration:

```rust
use gasguard_rules::stellar::upgradeability::{
    DefaultUpgradeChecker, 
    UpgradeCompatibilityChecker
};

let checker = DefaultUpgradeChecker;

if checker.is_upgrade_safe(old_code, new_code) {
    println!("✅ Safe to upgrade");
} else {
    let issues = checker.get_incompatibilities(old_code, new_code);
    for issue in issues {
        println!("⚠️  {}: {}", issue.issue_type, issue.description);
    }
}
```

## Data Structures

### StructSchema
```rust
pub struct StructSchema {
    pub struct_name: String,
    pub fields: Vec<FieldDef>,
    pub derives: Vec<String>,
    pub has_serde: bool,
    pub line_number: usize,
}
```

### FieldDef
```rust
pub struct FieldDef {
    pub name: String,
    pub type_name: String,
    pub is_optional: bool,
    pub is_vector: bool,
    pub line_number: usize,
}
```

### SerializationIssue
```rust
pub struct SerializationIssue {
    pub issue_type: SerializationIssueType,
    pub struct_name: String,
    pub field_name: Option<String>,
    pub old_type: Option<String>,
    pub new_type: Option<String>,
    pub description: String,
    pub impact: String,
}
```

### SerializationIssueType
```rust
pub enum SerializationIssueType {
    FieldRemoved,
    TypeChanged,
    FieldMadeOptional,
    FieldMadeRequired,
    FieldReordered,
    NewRequiredField,
    DeriveMacroChanged,
    SerdeAttributeChanged,
}
```

## Usage Examples

### Example 1: Pre-Deploy Check

```rust
use gasguard_rules::stellar::upgradeability::SerializationUpgradeCompatibilityRule;

fn check_contract_upgrade(old_path: &str, new_path: &str) -> Result<(), String> {
    let old_code = std::fs::read_to_string(old_path)
        .map_err(|e| e.to_string())?;
    let new_code = std::fs::read_to_string(new_path)
        .map_err(|e| e.to_string())?;
    
    let rule = SerializationUpgradeCompatibilityRule::new(old_code);
    let violations = rule.check_upgrade(&new_code, new_path);
    
    let critical_count = violations
        .iter()
        .filter(|v| matches!(v.severity, ViolationSeverity::Critical))
        .count();
    
    if critical_count > 0 {
        for violation in &violations {
            eprintln!("{}: {}", violation.rule_name, violation.description);
        }
        return Err(format!("Found {} critical issues", critical_count));
    }
    
    Ok(())
}
```

### Example 2: CI/CD Integration

```bash
#!/bin/bash
# Check serialization compatibility

OLD_VERSION="origin/main"
NEW_VERSION="HEAD"

OLD_CODE=$(git show $OLD_VERSION:src/contract.rs)
NEW_CODE=$(cat src/contract.rs)

# Use gasguard CLI (when available)
gasguard check-serialization \
    --old-code="$OLD_CODE" \
    --new-code="$NEW_CODE" \
    --fail-on=critical,high
```

### Example 3: IDE Integration

```rust
// For language server integration
fn get_serialization_diagnostics(file_path: &str, source: &str) -> Vec<Diagnostic> {
    let violations = UnsafeSerializationPatternRule::check(source, file_path);
    
    violations.into_iter().map(|v| Diagnostic {
        range: (v.line_number, v.column_number),
        severity: v.severity,
        message: v.description,
        code: Some(v.rule_name),
        related_information: Some(v.suggestion),
    }).collect()
}
```

## Testing

### Run Tests

```bash
cd packages/rules
cargo test --lib stellar::upgradeability
```

### Test Coverage

The test file (`tests.rs`) includes:
- Schema extraction tests
- Compatibility detection tests
- Pattern matching tests
- Example test cases for each incompatibility type

## Integration with Existing Systems

### With Stellar Linter

Can be integrated into the existing `SorobanLinter`:

```rust
// In packages/rules/src/stellar/linting/mod.rs
pub fn create_linter_with_upgradeability() -> SorobanLinter {
    let mut linter = SorobanLinter::new();
    // Add upgradeability rules
    linter
}
```

### With Rule Engine

Integrates with the main `RuleEngine`:

```rust
use gasquard_rules::stellar::upgradeability::SerializationUpgradeCompatibilityRule;
use gasguard_rules::RuleEngine;

let mut engine = RuleEngine::new();
// Can wrap upgradeability rules as Rule implementations
```

## Severity Levels

- **Critical**: Contract upgrade will fail or corrupt state
- **High**: Upgrade needs manual intervention or migration
- **Medium**: Potential issues, review recommended
- **Low**: Minor compatibility concerns
- **Warning**: Informational, recommend review
- **Info**: Informational only

## Limitations & Caveats

1. **Regex-based parsing**: May not handle all Rust syntax variations
2. **Static analysis only**: No runtime or semantic analysis
3. **Standard Soroban format**: Assumes default serialization
4. **No custom serde logic**: Won't detect custom serialization implementations
5. **Field ordering**: May not detect binary format changes from reordering

## Future Enhancements

- [ ] Semantic version tracking
- [ ] Automatic migration function generation
- [ ] Support for enum variants
- [ ] Cross-contract compatibility
- [ ] Binary diff analysis
- [ ] IDE quick-fix suggestions
- [ ] Contract state migration tool

## Files Modified/Created

### New Files
- `packages/rules/src/stellar/upgradeability/mod.rs`
- `packages/rules/src/stellar/upgradeability/schema_analyzer.rs`
- `packages/rules/src/stellar/upgradeability/serialization_rules.rs`
- `packages/rules/src/stellar/upgradeability/tests.rs`
- `docs/SERIALIZATION_UPGRADE_DETECTION.md`
- `scripts/check_serialization_upgrade.sh`

### Modified Files
- `packages/rules/src/stellar/mod.rs` - Added upgradeability module export

## Acceptance Criteria Verification

✅ **Analyze struct/schema changes**
- SchemaAnalyzer extracts and compares struct definitions
- Detects field additions, removals, type changes

✅ **Warn about incompatible upgrades**
- SerializationUpgradeCompatibilityRule generates warnings
- Multiple severity levels for different incompatibility types

✅ **Unsafe serialization upgrades detected**
- Tests verify detection of:
  - Field removal
  - Type changes
  - Serde derive removal
  - Required field addition
  - Optional to required transitions

## Dependencies

- `regex` (already in Cargo.toml)
- `serde` (already in Cargo.toml)
- Standard library types

No new external dependencies added.

## Performance Considerations

- Regex-based parsing is linear in source code size
- Memory usage proportional to number of structs and fields
- Suitable for real-time IDE integration
- Fast enough for CI/CD pipelines

## Related Documentation

- [SERIALIZATION_UPGRADE_DETECTION.md](../docs/SERIALIZATION_UPGRADE_DETECTION.md) - Detailed feature documentation
- [Soroban Integration](../docs/SOROBAN_INTEGRATION.md) - Contract integration guide
- [State Variable Packing](../docs/STATE_VARIABLE_PACKING.md) - Related state optimization

---

**Last Updated**: June 2, 2026
**Status**: Implemented and tested
**Scope**: `rules/stellar/upgradeability/`
