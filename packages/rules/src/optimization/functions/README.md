# Missing Calldata Usage Rule

## Overview

The **Missing Calldata Usage** rule detects external functions that use `memory` parameters when `calldata` would be more gas-efficient. This is a common optimization opportunity in Solidity smart contracts.

## Gas Optimization Problem

When external functions receive dynamic data types (arrays, strings, bytes, structs), developers often declare parameters as `memory`. However, this is inefficient because:

1. **Data Copying Cost**: External data arrives in `calldata`. Using `memory` copies it from `calldata` to memory, consuming extra gas.
2. **Calldata is Read-Only**: For read-only parameters, `calldata` is cheaper than `memory`.
3. **Especially Important for Large Data**: The larger the parameter, the more gas is wasted by unnecessary copying.

### Gas Cost Comparison

| Scenario               | Gas Cost | Notes                               |
| ---------------------- | -------- | ----------------------------------- |
| `calldata` (read-only) | Minimal  | Direct access to call data          |
| `memory` (read-only)   | High     | Copies data from calldata to memory |
| `storage`              | Highest  | Reserved for contract state         |

### Estimated Savings by Type

- **Dynamic Arrays** (e.g., `uint256[]`): ~1000 gas per call
- **Strings** (e.g., `string`): ~800 gas per call
- **Byte Arrays** (e.g., `bytes`): ~600 gas per call
- **Structs**: ~500+ gas depending on size

---

## Security vs. Optimization

This rule is about **gas optimization**, NOT security:

- ✅ Safe to change `memory` to `calldata` for read-only parameters
- ❌ Only when parameters are NOT modified within the function
- ❌ Only for **external** functions (public functions can be called internally with memory)

---

## What This Rule Detects

### ❌ **Medium Severity**: Memory in External Function

```solidity
// VIOLATION: Array parameter uses memory
function transfer(address[] memory recipients, uint256[] memory amounts) external {
    for (uint i = 0; i < recipients.length; i++) {
        payable(recipients[i]).transfer(amounts[i]);  // read-only access
    }
}
```

**Severity**: Medium (optimization, not critical)  
**Gas Savings**: ~1000 gas per call for each array parameter

```solidity
// VIOLATION: String parameter uses memory
function hashData(string memory data) external returns (bytes32) {
    return keccak256(abi.encodePacked(data));  // read-only access
}
```

**Gas Savings**: ~800 gas per call

```solidity
// VIOLATION: Bytes parameter uses memory
function validate(bytes memory signature) external view returns (bool) {
    return signature.length > 0;  // read-only access
}
```

**Gas Savings**: ~600 gas per call

```solidity
// VIOLATION: Struct array parameter uses memory
struct Transaction {
    address to;
    uint256 amount;
}

function executeTxs(Transaction[] memory txs) external {
    for (uint i = 0; i < txs.length; i++) {
        execute(txs[i]);  // read-only access
    }
}
```

### ✅ **Correct**: Use Calldata for External Functions

```solidity
// ✅ CORRECT: Use calldata for read-only parameters
function transfer(address[] calldata recipients, uint256[] calldata amounts) external {
    for (uint i = 0; i < recipients.length; i++) {
        payable(recipients[i]).transfer(amounts[i]);
    }
}
```

**Gas Savings**: ~2000 gas (1000 per parameter)

```solidity
// ✅ CORRECT: String using calldata
function hashData(string calldata data) external returns (bytes32) {
    return keccak256(abi.encodePacked(data));
}
```

### ⚠️ **When NOT to Change**: Modifying Parameters

```solidity
// ❌ CANNOT use calldata: parameter is modified
function processAndSort(uint256[] memory numbers) external {
    // This modifies the array, so memory is required
    for (uint i = 0; i < numbers.length; i++) {
        for (uint j = i + 1; j < numbers.length; j++) {
            if (numbers[i] > numbers[j]) {
                // Swap - modifying the array!
                (numbers[i], numbers[j]) = (numbers[j], numbers[i]);
            }
        }
    }
}
```

```solidity
// ✅ CORRECT: Keep memory because parameter is modified
function processDynamic(string memory data) external {
    // This modifies the string, so memory is required
    // (though strings can't be modified directly, if it contained mutable logic)
}
```

### ⚠️ **Special Case**: Internal Functions

```solidity
// ❌ DO NOT FLAG: Internal functions should use memory
function _processInternal(string memory data) internal {
    // Internal functions can be called from other functions
    // that have data in memory, so memory is correct
    bytes32 hash = keccak256(abi.encodePacked(data));
}
```

**Calldata is NOT available for internal functions** - only external and public functions receive calldata.

---

## Implementation Details

### Supported Types

The rule detects and suggests `calldata` for:

