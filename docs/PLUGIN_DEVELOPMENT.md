# Plugin Development Guide

## Quick Start

### 1. Create Plugin Project

```bash
cargo new gasguard-my-plugin --lib
cd gasguard-my-plugin
```

### 2. Configure Cargo.toml

```toml
[package]
name = "gasguard-my-plugin"
version = "1.0.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
gasguard-ast = { path = "../gasguard/libs/ast" }
gasguard-rule-engine = { path = "../gasguard/libs/rule-engine" }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
```

### 3. Implement Library

`src/lib.rs`:

```rust
use gasguard_ast::UnifiedAST;
use gasguard_rule_engine::{Rule, RuleViolation, RuleOutput};
use serde_json::json;

#[no_mangle]
pub extern "C" fn create_rule() -> *mut dyn Rule {
    Box::into_raw(Box::new(MyRule))
}

struct MyRule;

impl Rule for MyRule {
    fn id(&self) -> &str {
        "my-gas-optimization"
    }

    fn name(&self) -> &str {
        "My Gas Optimization"
    }

    fn description(&self) -> &str {
        "Detects inefficient patterns in smart contracts"
    }

    fn check(&self, ast: &UnifiedAST) -> Vec<RuleViolation> {
        let mut violations = Vec::new();

        // Implement your analysis logic here
        // Example: check for inefficient loops
        if let Some(functions) = &ast.functions {
            for func in functions {
                if self.has_inefficient_loop(func) {
                    violations.push(RuleViolation {
                        rule_name: self.name().to_string(),
                        description: "Inefficient loop detected".to_string(),
                        severity: ViolationSeverity::High,
                        line_number: func.line,
                        column_number: func.column,
                        variable_name: func.name.clone(),
                        suggestion: "Cache array length in local variable".to_string(),
                    });
                }
            }
        }

        violations
    }

    fn generate_output(&self, violations: &[RuleViolation]) -> RuleOutput {
        RuleOutput {
            rule_id: self.id().to_string(),
            rule_name: self.name().to_string(),
            data: json!({
                "violations_count": violations.len(),
                "violations": violations,
                "analyzed_timestamp": chrono::Utc::now().to_rfc3339(),
            }),
        }
    }
}

impl MyRule {
    fn has_inefficient_loop(&self, func: &Function) -> bool {
        // Your analysis logic
        false
    }
}
```

### 4. Create plugin.json

```json
{
  "id": "my-gas-optimization",
  "name": "My Gas Optimization",
  "version": "1.0.0",
  "description": "Detects inefficient patterns",
  "languages": ["solidity", "rust"],
  "capabilities": ["gas-optimization"],
  "main": "dist/libgasguard_my_plugin.so",
  "gasguardVersion": {
    "min": "1.0.0"
  },
  "author": {
    "name": "Your Name",
    "email": "you@example.com"
  },
  "license": "MIT",
  "status": "stable"
}
```

### 5. Build and Test

```bash
# Build
cargo build --release

# Create dist directory
mkdir -p dist
cp target/release/libgasguard_my_plugin.so dist/

# Validate manifest
gasguard plugin validate plugin.json
```

## Plugin Architecture

### Core Interfaces

#### Rule Trait

Every plugin must implement the `Rule` trait:

```rust
pub trait Rule: Send + Sync {
    fn id(&self) -> &str;
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn check(&self, ast: &UnifiedAST) -> Vec<RuleViolation>;
    
    // Optional
    fn dependencies(&self) -> Vec<String> { Vec::new() }
    fn check_with_context(
        &self,
        ast: &UnifiedAST,
        context: &HashMap<String, RuleOutput>,
    ) -> Vec<RuleViolation> {
        self.check(ast)
    }
    fn generate_output(&self, violations: &[RuleViolation]) -> RuleOutput { /* ... */ }
}
```

#### RuleViolation

Represents a single finding:

```rust
#[derive(Clone, Serialize, Deserialize)]
pub struct RuleViolation {
    pub rule_name: String,
    pub description: String,
    pub severity: ViolationSeverity,
    pub line_number: usize,
    pub column_number: usize,
    pub variable_name: String,
    pub suggestion: String,
}
```

