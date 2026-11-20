# Division-by-zero paths in configurable financial parameters (`arith-division-by-zero`)

Issue: #1369 · Detector: `rules/security/math/detect-division-by-zero-paths.ts` · Tests: `rules/security/math/__tests__/detect-division-by-zero-paths.spec.ts`

## What it detects

`/`, `%`, `/=` and Yul `div`/`sdiv`/`mod`/`smod` whose divisor can be zero and has no non-zero guard. Divisor sources: caller-supplied parameters, mutable state set by setters, oracle values, pool state (total supply, reserves) and deployment-time configuration. Fee denominators, share supply, reserve values and decimal scales are labelled in the message.

## Supported inputs

- Solidity 0.8.x source text (checked arithmetic by default). Sources with an older `pragma solidity` are still analyzed but get a warning diagnostic.
- Single file; inheritance, imports and library bodies are not resolved. No compiler settings are read, and no project scripts or configuration are executed.
- Input larger than 2,000,000 characters, empty input, non-string input, unbalanced braces and non-Solidity text are rejected with a diagnostic (`diagnostics[].level === "error" | "info"`) and zero findings; the detector never throws.

## How it decides

Each divisor is looked up in a dominating guard (`require(d != 0)`, `require(d > 0)`, `if (d == 0) revert`). Without one, the divisor is traced to its sources: a parameter of a public/external function ("the caller supplies d and can pass zero"), a state variable (every external setter that assigns it without a non-zero check is listed, with whether it carries an access modifier), pool state ("zero before the first deposit and after a full withdrawal"), or an oracle value. Literal and non-zero-constant divisors, `n + 1` and `max(n, 1)` are ignored.

Revert-on-zero versus silent failure:
- Checked Solidity division by zero reverts with Panic(0x12); with no guard that is an implicit revert (denial of service), reported by reachability.
- Yul `div`/`mod` return 0 for zero: a silently wrong result, reported high.
- `if (x == 0) return 0;` is deliberate but silent: reported low as a silent zero result.
- A dominating explicit guard is deliberate revert-on-zero: not reported.

## Severity and confidence

High: caller-supplied divisor, setter without access modifier, or Yul division. Medium: setter restricted to a privileged caller, empty-pool state, oracle value. Low: silent zero return.

## Assumptions and limitations

- Divisors are matched by source text; a guard on a differently named alias is not recognised.
- Setter analysis is by assignment in this file; inherited setters and proxies are not followed.
- Access control is judged from modifier names (`only*`, `auth*`, `requiresAuth`).
- Non-zero-by-construction values are recognised only for the `+ 1` and `max(x, 1)` idioms.

## False-positive considerations

A divisor that is non-zero by an invariant elsewhere (a constructor check, a modifier, an inherited setter) is reported. Check the listed paths against the real configuration flow.

## Fixtures

Vulnerable:

```solidity
contract Fees {
  uint256 public feeDenominator = 10000;
  function setFeeDenominator(uint256 d) external onlyOwner { feeDenominator = d; }
  function fee(uint256 amount) external view returns (uint256) {
    return amount / feeDenominator;
  }
}
```

Safe counterexample:

```solidity
contract Fees {
  uint256 public feeDenominator = 10000;
  function setFeeDenominator(uint256 d) external onlyOwner {
    require(d != 0, "zero");
    feeDenominator = d;
  }
  function fee(uint256 amount) external view returns (uint256) {
    return amount / feeDenominator;
  }
}
```

Expected normalized finding for the vulnerable fixture (`toNormalizedFindings(result, "Fixture.sol")`):

```json
{
  "ruleId": "arith-division-by-zero",
  "message": "Division by `feeDenominator` (fee denominator) in fee() has no dominating non-zero check, so a zero divisor reverts with Panic(0x12): setFeeDenominator() can set feeDenominator to zero (no non-zero check; restricted to a privileged caller). Missing guard: require(feeDenominator != 0).",
  "severity": "medium",
  "location": {
    "file": "Fixture.sol",
    "startLine": 5,
    "endLine": 5
  },
  "suggestedFix": {
    "description": "Add require(feeDenominator != 0) (or an explicit revert) before dividing, and validate the value where it is configured.",
    "documentationUrl": "https://docs.gasguard.dev/rules/arith-division-by-zero"
  },
  "metadata": {
    "title": "Divisor can be zero without a guard",
    "confidence": "medium",
    "function": "fee",
    "evidence": [
      "return amount / feeDenominator",
      "setFeeDenominator() can set feeDenominator to zero (no non-zero check; restricted to a privileged caller)"
    ],
    "rationale": "The zero value is reachable through privileged configuration or empty pool state.",
    "diagnostics": [],
    "limitations": [
      "see LIMITATIONS in the detector module"
    ]
  }
}
```

`metadata` also carries `diagnostics` and `limitations`. Use `toNormalizedFindings` from `rules/security/_shared/solidity-source.ts` to convert a result into the analyzer pipeline's `Finding` shape.

## Verification status

Unit tests (vulnerable, safe, boundary, malformed-input cases) are in `rules/security/math/__tests__/detect-division-by-zero-paths.spec.ts`. They have not been run yet, and no benchmark or independent security review has been recorded; both are open items for this rule.
