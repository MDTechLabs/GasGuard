# Soroban Contract Parser Integration

This document describes the implementation of Soroban contract parsing and analysis capabilities in GasGuard.

## Overview

GasGuard now supports comprehensive static analysis of Soroban smart contracts built on the Stellar network. The implementation includes:

- AST-based parsing of Soroban-specific macros (`#[contract]`, `#[contractimpl]`, `#[contracttype]`)
- Rule-based analysis for gas optimization and security issues
- Integration with existing GasGuard infrastructure

## Key Components

### 1. Soroban AST Structures (`packages/rules/src/soroban/mod.rs`)

Core data structures representing Soroban contract elements:

```rust
pub struct SorobanContract {
    pub name: String,
    pub contract_types: Vec<SorobanStruct>,
    pub implementations: Vec<SorobanImpl>,
    pub source: String,
    pub file_path: String,
}

pub struct SorobanStruct {
    pub name: String,
    pub fields: Vec<SorobanField>,
    pub line_number: usize,
    pub raw_definition: String,
}

pub struct SorobanImpl {
    pub target: String,
    pub functions: Vec<SorobanFunction>,
    pub line_number: usize,
    pub raw_definition: String,
}
```

### 2. Soroban Parser (`packages/rules/src/soroban/parser.rs`)

The parser extracts AST-like structures from Soroban contract source code:

```rust
pub struct SorobanParser;

impl SorobanParser {
    pub fn parse_contract(source: &str, file_path: &str) -> SorobanResult<SorobanContract> {
        // Implementation details...
    }
}
```

Key parsing capabilities:
- Extract contract names from `#[contract]` attributes
- Parse `#[contracttype]` struct definitions
- Parse `#[contractimpl]` implementation blocks
- Extract function signatures and parameters
- Handle visibility modifiers and return types

### 3. Soroban Analyzer (`packages/rules/src/soroban/analyzer.rs`)

Performs static analysis on parsed Soroban contracts:

```rust
pub struct SorobanAnalyzer;

impl SorobanAnalyzer {
    pub fn analyze_contract(contract: &SorobanContract) -> Vec<RuleViolation> {
        // Implementation details...
    }
}
```

Analysis capabilities include:
- Unused state variable detection
- Inefficient storage access patterns
- Unbounded loop detection
- Expensive string operation identification
- Missing error handling detection
- Inefficient integer type usage

### 4. Soroban Rule Engine (`packages/rules/src/soroban/rule_engine.rs`)

Specialized rule engine for Soroban contracts:

```rust
pub struct SorobanRuleEngine {
    rules: HashMap<String, Box<dyn SorobanRule>>,
}

pub trait SorobanRule {
    fn id(&self) -> &str;
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn severity(&self) -> ViolationSeverity;
    fn apply(&self, contract: &SorobanContract) -> Vec<RuleViolation>;
}
```

Built-in rules:
- `UnusedStateVariablesRule` - Detects unused contract state
- `InefficientStorageAccessRule` - Identifies repeated storage operations
- `UnboundedLoopRule` - Flags potentially infinite loops
- `ExpensiveStringOperationsRule` - Detects costly string operations
- `MissingConstructorRule` - Ensures proper contract initialization
- `AdminPatternRule` - Suggests access control patterns
- `InefficientIntegerTypesRule` - Recommends optimal integer sizes
- `MissingErrorHandlingRule` - Enforces proper error handling

### 5. Contract Scanner Integration (`libs/engine/src/scanner.rs`)

Extended to support Soroban contract detection and analysis:

```rust
pub enum Language {
    Rust,
    Vyper,
    Soroban, // Added support
}

impl Language {
    pub fn from_content(content: &str) -> Option<Self> {
        // Detect Soroban contracts by looking for soroban_sdk imports
        // and Soroban-specific macros
    }
}
```

### 6. TypeScript Validation Updates (`apps/api/src/validation/analysis.validator.ts`)

Updated to recognize 'soroban' as a supported language:

```typescript
private static readonly SUPPORTED_LANGUAGES = ['rust', 'typescript', 'javascript', 'solidity', 'soroban'];
```

