# Solidity Rules

## Uint8VsUint256Rule

**Rule ID:** `uint8vsuint256rule`

**Language:** solidity

**Category:** solidity

**Severity:** medium

### Description

Using uint8 outside structs is often more gas-expensive than uint256 on EVM chains.

### Implementation

**File:** `packages\rules\src\solidity\uint8_vs_uint256.rs`

### Example

#### Before: Inefficient use of uint8 outside structs
```solidity
// Less efficient - uint8 outside struct
uint8 public counter;

// More efficient within struct (allowed)
struct Point {
    uint8 x;
    uint8 y;
}

// More efficient - using uint256 for storage variables
uint256 public balance;
```

#### After: Improved gas efficiency
```solidity
// More efficient - using uint256 for storage variables
uint256 public counter;

// Still acceptable within structs
struct Point {
    uint8 x;
    uint8 y;
}

// More efficient - using uint256 for storage variables
uint256 public balance;
```

### Gas Savings
- Using uint256 instead of uint8 for storage variables can save up to 20% gas
- The EVM operates on 32-byte words, so smaller types often require extra conversion operations
- Only use uint8/uint16/etc. when they are part of a struct to enable tight packing