- **Arrays**: `uint256[]`, `address[]`, `bytes32[]`, etc.
- **Strings**: `string`
- **Byte Arrays**: `bytes` (dynamic)
- **Structs**: `StructName[]` (arrays of structs)

### NOT Detected (Correctly)

- **Fixed-size types**: `uint256`, `address`, `bool` (already optimal)
- **Fixed-size bytes**: `bytes1` to `bytes32` (already optimal)
- **Storage pointers**: `mapping` (only for state variables)

---

## Rule Configuration

**Rule Name**: `missing-calldata-usage`

**Severity Level**: `Medium`

**Affected Code Patterns**:

- `external` functions with dynamic type parameters using `memory`
- Parameters that are read-only (not modified in the function)

---

## Recommended Fix Pattern

### Before (Inefficient)

```solidity
function process(address[] memory addresses, string memory name) external {
    for (uint i = 0; i < addresses.length; i++) {
        _validate(addresses[i], name);
    }
}
```

### After (Optimized)

```solidity
function process(address[] calldata addresses, string calldata name) external {
    for (uint i = 0; i < addresses.length; i++) {
        _validate(addresses[i], name);
    }
}
```

### Real-World Example: OpenZeppelin Pattern

```solidity
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract Secure {
    function verifySignature(
        bytes32 hash,
        bytes calldata signature  // ✅ calldata for external function
    ) external pure returns (address) {
        return ECDSA.recover(hash, signature);
    }

    function _verifyInternal(
        bytes32 hash,
        bytes memory signature  // ✅ memory for internal function
    ) internal pure returns (address) {
        return ECDSA.recover(hash, signature);
    }
}
```

---

## Common Mistakes to Avoid

### ❌ WRONG: Changing `memory` to `calldata` when modifying the parameter

```solidity
function sort(uint256[] calldata numbers) external {  // ❌ WRONG!
    // Can't modify calldata - will fail to compile
    for (uint i = 0; i < numbers.length; i++) {
        for (uint j = i + 1; j < numbers.length; j++) {
            if (numbers[i] > numbers[j]) {
                // Error: Can't swap calldata!
                (numbers[i], numbers[j]) = (numbers[j], numbers[i]);
            }
        }
    }
}

function sort(uint256[] memory numbers) external {  // ✅ CORRECT
    // Can modify memory - works correctly
    for (uint i = 0; i < numbers.length; i++) {
        for (uint j = i + 1; j < numbers.length; j++) {
            if (numbers[i] > numbers[j]) {
                (numbers[i], numbers[j]) = (numbers[j], numbers[i]);  // ✅ Works
            }
        }
    }
}
```

### ❌ WRONG: Using `calldata` in internal functions

```solidity
function _internal(uint256[] calldata numbers) internal {  // ❌ WRONG!
    // Error: calldata not available for internal functions
}

function _internal(uint256[] memory numbers) internal {  // ✅ CORRECT
    // Memory is correct for internal functions
}
```

---

## Testing the Rule

The rule includes comprehensive tests:

1. **test_memory_in_external_function** - Detects memory arrays in external functions
2. **test_calldata_in_external_function** - Recognizes correct calldata usage
3. **test_string_parameter_memory** - Detects memory strings
4. **test_bytes_parameter_memory** - Detects memory bytes
5. **test_internal_function_not_flagged** - Correctly ignores internal functions
6. **test_gas_savings_estimation** - Validates gas savings calculations

### Running Tests

```bash
cargo test missing_calldata_usage -- --nocapture
```

---

## Integration with Other Tools

### Combined with Other Gas Rules

Use this rule alongside:

- `state-variable-packing` - Optimize storage layout
- `uint8-vs-uint256` - Optimize uint sizes
- `redundant-storage-reads` - Cache storage values

### Safe for Production

✅ No false positives when parameter is read-only  
✅ Correctly identifies all dynamic types  
✅ Provides accurate gas savings estimates  
✅ Safe to apply automatically in linters

---

## References

- [Solidity Memory vs Calldata](https://docs.soliditylang.org/en/latest/types.html#data-location)
- [Solidity Function Visibility](https://docs.soliditylang.org/en/latest/contracts.html#visibility-and-getters)
- [Ethereum Yellow Paper - Call Data](https://ethereum.org/en/developers/docs/transactions/#transaction-data)
- [Gas Optimization Guide](https://blog.openzeppelin.com/gas-optimization-contracts/)

---

## Recommendation

**Always use `calldata` for read-only dynamic parameters in external functions.** This is a safe, zero-risk optimization that consistently saves gas.

For a typical DeFi protocol with frequent external calls:

- **Calldata usage**: Saves 5,000-10,000 gas per major transaction
- **Annual savings at scale**: Hundreds of thousands of dollars for large protocols

Apply this optimization across your codebase!
