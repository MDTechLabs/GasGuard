# Serialization Upgrade Detection - Quick Reference

## Implementation Status: ✅ Complete

Location: `packages/rules/src/stellar/upgradeability/`

## What It Does

Detects unsafe serialization changes during Soroban contract upgrades that could corrupt contract state.

## Core Components

### 1. SchemaAnalyzer
**Purpose**: Extract and analyze struct definitions

```rust
let schemas = SchemaAnalyzer::extract_schemas(source);
let issues = SchemaAnalyzer::detect_incompatibilities(&old, &new);
```

**Detects**:
- Field additions/removals
- Type changes
- Serde derive modifications

### 2. SerializationUpgradeCompatibilityRule
**Purpose**: Perform detailed upgrade compatibility checks

```rust
let rule = SerializationUpgradeCompatibilityRule::new(old_code);
let violations = rule.check_upgrade(new_code, "contract.rs");
```

**Returns**: RuleViolation objects with severity and suggestions

### 3. UnsafeSerializationPatternRule
**Purpose**: Detect dangerous patterns via heuristics

```rust
let violations = UnsafeSerializationPatternRule::check(source, "contract.rs");
```

### 4. DefaultUpgradeChecker
**Purpose**: High-level compatibility interface

```rust
let checker = DefaultUpgradeChecker;
let safe = checker.is_upgrade_safe(old_code, new_code);
let issues = checker.get_incompatibilities(old_code, new_code);
```

## Critical Issues Detected

| Issue | Severity | Example |
|-------|----------|---------|
| Field Removed | Critical | `paused: bool` → removed |
| Type Changed | Critical | `balance: i128` → `u64` |
| Required Field Added | High | New `version: u32` field |
| Serde Derive Removed | High | Lost `#[derive(Serialize)]` |
| Made Required | High | `paused: Option<bool>` → `bool` |

## Safe Patterns Recognized

- ✅ Adding optional fields: `Option<T>`
- ✅ Making field optional: `T` → `Option<T>`
- ✅ Adding with default: `#[serde(default)]`
- ✅ Migration function present: `fn migrate()` detected

## Integration Points

### CI/CD Pipeline
```bash
gasguard check-serialization \
    --old-code previous.rs \
    --new-code current.rs \
    --fail-on critical,high
```

### IDE/Language Server
```rust
let diagnostics = UnsafeSerializationPatternRule::check(source, file_path);
editor.show_diagnostics(diagnostics);
```

### Custom Rules
```rust
let rule = SerializationUpgradeCompatibilityRule::new(old_code);
let violations = rule.check_upgrade(new_code, file_path);
```

## Files in This Module

```
packages/rules/src/stellar/upgradeability/
├── mod.rs                  # Module root, exports, traits
├── schema_analyzer.rs      # Struct parsing & analysis (210 lines)
├── serialization_rules.rs  # Detection rules (240 lines)
└── tests.rs               # Integration tests & examples (150 lines)
```

## Documentation

- **[SERIALIZATION_UPGRADE_DETECTION.md](../docs/SERIALIZATION_UPGRADE_DETECTION.md)** - Complete feature guide
- **[SERIALIZATION_UPGRADE_IMPLEMENTATION.md](../docs/SERIALIZATION_UPGRADE_IMPLEMENTATION.md)** - Implementation details
- **[This file]** - Quick reference

## Test Coverage

```bash
cargo test --lib stellar::upgradeability
```

Includes tests for:
- Schema extraction
- Compatibility detection
- Field removal detection
- Type change detection
- Pattern matching

## Key Methods

### SchemaAnalyzer
```rust
// Extract all structs from source
SchemaAnalyzer::extract_schemas(source: &str) -> Vec<StructSchema>

// Compare old and new schemas
SchemaAnalyzer::detect_incompatibilities(old: &StructSchema, new: &StructSchema) 
    -> Vec<SerializationIssue>
```

### SerializationUpgradeCompatibilityRule
```rust
// Create with old code
SerializationUpgradeCompatibilityRule::new(old_code: String)

// Check upgrade compatibility
check_upgrade(new_code: &str, file_path: &str) -> Vec<RuleViolation>
```

### UnsafeSerializationPatternRule
```rust
// Check for dangerous patterns
UnsafeSerializationPatternRule::check(source: &str, file_path: &str) 
    -> Vec<RuleViolation>
```

## Severity Levels

- **Critical** (🔴): Upgrade will fail or corrupt state
- **High** (🟠): Needs manual migration
- **Medium** (🟡): Review recommended
- **Low** (🔵): Minor concerns
- **Warning** (⚪): Informational
- **Info** (ℹ️): Informational only

## Return Types

### RuleViolation
```rust
pub struct RuleViolation {
    pub rule_name: String,      // "soroban-serialization-compatibility"
    pub description: String,    // What's wrong
    pub severity: ViolationSeverity,  // Critical, High, etc.
    pub line_number: usize,
    pub column_number: usize,
    pub variable_name: String,  // Struct or field name
    pub suggestion: String,     // How to fix
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

## Best Practices

1. **Always** keep Serde derives on persistent structs
2. **Document** why fields are being removed
3. **Implement** migration functions for complex changes
4. **Test** upgrades between versions
5. **Use** `#[serde(default)]` for new optional fields
6. **Version** your contract schemas

## Limitations

- Regex-based parsing (may not catch all Rust syntax)
- Static analysis only (no runtime checks)
- Assumes standard serialization format
- Won't detect custom serde implementations

## No New Dependencies

Uses only already-present dependencies:
- `regex` (1.10)
- `serde` (1.0)

## Next Steps

To use this in your project:
1. Review [SERIALIZATION_UPGRADE_DETECTION.md](../docs/SERIALIZATION_UPGRADE_DETECTION.md)
2. Import from `gasguard_rules::stellar::upgradeability`
3. Run in CI/CD pipeline before deploys
4. Review violations and implement safe upgrade patterns

---

**Scope**: `rules/stellar/upgradeability/`  
**Created**: June 2, 2026  
**Status**: Ready for Integration