### Creating Multiple Rules

Often plugins provide multiple related rules:

```rust
#[no_mangle]
pub extern "C" fn create_rule() -> *mut dyn Rule {
    // Return different rules based on environment or config
    Box::into_raw(Box::new(MyRule))
}

pub struct LoopOptimizationRule;
pub struct CacheOptimizationRule;
pub struct RedundantComputationRule;

impl Rule for LoopOptimizationRule { /* ... */ }
impl Rule for CacheOptimizationRule { /* ... */ }
impl Rule for RedundantComputationRule { /* ... */ }
```

### Working with AST

The `UnifiedAST` contains parsed code structure:

```rust
pub struct UnifiedAST {
    pub functions: Vec<Function>,
    pub contracts: Vec<Contract>,
    pub variables: Vec<Variable>,
    pub calls: Vec<FunctionCall>,
    // ... other fields
}
```

Example: Analyzing function calls

```rust
fn analyze_function_calls(&self, ast: &UnifiedAST) -> Vec<RuleViolation> {
    let mut violations = Vec::new();

    for call in &ast.calls {
        // Check for expensive operations in loops
        if call.in_loop && is_expensive_operation(&call.name) {
            violations.push(RuleViolation {
                rule_name: self.name().to_string(),
                description: format!(
                    "Expensive operation '{}' in loop",
                    call.name
                ),
                severity: ViolationSeverity::High,
                line_number: call.line,
                column_number: call.column,
                variable_name: call.name.clone(),
                suggestion: "Move operation outside loop".to_string(),
            });
        }
    }

    violations
}
```

## Advanced Features

### Rule Dependencies

Use outputs from other rules in your analysis:

```rust
impl Rule for ContextualRule {
    fn dependencies(&self) -> Vec<String> {
        vec!["prior-analysis-rule".to_string()]
    }

    fn check_with_context(
        &self,
        ast: &UnifiedAST,
        context: &HashMap<String, RuleOutput>,
    ) -> Vec<RuleViolation> {
        // Get output from prior rule
        if let Some(prior_output) = context.get("prior-analysis-rule") {
            // Use prior analysis results
            self.analyze_with_context(ast, &prior_output.data)
        } else {
            // Fallback if prior rule didn't run
            self.check(ast)
        }
    }
}
```

### Configuration Handling

Support plugin configuration:

```rust
impl Rule for ConfigurableRule {
    fn check(&self, ast: &UnifiedAST) -> Vec<RuleViolation> {
        // Read from default config or from manifest
        let config = self.load_config();
        
        if config.get("enable_advanced") == Some(&true) {
            self.analyze_advanced(ast)
        } else {
            self.analyze_basic(ast)
        }
    }
}
```

### Performance Optimization

```rust
impl Rule for PerformantRule {
    fn check(&self, ast: &UnifiedAST) -> Vec<RuleViolation> {
        let mut violations = Vec::new();

        // Use iterators instead of collecting
        let expensive_ops: Vec<_> = ast
            .calls
            .iter()
            .filter(|call| is_expensive(call))
            .collect();

        // Early exit if no issues
        if expensive_ops.is_empty() {
            return violations;
        }

        // Process only relevant items
        for call in expensive_ops {
            violations.push(/* ... */);
        }

        violations
    }
}
```

## Testing Your Plugin

### Unit Tests

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detects_loop_optimization() {
        let rule = LoopOptimizationRule;
        let ast = create_test_ast();
        
        let violations = rule.check(&ast);
        
        assert!(!violations.is_empty());
        assert_eq!(violations[0].rule_name, "Loop Optimization");
    }
}
```

### Integration Testing

```bash
# Create test contract
cat > test.sol << 'EOF'
contract Test {
    function inefficient() {
        for (uint i = 0; i < array.length; i++) {
            // loop body
        }
    }
}
EOF

# Run plugin on test
gasguard analyze --plugin dist/plugin.so test.sol
```

## Publishing Your Plugin

### Step 1: Prepare Release

```bash
# Update version in plugin.json
# Update CHANGELOG.md
# Build release binary
cargo build --release

