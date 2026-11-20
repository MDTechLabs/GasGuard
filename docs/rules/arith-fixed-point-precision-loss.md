# Precision loss in chained fixed-point calculations (`arith-fixed-point-precision-loss`)

Issue: #1366 · Detector: `rules/security/math/detect-fixed-point-precision-loss.ts` · Tests: `rules/security/math/__tests__/detect-fixed-point-precision-loss.spec.ts`

## What it detects

Expressions where an integer division is evaluated before a multiplication (`a / b * c`, `(a / b) * c`, `c * (a / b)`) or where two divisions follow each other (`a / WAD / WAD`). The remainder lost by the first division is amplified or compounded. Share pricing, fees, collateral ratios and exchange rates are prioritised through name and scale matching (WAD, RAY, 1e18, 1e27, BPS, 10000, ...).

## Supported inputs

- Solidity 0.8.x source text (checked arithmetic by default). Sources with an older `pragma solidity` are still analyzed but get a warning diagnostic.
- Single file; inheritance, imports and library bodies are not resolved. No compiler settings are read, and no project scripts or configuration are executed.
- Input larger than 2,000,000 characters, empty input, non-string input, unbalanced braces and non-Solidity text are rejected with a diagnostic (`diagnostics[].level === "error" | "info"`) and zero findings; the detector never throws.

## How it decides

Each assignment, declaration, `return` and call argument is tokenized into operands and `+ - * / **` operators (parentheses are groups). Within each additive term, a `*` after a `/` is division-before-multiplication; a second `/` is chained division. Findings add the value-impact path when one exists: returned from a public/external function, stored in state, or reaching a transfer/mint/burn/balance update later in the function.

## Severity and confidence

Medium when a value-impact path exists and the code looks value-related (share/price/fee/ratio names or a known scale); low otherwise. The message says "may be harmless" when no path was found: exploitability is never claimed without a reachable path.

## Assumptions and limitations

- Operator precedence is modelled for `+ - * / **` and parentheses only; shifts and assembly are ignored.
- Operand magnitudes are unknown, so the size of the loss is not quantified.
- Library helpers such as `mulDiv` are treated as safe.
- Division-first orderings chosen to avoid overflow are flagged; review them against the documented precision policy.

## False-positive considerations

Intentional division-first orderings, and divisions by values known to divide evenly (for example a constant that always divides the scaled numerator), are reported. Review the evidence line and the rounding policy.

## Fixtures

Vulnerable:

```solidity
contract Vault {
  uint256 public totalAssets;
  uint256 public totalShares;
  function convertToShares(uint256 assets) external view returns (uint256) {
    return (assets / totalAssets) * totalShares;
  }
}
```

Safe counterexample:

```solidity
contract Vault {
  uint256 public totalAssets;
  uint256 public totalShares;
  function convertToShares(uint256 assets) external view returns (uint256) {
    return (assets * totalShares) / totalAssets;
  }
}
```

Expected normalized finding for the vulnerable fixture (`toNormalizedFindings(result, "Fixture.sol")`):

```json
{
  "ruleId": "arith-fixed-point-precision-loss",
  "message": "In convertToShares(), `(assets / totalAssets) * totalShares`: integer division truncates before a later multiplication, which scales the lost remainder up. Value-impact path: returned by public/external convertToShares().",
  "severity": "medium",
  "location": {
    "file": "Fixture.sol",
    "startLine": 5,
    "endLine": 5
  },
  "suggestedFix": {
    "description": "Reorder to multiply first, e.g. (a * b) / c, or use mulDiv; round in the direction that favors the protocol and document it.",
    "documentationUrl": "https://docs.gasguard.dev/rules/arith-fixed-point-precision-loss"
  },
  "metadata": {
    "title": "Precision loss in chained fixed-point arithmetic",
    "confidence": "medium",
    "function": "convertToShares",
    "evidence": [
      "return (assets / totalAssets) * totalShares",
      "division rounds toward zero (floor for unsigned values)",
      "returned by public/external convertToShares()"
    ],
    "rationale": "The truncated value flows to a place that affects balances or caller-visible results; severity medium for value-related code, low otherwise.",
    "diagnostics": [],
    "limitations": [
      "see LIMITATIONS in the detector module"
    ]
  }
}
```

`metadata` also carries `diagnostics` and `limitations`. Use `toNormalizedFindings` from `rules/security/_shared/solidity-source.ts` to convert a result into the analyzer pipeline's `Finding` shape.

## Verification status

Unit tests (vulnerable, safe, boundary, malformed-input cases) are in `rules/security/math/__tests__/detect-fixed-point-precision-loss.spec.ts`. They have not been run yet, and no benchmark or independent security review has been recorded; both are open items for this rule.
