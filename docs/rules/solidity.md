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

## Exact Ether Balance Accounting

**Rule ID:** `sol-019`  
**Severity:** medium  
**Category:** security

Detects `require` or `assert` conditions that directly require
`address(this).balance == <tracked-accounting-variable>`. The compared
identifier must be named like native-asset accounting (for example
`totalDeposits`, `totalLiabilities`, or `accountedBalance`). A forced Ether
transfer can raise the actual balance without updating Solidity state, making
such an exact-equality guard fail. If that guard protects deposits, withdrawals,
or other value-bearing operations, the result can be an availability failure.
Forced Ether is not reported as a vulnerability on its own.

The rule intentionally does not report lower-bound solvency checks such as
`address(this).balance >= totalLiabilities` or explicit surplus reconciliation
using `>` and tracked surplus. A payable deposit that increments the accounting
variable is likewise not a finding by itself.

### Supported input and compiler assumptions

- The rule scans Solidity source text and does not invoke `solc`.
- It accepts source with no version pragma, and pragma versions in Solidity
  `0.4.x` through `0.8.x`; explicit versions outside that range produce an
  analyzer diagnostic. The repository's Foundry configuration currently
  selects Solidity `0.8.20`, optimizer enabled, with 1,000 runs; those settings
  are not read or needed by this source-pattern rule.
- The analyzer recognizes the high-level `address(this).balance` spelling,
  direct equality expressions within `require`/`assert`, and accounting-like
  identifier names. It does not interpret compiler settings, bytecode, inline
  assembly, aliases, inheritance, or cross-file data flow.
- Unbalanced delimiters cause this detector to skip the source and return an
  analyzer diagnostic rather than attempting a partial match.

### Confidence, impact, and false positives

The normalized finding carries the exact source location, confidence evidence,
and an explicit limitation: lexical matching cannot prove that the guard is
reachable or that a revert strands funds. Review the affected call path before
classifying impact. An exact equality inside a harmless view or a deliberate
post-reconciliation assertion may be a false positive; conversely, accounting
variables with generic names and guards implemented indirectly can be missed.

Prefer checks that ensure the raw balance covers recorded liabilities, and
account for or explicitly sweep any surplus. Keep user claims based on recorded
balances rather than assuming forced Ether cannot change `address(this).balance`.

### Reproducible fixture and normalized output

The vulnerable vault, direct payable deposit, forced-Ether sender, and
surplus-aware counterexample are in
`tests/rules/fixtures/sol-019-ether-accounting.json`. The expected normalized
finding is recorded in
`tests/rules/fixtures/sol-019-expected-normalized.json`; the integration test
compares the analyzer result against it.

