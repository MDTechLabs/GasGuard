# Serialization Upgrade Compatibility Detection

## Overview

This system detects incompatible serialization changes during Soroban contract upgrades. Serialization mismatches can corrupt contract state, making this critical for safe upgrades.

## Problem Statement

When upgrading Soroban contracts, changes to struct definitions (especially those marked with `#[contracttype]`) can cause deserialization failures or state corruption:

- **Removing fields**: Existing persisted state can't be deserialized
- **Changing field types**: Data gets misinterpreted 
- **Adding required fields**: Existing instances lack the new field
- **Modifying Serde derives**: Serialization format changes incompatibly

## Solution Architecture

### 1. Schema Analysis (`schema_analyzer.rs`)

Extracts and analyzes struct definitions from Rust source code:

```rust
// Extract schemas from source
let schemas = SchemaAnalyzer::extract_schemas(source);

// Analyze field types and Serde configuration
let issues = SchemaAnalyzer::detect_incompatibilities(&old_schema, &new_schema);
```

**Key Features:**
- Parses struct definitions with regex patterns
- Extracts field names, types, and optional status
- Detects Serde derive macros and attributes
- Preserves line number information for reporting

**Detectable Changes:**
- Field removal/addition
- Type changes
- Optional/required transitions
- Derive macro changes

### 2. Serialization Rules (`serialization_rules.rs`)

Two main rule implementations:

#### A. `SerializationUpgradeCompatibilityRule`

Performs detailed comparison of old vs new contract code:

```rust
let rule = SerializationUpgradeCompatibilityRule::new(old_code);
let violations = rule.check_upgrade(new_code, "contract.rs");
```

**Detects:**
- Field removals → Critical severity
- Type changes → Critical severity  
- Required field additions → High severity
- Serde derive changes → High severity

**Suggests Fixes:**
- Use `#[serde(default)]` for new fields
- Implement custom deserialization
- Add migration functions

#### B. `UnsafeSerializationPatternRule`

Detects dangerous patterns through pattern matching:

```rust
let violations = UnsafeSerializationPatternRule::check(source, "contract.rs");
```

**Detects:**
- Removed Serde derives without migration
- Uncommented field removals
- Struct modifications without migration functions

### 3. Upgrade Checker Trait

Provides high-level interface for compatibility checking:

```rust
pub trait UpgradeCompatibilityChecker {
    fn is_upgrade_safe(&self, old_code: &str, new_code: &str) -> bool;
    fn get_incompatibilities(&self, old_code: &str, new_code: &str) 
        -> Vec<SerializationIssue>;
}
```

## Incompatibility Types

### 1. FieldRemoved (Critical)

```rust
// OLD
pub struct State {
    pub balance: u64,
    pub paused: bool,
}

// NEW - UNSAFE!
pub struct State {
    pub balance: u64,
    // paused removed
}
```

**Impact:** Deserialization fails for existing contracts
**Fix:** Keep field, make optional, or implement migration

### 2. TypeChanged (Critical)

```rust
// OLD
pub balance: i128

// NEW - UNSAFE!
pub balance: u64
```

**Impact:** Data misinterpreted or deserialization fails
**Fix:** Implement custom deserialization or migration

### 3. NewRequiredField (High)

```rust
// OLD
pub struct State {
    pub balance: u64,
}

// NEW - UNSAFE!
pub struct State {
    pub balance: u64,
    pub version: u32,  // No default
}
```

**Impact:** Existing instances can't provide the new field
**Fix:** Make optional or provide default via `#[serde(default)]`

### 4. FieldMadeRequired (High)

```rust
// OLD
pub paused: Option<bool>

// NEW - UNSAFE!
pub paused: bool
```

**Impact:** Existing instances may lack the field
**Fix:** Add migration logic or keep optional

### 5. DeriveMacroChanged (High)

```rust
// OLD
#[derive(Serialize, Deserialize)]

// NEW - UNSAFE!
#[derive(Debug)]
```

**Impact:** Can't deserialize persisted state
**Fix:** Keep Serde derives or implement custom serialization

## Safe Upgrade Patterns

### ✅ Safe: Adding Optional Field

```rust
// OLD
pub struct State {
    pub balance: u64,
}

// NEW - SAFE
pub struct State {
    pub balance: u64,
    pub last_updated: Option<u64>,  // Optional
}
```

Existing data deserializes with `last_updated = None`

### ✅ Safe: Making Field Optional

```rust
// OLD
pub paused: bool

// NEW - SAFE
pub paused: Option<bool>
```

Existing data deserializes with `paused = None` if missing

### ✅ Safe: Adding Field with Default

```rust
// NEW
#[serde(default)]
pub version: u32,
```

Existing data uses the default value

### ✅ Safe: Using Version Markers

