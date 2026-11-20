# Unsafe signed-to-unsigned conversions (`arith-signed-to-unsigned`)

Issue: #1367 · Detector: `rules/security/math/detect-signed-to-unsigned-conversion.ts` · Tests: `rules/security/math/__tests__/detect-signed-to-unsigned-conversion.spec.ts`

## What it detects

`uintN(x)` casts whose operand is signed. A negative value is reinterpreted as a huge unsigned number (for `int256 -> uint256`, -1 becomes 2^256 - 1), corrupting balances, fees, limits or accounting. Narrow (`uint8(int256)`) and wide (`uint256(int128)`) conversions are both covered; narrow ones are also noted as truncating.

## Supported inputs

- Solidity 0.8.x source text (checked arithmetic by default). Sources with an older `pragma solidity` are still analyzed but get a warning diagnostic.
- Single file; inheritance, imports and library bodies are not resolved. No compiler settings are read, and no project scripts or configuration are executed.
- Input larger than 2,000,000 characters, empty input, non-string input, unbalanced braces and non-Solidity text are rejected with a diagnostic (`diagnostics[].level === "error" | "info"`) and zero findings; the detector never throws.

## How it decides

Signed values are recognised from declarations (parameters, locals, state variables, mapping values, tuple destructuring), signed casts in the operand, functions declared to return `intN`, and oracle answers (`latestAnswer`, `latestRoundData`, a variable named `answer`). Values are traced backwards through local assignments to external parameters and to signed arithmetic results. A dominating `require(x >= 0)`, `require(x > 0)`, `if (x < 0) revert` (or the `0 <= x` forms), an `abs()` call or a `x < 0 ? -x : x` ternary clears the cast. `SafeCast.toUint256` is a library call, not a raw cast, and is never matched.

## Severity and confidence

High when the signed value comes from a caller-supplied parameter or the result feeds balance/fee/limit/transfer logic; medium otherwise. Confidence is high for declared signed types and medium for heuristic sources (oracle answers).

## Assumptions and limitations

- Signedness comes from declarations in this file; inherited or imported variables of unknown type are not recognised.
- Return values are signed only for functions declared in this file.
- A guard counts when it compares the cast operand with zero; proofs through other variables are not followed.
- Oracle answers are a heuristic.

## False-positive considerations

Casts of values that are non-negative by construction elsewhere (an earlier validated setter, a storage invariant) are reported. `abs(type(int256).min)` itself overflows; the abs exemption does not check for it.

## Fixtures

Vulnerable:

```solidity
contract Fees {
  uint256 public feeBps;
  function setFee(int256 fee) external {
    feeBps = uint256(fee);
  }
}
```

Safe counterexample:

```solidity
contract Fees {
  uint256 public feeBps;
  function setFee(int256 fee) external {
    require(fee >= 0, "negative");
    feeBps = uint256(fee);
  }
}
```

Expected normalized finding for the vulnerable fixture (`toNormalizedFindings(result, "Fixture.sol")`):

```json
{
  "ruleId": "arith-signed-to-unsigned",
  "message": "`uint256(fee)` in setFee() can turn a negative value into a very large unsigned number. No dominating check proves fee >= 0.",
  "severity": "high",
  "location": {
    "file": "Fixture.sol",
    "startLine": 4,
    "endLine": 4
  },
  "suggestedFix": {
    "description": "Use SafeCast.toUint256(value) or add require(value >= 0) before the cast; for narrowing casts also bound the value.",
    "documentationUrl": "https://docs.gasguard.dev/rules/arith-signed-to-unsigned"
  },
  "metadata": {
    "title": "Signed value cast to an unsigned type without a non-negative guard",
    "confidence": "high",
    "function": "setFee",
    "evidence": [
      "feeBps = uint256(fee)",
      "origin: external input fee",
      "target width: 256 bits",
      "the result is used in balance, fee, limit or transfer logic"
    ],
    "rationale": "A caller can pass a negative number directly; severity high.",
    "diagnostics": [],
    "limitations": [
      "see LIMITATIONS in the detector module"
    ]
  }
}
```

`metadata` also carries `diagnostics` and `limitations`. Use `toNormalizedFindings` from `rules/security/_shared/solidity-source.ts` to convert a result into the analyzer pipeline's `Finding` shape.

## Verification status

Unit tests (vulnerable, safe, boundary, malformed-input cases) are in `rules/security/math/__tests__/detect-signed-to-unsigned-conversion.spec.ts`. They have not been run yet, and no benchmark or independent security review has been recorded; both are open items for this rule.