# Create checksums
sha256sum target/release/libgasguard_my_plugin.so > dist/checksums.txt
```

### Step 2: Create Release on GitHub

```bash
# Create git tag
git tag v1.0.0

# Create release
gh release create v1.0.0 \
  --title "My Plugin v1.0.0" \
  --notes-file CHANGELOG.md \
  dist/libgasguard_my_plugin.so \
  dist/checksums.txt
```

### Step 3: Publish to Registry

```bash
# Validate
gasguard plugin validate plugin.json

# Publish
gasguard plugin publish --token YOUR_TOKEN
```

## Example: Complete Gas Optimization Plugin

```rust
use gasguard_ast::UnifiedAST;
use gasguard_rule_engine::{Rule, RuleViolation, ViolationSeverity};

pub struct StorageOptimizationRule;

impl Rule for StorageOptimizationRule {
    fn id(&self) -> &str {
        "storage-optimization"
    }

    fn name(&self) -> &str {
        "Storage Optimization"
    }

    fn description(&self) -> &str {
        "Detects inefficient storage usage patterns"
    }

    fn check(&self, ast: &UnifiedAST) -> Vec<RuleViolation> {
        let mut violations = Vec::new();

        // Check for string usage that could be bytes32
        for var in &ast.variables {
            if var.type_name == "string" && var.is_constant {
                violations.push(RuleViolation {
                    rule_name: self.name().to_string(),
                    description: "Use bytes32 instead of string for constants"
                        .to_string(),
                    severity: ViolationSeverity::Medium,
                    line_number: var.line,
                    column_number: var.column,
                    variable_name: var.name.clone(),
                    suggestion: format!(
                        "Consider using bytes32 for constant: {}",
                        var.name
                    ),
                });
            }
        }

        violations
    }
}

#[no_mangle]
pub extern "C" fn create_rule() -> *mut dyn Rule {
    Box::into_raw(Box::new(StorageOptimizationRule))
}
```

## Debugging

### Enable Verbose Output

```bash
# Run with debug output
RUST_LOG=debug gasguard analyze --plugin dist/plugin.so contract.sol
```

### Use Logging in Your Rule

```rust
fn check(&self, ast: &UnifiedAST) -> Vec<RuleViolation> {
    eprintln!("Analyzing AST with {} functions", ast.functions.len());
    
    // Your code
}
```

## Common Patterns

### Safe Error Handling

```rust
fn analyze_safely(&self, ast: &UnifiedAST) -> Vec<RuleViolation> {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        self.check(ast)
    })) {
        Ok(violations) => violations,
        Err(_) => {
            eprintln!("Plugin crashed during analysis");
            Vec::new()
        }
    }
}
```

### Caching Results

```rust
use std::collections::HashMap;

struct CachingRule {
    cache: std::sync::Mutex<HashMap<String, Vec<RuleViolation>>>,
}

impl Rule for CachingRule {
    fn check(&self, ast: &UnifiedAST) -> Vec<RuleViolation> {
        let key = format!("{:?}", ast); // Simple cache key
        
        if let Ok(cache) = self.cache.lock() {
            if let Some(cached) = cache.get(&key) {
                return cached.clone();
            }
        }

        let result = self.analyze(ast);
        // Cache result...
        result
    }
}
```

## Best Practices

1. **Keep rules focused**: One rule should check one type of issue
2. **Provide actionable suggestions**: Help users fix problems
3. **Minimize false positives**: Be conservative with what you report
4. **Document your rules**: Include examples in README
5. **Version carefully**: Follow semantic versioning
6. **Test thoroughly**: Unit tests and integration tests
7. **Handle errors gracefully**: Don't panic
8. **Performance matters**: Analyze efficiently

## Resources

- [Rust Book](https://doc.rust-lang.org/book/)
- [GasGuard AST Documentation](../docs/IMPLEMENTATION_SUMMARY.md)
- [Plugin Examples](../examples/plugins/)
- [Community Plugins](https://plugins.gasguard.dev)
