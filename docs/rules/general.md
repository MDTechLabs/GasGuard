# General Rules

## unused-state-variables

**Rule ID:** `unusedstatevariablesrule`

**Language:** rs

**Category:** general

**Severity:** medium

### Description

Identifies state variables in Soroban contracts that are never read or written to, helping developers minimize storage footprint and ledger rent.

### Implementation

**File:** `packages\rules\src\unused_state_variables.rs`

### Example

#### Before: Contract with unused state variables
```rust
#[contracttype]
pub struct TokenContract {
    pub owner: Address,
    pub total_supply: u64,
    pub balances: soroban_sdk::Map<Address, u64>,
    pub unused_counter: u32,           // This variable is never used
    pub deprecated_feature: bool,      // This variable is never used
    pub future_upgrade_slot: String,   // This variable is never used
}
```

#### After: Contract with unused variables removed
```rust
#[contracttype]
pub struct TokenContract {
    pub owner: Address,
    pub total_supply: u64,
    pub balances: soroban_sdk::Map<Address, u64>,
}
```

### Benefits
- Reduces storage footprint
- Lowers ledger rent costs
- Improves contract readability and maintainability

---

