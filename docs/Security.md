# State Variable Packing Detection

## Overview

State Variable Packing is a gas optimization technique in Solidity that groups smaller state variables together to fit multiple variables into a single 32-byte storage slot. This rule detects opportunities where variables can be reorganized or grouped into structs to reduce gas costs.

## Why It Matters

In Solidity, storage is organized into 32-byte slots. Each storage read/write costs gas:
- `SLOAD` (read): 2100 gas (warm), 100 gas (cold)
- `SSTORE` (write): 20000 gas (new), 5000 gas (update)

By packing variables into fewer slots, you can:
- Reduce the number of `SLOAD`/`SSTORE` operations
- Improve gas efficiency of state modifications
- Save deployment gas costs

## Storage Slot Sizes

| Type | Size | Packable |
|------|------|----------|
| `uint8` - `uint248` | 1-31 bytes | ✓ Yes |
| `bool` | 1 byte | ✓ Yes |
| `address` | 20 bytes | ✓ Yes |
| `bytes1` - `bytes31` | 1-31 bytes | ✓ Yes |
| `uint256` / `int256` | 32 bytes | ✗ No |
| `bytes32` | 32 bytes | ✗ No |
| `string` | Dynamic | ✗ No |
| `bytes` | Dynamic | ✗ No |
| Mappings | - | ✗ No |
| Arrays | Dynamic | ✗ No |

## Examples

### Before: Inefficient Storage Layout
```solidity
contract Inefficient {
    uint8 flag1;      // 1 byte  - Slot 0 (31 bytes wasted)
    address user;     // 20 bytes - Slot 1 (12 bytes wasted)
    uint16 count;     // 2 bytes  - Slot 2 (30 bytes wasted)
    bool active;      // 1 byte  - Slot 3 (31 bytes wasted)
    uint256 balance;  // 32 bytes - Slot 4 (required, can't pack)
}
```

**Gas Cost**: Reading all vars requires at least 5 SLOAD operations

### After: Optimized with Packing
```solidity
contract Optimized {
    struct PackedState {
        uint8 flag1;    // 1 byte
        bool active;    // 1 byte
        uint16 count;   // 2 bytes
        address user;   // 20 bytes
        // Total: 24 bytes (can fit in one slot with 8 bytes unused)
    }
    
    PackedState state;   // Slot 0
    uint256 balance;     // Slot 1
}
```

**Gas Cost**: Reading all vars requires only 2 SLOAD operations (50% reduction!)

### Advanced Example: Consecutive Packing
```solidity
contract AdvancedPacking {
    struct Config {
        bool enabled;      // 1 byte
        uint8 version;     // 1 byte
        uint16 maxUsers;   // 2 bytes
        uint32 timeout;    // 4 bytes
        // Total: 8 bytes - can fit 4 such structs in one slot
    }
    
    Config configs[4];    // All fit in 1 slot
    address owner;        // Partial slot
    uint8 status;         // Partial slot
}
```

## Detection Algorithm

The packing detection rule follows these steps:

1. **Type Classification**: Identify all state variables and their sizes
2. **Packability Check**: Determine which types can be packed (exclude dynamic types)
3. **Slot Grouping**: Group consecutive packable variables that fit in 32 bytes
4. **Opportunity Detection**: Report groups of 2+ variables that can be packed together
5. **Suggestion Generation**: Provide struct packing suggestions

### Type Size Calculation
```
uint8 - uint248:  size = bits / 8
bool:             1 byte
address:          20 bytes
bytesN (N=1-32):  N bytes
bytes32:          32 bytes (not packable)
uint256:          32 bytes (not packable)
```

## Rule Details

| Attribute | Value |
|-----------|-------|
| **Rule ID** | `state-variable-packing` |
| **Category** | Optimization / Storage |
| **Severity** | Low |
| **Language** | Solidity |
| **Type** | Gas Optimization |

## Usage

### Programmatic Usage

```rust
use gasguard_rules::{
    VariableInfo,
    detect_packing_opportunities,
    get_type_size,
    is_packable_type,
};

let variables = vec![
    VariableInfo {
        name: "flag".to_string(),
        type_name: "bool".to_string(),
        size_bytes: 1,
        line_number: 5,
    },
    VariableInfo {
        name: "count".to_string(),
        type_name: "uint8".to_string(),
        size_bytes: 1,
        line_number: 6,
    },
];

let opportunities = detect_packing_opportunities(variables);
for opp in opportunities {
    println!("Packing opportunity: {}", opp.suggestion);
}
```

### In Analysis Engine

The rule is automatically integrated into the analysis engine and runs as part of the optimization checks.

## Gas Savings Estimation

### Scenario: Modified Balance
Before packing, modifying a single `uint8` flag requires:
- SLOAD (read current value): 100 gas (warm)
- SSTORE (write new value): 5000 gas (update)
- **Total: 5100 gas**

After packing into a struct slot:
- Reading the struct: Same cost
- But modifying other packed variables happens in same slot
- **Multiple changes per slot: Same base cost**

### Real-world savings across contract lifecycle:
- Initial deployment: ~10-20% reduction in bytecode size
- Per storage operation: Up to 50% fewer opcodes per logical operation
- Contract use: Significant cumulative savings over time

## Best Practices

1. **Group related variables**: Pack variables that are often read/written together
2. **Keep frequently modified vars together**: Reduces slot switches
3. **Order by size (descending)**: Better packing efficiency
4. **Consider struct semantics**: Pack variables that logically belong together
5. **Test before deploying**: Verify packing doesn't break assumptions

## Implementation Details

### Core Functions

#### `get_type_size(type_name: &str) -> usize`
Returns the size in bytes for a given Solidity type.

#### `is_packable_type(type_name: &str) -> bool`
Checks if a type can be packed with other types in a storage slot.

#### `detect_packing_opportunities(variables: Vec<VariableInfo>) -> Vec<PackingOpportunity>`
Main detection function that finds grouping opportunities.

#### `find_consecutive_packable_groups(variables: &[VariableInfo]) -> Vec<Vec<VariableInfo>>`
Groups consecutive variables that can be packed together.

## Limitations & Considerations

1. **Dynamic Types**: Cannot pack strings, arrays, or mappings
2. **Order Sensitivity**: Variable order matters - reordering can break logic
3. **Access Patterns**: Consider how variables are accessed in functions
4. **Inheritance**: Struct packing changes with inheritance hierarchies
5. **Storage Layout**: Be cautious when upgrading contracts with proxy patterns

## Future Enhancements

- [ ] Inter-slot optimization suggestions
- [ ] Cost-benefit analysis for each suggestion
- [ ] Integration with solc storage layout reports
- [ ] Automatic struct generation suggestions
- [ ] Dynamic variable analysis
- [ ] Inheritance-aware packing