```rust
pub struct State {
    pub balance: u64,
    pub version: u64,  // Tracks schema version
}

pub fn migrate_from_v1_to_v2(old: StateV1) -> StateV2 {
    StateV2 {
        balance: old.balance,
        new_field: calculate_default(),
        version: 2,
    }
}
```

## Usage Examples

### Example 1: Simple Safety Check

```rust
use gasguard_rules::stellar::upgradeability::{
    SchemaAnalyzer, SerializationUpgradeCompatibilityRule
};

let old_code = r#"
#[derive(Serialize, Deserialize)]
pub struct State {
    pub balance: u64,
}
"#;

let new_code = r#"
#[derive(Serialize, Deserialize)]
pub struct State {
    pub balance: u64,
    pub owner: String,  // New required field
}
"#;

let rule = SerializationUpgradeCompatibilityRule::new(old_code.to_string());
let violations = rule.check_upgrade(new_code, "contract.rs");

for violation in violations {
    println!("Incompatibility: {}", violation.description);
    println!("Fix: {}", violation.suggestion);
}
```

### Example 2: Detailed Analysis

```rust
use gasguard_rules::stellar::upgradeability::{
    DefaultUpgradeChecker, UpgradeCompatibilityChecker
};

let checker = DefaultUpgradeChecker;
let incompatibilities = checker.get_incompatibilities(old_code, new_code);

if incompatibilities.is_empty() {
    println!("✅ Upgrade is safe");
} else {
    println!("⚠️ Unsafe incompatibilities detected:");
    for issue in incompatibilities {
        println!("  - {}: {}", issue.issue_type, issue.description);
    }
}
```

### Example 3: Pattern Checking

```rust
use gasguard_rules::stellar::upgradeability::UnsafeSerializationPatternRule;

let violations = UnsafeSerializationPatternRule::check(source, "contract.rs");

for violation in violations {
    eprintln!("{}[{}]: {}", 
        violation.rule_name,
        violation.severity,
        violation.description
    );
}
```

## Integration Points

### With CI/CD Pipeline

```yaml
# Example: GitHub Actions check
- name: Check Serialization Compatibility
  run: |
    gasguard check-upgrade \
      --old-code previous_release/contract.rs \
      --new-code src/contract.rs \
      --fail-on critical,high
```

### With Development Tools

```rust
// IDE/Editor integration
let violations = SerializationUpgradeCompatibilityRule::new(old_code)
    .check_upgrade(new_code, file_path);

for violation in violations {
    // Show as linting warning/error
    editor.show_diagnostic(
        file_path,
        violation.line_number,
        violation.description,
        violation.severity,
    );
}
```

## Configuration Options

### Severity Thresholds

- **Critical**: Contract will fail to upgrade
- **High**: Upgrade needs manual migration
- **Medium**: Potential issues, review recommended
- **Low**: Minor compatibility concerns

### Custom Rules

Extend with additional checks:

```rust
pub struct CustomSerializationRule;

impl CustomRule for CustomSerializationRule {
    fn check(&self, old: &StructSchema, new: &StructSchema) -> Vec<SerializationIssue> {
        // Custom logic
    }
}
```

## Best Practices

1. **Version Your Schemas**
   ```rust
   pub const SCHEMA_VERSION: u64 = 1;
   ```

2. **Document Breaking Changes**
   ```rust
   /// BREAKING: Removed deprecated_field (v2)
   /// Use migration function to upgrade
   ```

3. **Implement Migration Functions**
   ```rust
   pub fn migrate_v1_to_v2(state: StateV1) -> StateV2 {
       // Safe conversion logic
   }
   ```

4. **Test Upgrades**
   ```rust
   #[test]
   fn test_upgrade_from_previous_version() {
       let old_state = create_old_state();
       let migrated = migrate_v1_to_v2(old_state);
       assert!(validate_new_state(&migrated));
   }
   ```

5. **Keep Serde Derives**
   ```rust
   #[derive(Serialize, Deserialize)]  // Always keep for persistent state
   pub struct PersistentState {
       // ...
   }
   ```

## Limitations & Caveats

- **Regex-based parsing**: May not catch all complex Rust syntax
- **Binary format assumptions**: Assumes Soroban's standard serialization format
- **No runtime analysis**: Static analysis only
- **Custom serialization**: Won't detect issues with custom `serde` implementations

## Testing the Implementation

Run tests with:

```bash
cd packages/rules
cargo test --lib stellar::upgradeability
```

## Related Documentation

- [Soroban Contract Development](../docs/SOROBAN_INTEGRATION.md)
- [Contract Health Check System](../docs/CONTRACT_HEALTH_CHECK_SYSTEM.md)
- [State Variable Packing](../docs/STATE_VARIABLE_PACKING.md)

## Future Enhancements

- [ ] Semantic version detection and enforcement
- [ ] Automatic migration function generation
- [ ] Support for enum variants
- [ ] Cross-contract compatibility checking
- [ ] Binary format diffing tool
