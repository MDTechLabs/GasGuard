# Signature expiry checks with incorrect boundary comparisons (`sig-expiry-boundary`)

Issue: #1374 · Detector: `rules/security/signatures/detect-signature-expiry-boundary.ts` · Tests: `rules/security/signatures/__tests__/detect-signature-expiry-boundary.spec.ts`

## What it detects

Deadline and expiry comparisons in signature-verifying functions: inverted checks, inclusive/exclusive inconsistency (exact-boundary behavior), off-by-one adjustments (`deadline + 1`), a deadline that is signed but never checked (or checked but not signed), and zero-deadline sentinel handling.

## Supported inputs

- Solidity 0.8.x source text (checked arithmetic by default). Sources with an older `pragma solidity` are still analyzed but get a warning diagnostic.
- Single file; inheritance, imports and library bodies are not resolved. No compiler settings are read, and no project scripts or configuration are executed.
- Input larger than 2,000,000 characters, empty input, non-string input, unbalanced braces and non-Solidity text are rejected with a diagnostic (`diagnostics[].level === "error" | "info"`) and zero findings; the detector never throws.

## How it decides

Functions that call `ecrecover`/`ECDSA`/`isValidSignature`/`SignatureChecker`, take a signature parameter or are named `permit` are examined. Each `require`, `if (...) revert`, `if (...) return` and `return` expression that compares `block.timestamp` with a deadline-like operand (deadline, expir*, validUntil, validBefore, validTo, until) yields the allowed relation: `block.timestamp <= deadline` is inclusive (valid at exactly the deadline, the EIP-2612 convention), `<` is exclusive (expired at exactly the deadline), `>=`/`>` is inverted. Mixed styles are reported on the minority style (ties favor inclusive). Set the expected convention with `options.expectedBoundary` or a `// deadline-boundary: inclusive|exclusive` comment. A deadline that is hashed into the digest must be compared; a compared deadline must be hashed. A zero-deadline sentinel (`deadline == 0 || ...`) must be documented in a comment such as "0 means no expiry"; a documented sentinel with no matching check is reported.

## Severity and confidence

High: inverted check, signed deadline never validated. Medium: inconsistent or unexpected boundary, off-by-one adjustment, checked-but-unsigned deadline, documented sentinel not implemented. Low: undocumented sentinel.

## Assumptions and limitations

- Only comparisons written directly against block.timestamp (or now) are traced; checks in helpers or libraries are not followed.
- Deadline operands are recognised by name.
- Sentinel documentation is detected from comment phrases.
- Digest membership is found by name inside keccak256/abi.encode/hashStruct statements of the same function.

## False-positive considerations

Functions that delegate the whole check to a helper are skipped (no direct comparison). A deliberately exclusive convention is reported as inconsistent only when another function uses the inclusive one; declare the convention to silence that.

## Fixtures

Vulnerable:

```solidity
contract Claims {
  function claim(uint256 deadline, bytes memory signature) external {
    require(block.timestamp >= deadline);
    address signer = ECDSA.recover(hash, signature);
  }
}
```

Safe counterexample:

```solidity
contract Claims {
  function claim(uint256 deadline, bytes memory signature) external {
    require(block.timestamp <= deadline);
    address signer = ECDSA.recover(hash, signature);
  }
}
```

Expected normalized finding for the vulnerable fixture (`toNormalizedFindings(result, "Fixture.sol")`):

```json
{
  "ruleId": "sig-expiry-boundary",
  "message": "claim() accepts the signature only when block.timestamp >= deadline: it is valid after the deadline and rejected before it.",
  "severity": "high",
  "location": {
    "file": "Fixture.sol",
    "startLine": 3,
    "endLine": 3
  },
  "suggestedFix": {
    "description": "Allow the signature while block.timestamp <= deadline (or < deadline) and revert otherwise.",
    "documentationUrl": "https://docs.gasguard.dev/rules/sig-expiry-boundary"
  },
  "metadata": {
    "title": "Signature expiry check is inverted",
    "confidence": "high",
    "function": "claim",
    "evidence": [
      "block.timestamp >= deadline",
      "allowed relation: block.timestamp >= deadline"
    ],
    "rationale": "An inverted comparison lets expired signatures through and blocks valid ones.",
    "diagnostics": [],
    "limitations": [
      "see LIMITATIONS in the detector module"
    ]
  }
}
```

`metadata` also carries `diagnostics` and `limitations`. Use `toNormalizedFindings` from `rules/security/_shared/solidity-source.ts` to convert a result into the analyzer pipeline's `Finding` shape.

## Verification status

Unit tests (vulnerable, safe, boundary, malformed-input cases) are in `rules/security/signatures/__tests__/detect-signature-expiry-boundary.spec.ts`. They have not been run yet, and no benchmark or independent security review has been recorded; both are open items for this rule.
