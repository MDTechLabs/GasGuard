# Narrowing casts that truncate user-controlled values (`arith-narrowing-cast`)

Issue: #1368 · Detector: `rules/security/math/detect-narrowing-cast-truncation.ts` · Tests: `rules/security/math/__tests__/detect-narrowing-cast-truncation.spec.ts`

## What it detects

Explicit integer down-casts (`uint256 -> uint128`, `int256 -> int128`, `uint256 -> uint32(block.timestamp)`, ...) where the operand is declared wider than the target, so values above the target maximum silently lose their high bits. Values that influence transfers, authorization or accounting rank above identifiers and timestamps, which rank above everything else.

## Supported inputs

- Solidity 0.8.x source text (checked arithmetic by default). Sources with an older `pragma solidity` are still analyzed but get a warning diagnostic.
- Single file; inheritance, imports and library bodies are not resolved. No compiler settings are read, and no project scripts or configuration are executed.
- Input larger than 2,000,000 characters, empty input, non-string input, unbalanced braces and non-Solidity text are rejected with a diagnostic (`diagnostics[].level === "error" | "info"`) and zero findings; the detector never throws.

## How it decides

The operand width comes from declarations (parameters, locals, state variables, mapping values), nested casts and well-known 256-bit sources (`block.timestamp`, `msg.value`, `.length`, `balanceOf(...)`). A cast is protected when a dominating guard compares the operand against `type(uintN).max`, a `MAX`/limit/cap name or a numeric bound, or when the next statements verify a round trip (`require(uint256(y) == x)`). A guarded cast inside a checked-cast helper library is therefore accepted. `SafeCast.toUintN(...)` calls are not raw casts and are never matched. Operands of unknown width are reported only at low confidence and only when their name looks value-like.

## Severity and confidence

High when the result reaches transfers, authorization checks or accounting and the operand is caller-influenced or its width is known; medium for identifiers, timestamps and caller-influenced values; low otherwise.

## Assumptions and limitations

- Source width comes from declarations in this file.
- A guard counts as a range check when it compares the operand with a max/limit/numeric bound; the bound is not verified to fit the target type.
- Assembly casts and bit masks are not analyzed.
- Intentionally lossy packed-storage casts (`uint32(block.timestamp)`) are reported at medium or low severity.
- Same-width sign changes are left to `arith-signed-to-unsigned`.

## False-positive considerations

Casts of values bounded elsewhere (a validated setter, a storage invariant, an upstream `SafeCast`) and deliberate truncations are reported; check the evidence lines before acting.

## Fixtures

Vulnerable:

```solidity
contract Pool {
  mapping(address => uint128) public balances;
  function deposit(uint256 amount) external {
    balances[msg.sender] += uint128(amount);
  }
}
```

Safe counterexample:

```solidity
contract Pool {
  mapping(address => uint128) public balances;
  function deposit(uint256 amount) external {
    require(amount <= type(uint128).max, "too big");
    balances[msg.sender] += uint128(amount);
  }
}
```

Expected normalized finding for the vulnerable fixture (`toNormalizedFindings(result, "Fixture.sol")`):

```json
{
  "ruleId": "arith-narrowing-cast",
  "message": "`uint128(amount)` in deposit() narrows a uint256 value to uint128 with no dominating range check; values above the target maximum are silently truncated.",
  "severity": "high",
  "location": {
    "file": "Fixture.sol",
    "startLine": 4,
    "endLine": 4
  },
  "suggestedFix": {
    "description": "Use SafeCast or require(value <= type(uintN).max) before narrowing.",
    "documentationUrl": "https://docs.gasguard.dev/rules/arith-narrowing-cast"
  },
  "metadata": {
    "title": "Narrowing cast may truncate the value",
    "confidence": "high",
    "function": "deposit",
    "evidence": [
      "balances[msg.sender] += uint128(amount)",
      "source width 256 bits, target 128 bits",
      "operand derives from caller input amount",
      "influences: accounting"
    ],
    "rationale": "The truncated value reaches transfers, authorization or accounting, where a wrapped amount changes who gets what.",
    "diagnostics": [],
    "limitations": [
      "see LIMITATIONS in the detector module"
    ]
  }
}
```

`metadata` also carries `diagnostics` and `limitations`. Use `toNormalizedFindings` from `rules/security/_shared/solidity-source.ts` to convert a result into the analyzer pipeline's `Finding` shape.

## Verification status

Unit tests (vulnerable, safe, boundary, malformed-input cases) are in `rules/security/math/__tests__/detect-narrowing-cast-truncation.spec.ts`. They have not been run yet, and no benchmark or independent security review has been recorded; both are open items for this rule.