### 7. Rust Analyzer Enhancements (`libs/engine/analyzers/rust-analyzer.ts`)

Extended to handle Soroban contract patterns specifically:

```typescript
supportsLanguage(language: Language | string): boolean {
    return language === Language.RUST || 
           language === Language.SOROBAN || 
           language === 'rust' || 
           language === 'rs' || 
           language === 'soroban';
}
```

## Usage Examples

### Basic Soroban Contract Analysis

```rust
use gasguard_rules::{SorobanParser, SorobanAnalyzer};

let contract_code = r#"
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

#[contracttype]
pub struct TokenContract {
    pub admin: Address,
    pub total_supply: u64,
    pub balances: Map<Address, u64>,
}

#[contractimpl]
impl TokenContract {
    pub fn new(admin: Address, initial_supply: u64) -> Self {
        // Implementation
    }
    
    pub fn transfer(from: Address, to: Address, amount: u64) {
        // Implementation
    }
}
"#;

// Parse the contract
let contract = SorobanParser::parse_contract(contract_code, "token.rs")?;

// Analyze for issues
let violations = SorobanAnalyzer::analyze_contract(&contract);

for violation in violations {
    println!("Issue: {} at line {}", violation.description, violation.line_number);
}
```

### Using the Rule Engine

```rust
use gasguard_rules::SorobanRuleEngine;

let engine = SorobanRuleEngine::with_default_rules();
let violations = engine.analyze(contract_code, "contract.rs")?;

println!("Found {} issues", violations.len());
```

### Integration with Contract Scanner

```rust
use gasguard_engine::ContractScanner;

let scanner = ContractScanner::new();

// Automatic language detection
let result = scanner.scan_content(contract_code, "my_contract.rs".to_string())?;

// Or direct Soroban analysis
let soroban_result = scanner.scan_soroban_content(contract_code, "my_contract.rs".to_string())?;
```

## Detected Issues and Recommendations

The Soroban analyzer detects various issues with specific recommendations:

### 1. Unused State Variables
**Detection**: Variables declared in contract structs but never referenced in functions
**Recommendation**: Remove unused variables to save ledger storage costs

### 2. Inefficient Storage Access
**Detection**: Multiple reads/writes to the same storage key without caching
**Recommendation**: Cache storage values in local variables

### 3. Unbounded Loops
**Detection**: Loops without clear termination conditions
**Recommendation**: Add bounds checking or use pagination patterns

### 4. Expensive String Operations
**Detection**: Frequent `.to_string()` or `String::from()` calls
**Recommendation**: Use `Symbol` or `Bytes` for fixed data when possible

### 5. Missing Error Handling
**Detection**: State-modifying functions that don't return `Result`
**Recommendation**: Return `Result<(), Error>` for proper error propagation

### 6. Inefficient Integer Types
**Detection**: Use of `u128`/`i128` when smaller types would suffice
**Recommendation**: Use appropriate integer sizes (`u64`, `u32`, etc.)

## Testing

Comprehensive tests are included in:
- `tests/integration_tests.rs` - End-to-end integration tests
- `packages/rules/src/soroban/tests.rs` - Unit tests for parsing and analysis

Run tests with:
```bash
cargo test
```

## API Integration

The TypeScript API now accepts 'soroban' as a language parameter:

```typescript
const response = await fetch('/api/analyze', {
    method: 'POST',
    body: JSON.stringify({
        code: sorobanContractCode,
        filePath: 'contract.rs',
        language: 'soroban'
    })
});
```

## Future Enhancements

Planned improvements:
- More sophisticated AST parsing using `syn` crate
- Cross-function analysis for better unused variable detection
- Integration with Soroban SDK documentation
- Performance optimization rules specific to Stellar's fee model
- Custom rule configuration for different project requirements

## Contributing

To add new Soroban-specific rules:
1. Implement a struct that implements the `SorobanRule` trait
2. Add it to the `SorobanRuleEngine::add_default_rules()` method
3. Include comprehensive tests
4. Update documentation

The modular design makes it easy to extend with new analysis capabilities while maintaining compatibility with the existing GasGuard ecosystem.