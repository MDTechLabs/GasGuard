# Stellar Network Validation Rule

## Overview

The **Network Validation Rule** (`stellar-network-validation`) is a new security rule for GasGuard that detects Soroban contracts lacking network/environment validation. This rule helps prevent contracts from behaving incorrectly when deployed across different Stellar networks (mainnet, testnet, futurenet).

## Problem Statement

Soroban contracts may behave differently or incorrectly across different Stellar networks if they don't validate the network environment. Common issues include:

- **Network-specific addresses**: Addresses generated or used may differ between networks
- **Different network behavior**: Ledger properties, fees, and behaviors vary between networks
- **Deployment errors**: Contracts designed for testnet might accidentally be deployed on mainnet
- **Security vulnerabilities**: Sensitive operations (transfers, mints, burns) should validate the network context

## Implementation

### Location

```
packages/rules/src/stellar/linting/networking/
├── mod.rs                          # Module definition
└── network_validation.rs           # Rule implementation
```

### Rule Details

**Rule ID**: `stellar-network-validation`  
**Name**: Stellar Network Validation  
**Severity**: High (for general missing validation), Medium (for specific functions)

### Detection Capabilities

The rule performs multiple checks:

1. **Environment Usage Without Network Validation**
   - Detects contracts using `Env` without checking `network_passphrase()`
   - Flags contracts that may behave differently across networks

2. **Sensitive Functions Without Network Checks**
   - Identifies critical functions (`transfer`, `withdraw`, `deposit`, `mint`, `burn`, `swap`)
   - Checks if these functions validate the network before execution

3. **Address Generation Without Network Context**
   - Detects `Address::from()` or `Address::generate()` usage
   - Ensures addresses are created with network awareness

4. **Contract Implementation Validation**
   - Checks entire contract implementations for any network validation
   - Provides suggestions for adding proper validation

### Suggested Validation Logic

The rule suggests implementing network validation like:

```rust
// Example: Network validation in a function
pub fn transfer(env: Env, to: Address, amount: u64) {
    // ✅ Validate network
    let network = env.ledger().network_passphrase();

    // Optional: Assert expected network
    // assert!(network.to_bytes() == expected_network_bytes, "Wrong network!");

    // Perform transfer...
}
```

## Usage

### Integration with Linter

The rule is automatically registered in the `SorobanLinter`:

```rust
// In packages/rules/src/stellar/linting/mod.rs
rules.push(Box::new(networking::NetworkValidationRule));
```

### Example Violations

#### ❌ Contract WITHOUT Network Validation

```rust
#[contractimpl]
impl MyContract {
    pub fn transfer(env: Env, to: Address, amount: u64) {
        // No network validation - will trigger rule
    }
}
```

**Violation**:

- Rule: `stellar-network-validation`
- Description: "Function 'transfer' at line X performs sensitive operations without network validation"
- Severity: Medium

#### ✅ Contract WITH Network Validation

```rust
#[contractimpl]
impl MyContract {
    pub fn transfer(env: Env, to: Address, amount: u64) {
        let network = env.ledger().network_passphrase();
        // Network validation present - rule satisfied
    }
}
```

## Testing

The rule includes comprehensive tests covering:

1. **Detection of missing network validation** - Ensures contracts using `Env` are flagged
2. **Recognition of proper validation** - Verifies contracts with network checks pass
3. **Sensitive function detection** - Tests transfer/mint/burn function checks
4. **Address generation validation** - Checks address creation patterns
5. **False positive prevention** - Ensures safe contracts aren't flagged

Run tests:

```bash
cargo test --package gasguard-rules network_validation
```

## Examples

See example contracts demonstrating the rule:

- **Without Validation**: `examples/contract_without_network_validation.rs`
- **With Validation**: `examples/contract_with_network_validation.rs`

## Acceptance Criteria

✅ **Missing network validation flagged** - Contracts lacking network checks are detected  
✅ **Suggestions provided** - Rule suggests appropriate validation logic  
✅ **Multiple detection points** - Checks at contract, function, and operation levels  
✅ **Comprehensive testing** - Unit tests verify all detection scenarios  
✅ **Integration complete** - Rule registered in SorobanLinter

## Network Passphrases

For reference, common Stellar network passphrases:

- **Mainnet**: `"Public Global Stellar Network ; September 2015"`
- **Testnet**: `"Test SDF Network ; September 2015"`
- **Futurenet**: `"Test SDF Future Network ; October 2022"`

## Benefits

1. **Prevents Cross-Network Bugs**: Ensures contracts are aware of their deployment environment
2. **Security Enhancement**: Protects sensitive operations with network context validation
3. **Deployment Safety**: Helps prevent accidental testnet-to-mainnet deployment issues
4. **Best Practices**: Encourages developers to implement network-aware contracts

## Future Enhancements

Potential improvements:

- Network-specific rule configurations
- Custom network passphrase validation
- Integration with deployment pipelines
- Network-dependent gas/fee estimation checks
