# Unsafe ERC-20 balance-delta calculations (`GG-TOKEN-DELTA-001`)

Detector: `rules/security/tokens/detect-unsafe-balance-delta.ts` · Helper: `rules/security/tokens/token-calls.ts` · Tests: `rules/security/tokens/__tests__/detect-unsafe-balance-delta.spec.ts`

## What it detects

Balance-before / balance-after calculations (the fee-on-transfer-safe way to measure what a transfer delivered) that are computed wrongly. The rule records the token and account of every `balanceOf(account)` read and every subtraction of two reads. Returns the normalized `RuleResult` plus `deltas` (every delta with token, account, form, direction and status `ok` / `intentional` / `flagged`).

| `kind` | Meaning | Severity |
| --- | --- | --- |
| `mismatched-balance-reads` | The two reads use a different token or account. | high |
| `reversed-delta` | Order contradicts the transfer between the reads (inflow needs `after - before`, outflow `before - after`). Direction comes from the visible transfer (confidence high) or the result name such as `received` / `sent` (confidence low). | medium under checked arithmetic, high when unchecked or Solidity < 0.8 |
| `swapped-balance-reads` | Variables named before/after are read in the opposite order. | low |
| `unrelated-balance-change` | The transfer between the reads does not touch the measured account, or several transfers move it. | medium |
| `unchecked-balance-delta` | `after - before` in `unchecked {}` or Solidity < 0.8 with no ordering guard. | low |

## Checked arithmetic and intentional patterns

Under Solidity 0.8 checked arithmetic a reversed delta reverts instead of wrapping, so severity is lower; unchecked blocks and pre-0.8 sources wrap and are rated high. Not reported as reversed: signed deltas (`int256(after) - int256(before)`, `toInt256`, an `int` result) and ternaries that select between both subtraction orders. A ternary using the same subtraction in both branches is not treated as signed or two-sided handling. An unchecked `after - before` is exempt from the wraparound warning only when a preceding `require` or `assert` checks `after >= before`.

## Assumptions and limitations

- Solidity 0.6 – 0.8.x, one source string; compiler settings are not read and no scripts or project configuration are executed.
- Only transfers written in the same function between the two reads are seen; transfers inside called functions are not followed (direction then falls back to naming).
- Token callbacks and other indirect balance changes during an external token call are not modeled; a balance delta may include those effects, and this lexical detector cannot attribute them.
- Reads are matched by the token and account text; aliases of the same address under different names look like a mismatch.
- Malformed, empty or non-Solidity input returns `analyzed: false` with diagnostics.

## Fixtures

Vulnerable (reversed inflow), matching the detector's source-text input:

```solidity
pragma solidity ^0.8.20;
contract Pool {
  IERC20 public token;
  IERC20 public other;
  function deposit(uint256 amount, address recipient) external {
    uint256 before = token.balanceOf(address(this));
    token.safeTransferFrom(msg.sender, address(this), amount);
    uint256 received = before - token.balanceOf(address(this));
  }
}
```

Safe: `uint256 received = token.balanceOf(address(this)) - before;`. More cases (mismatched account/token, unrelated change, swapped reads, unchecked, signed) are in the spec.

For the vulnerable example, the normalized finding includes:

```json
{
  "ruleId": "GG-TOKEN-DELTA-001",
  "kind": "reversed-delta",
  "severity": "medium",
  "confidence": "high",
  "line": 8
}
```

The source location points to the subtraction statement; full findings also include a column, rationale, evidence, and remediation.

## Verification status

Tests were written but not run; no benchmark or independent review has been recorded.
