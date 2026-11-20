# Timestamp units and scaling mismatches (`time-unit-mismatch`)

Issue: #1371 · Detector: `rules/security/time/detect-timestamp-unit-mismatch.ts` · Tests: `rules/security/time/__tests__/detect-timestamp-unit-mismatch.spec.ts`

## What it detects

Confusion between seconds, milliseconds, minute/hour/day counts and block counts in expiry, lockup, vesting, cooldown and rate-limit logic: mixed units in one expression (`block.timestamp < deadlineMs`, `block.timestamp + lockDays`, `block.number >= lastCall + COOLDOWN_SECONDS`), `block.timestamp / 1000`, and double scaling of values that are already seconds (`LOCK_PERIOD * 1 days` with `LOCK_PERIOD = 7 days`).

## Supported inputs

- Solidity 0.8.x source text (checked arithmetic by default). Sources with an older `pragma solidity` are still analyzed but get a warning diagnostic.
- Single file; inheritance, imports and library bodies are not resolved. No compiler settings are read, and no project scripts or configuration are executed.
- Input larger than 2,000,000 characters, empty input, non-string input, unbalanced braces and non-Solidity text are rejected with a diagnostic (`diagnostics[].level === "error" | "info"`) and zero findings; the detector never throws.

## How it decides

Units come from time literals (`7 days`), name suffixes (`Ms`, `Seconds`, `Minutes`, `Hours`, `Days`, `Blocks` and the SCREAMING_CASE forms), constants initialised with time literals, and a short list of seconds-like names (deadline, expiry, startTime, duration, cooldown, ...). Explicit normalisation is respected and not flagged: `count * 1 days` (or 86400, 3600, 60), `valueMs / 1000`, `block.timestamp * 1000 <= deadlineMs`, `blocks * BLOCK_TIME`.

## Severity and confidence

High for mixed units in expiry/lockup/vesting/cooldown/rate-limit context; medium when no such context is found in the statement. Confidence is high when block.timestamp or block.number is one of the operands.

## Assumptions and limitations

- Names without a unit hint carry no unit unless they end in a common time word.
- Normalisation is recognised only in the listed forms; helper functions are not followed.
- Block counts are never convertible to seconds without an explicit block-time constant.
- Values from other contracts or storage structs carry no unit information.

## False-positive considerations

Names that look like units but are not (for example a variable `endDays` that already holds seconds) are treated by their suffix. Rename or normalise explicitly to silence a finding.

## Fixtures

Vulnerable:

```solidity
contract Claims {
  mapping(address => uint256) public deadlineMs;
  function claim() external {
    require(block.timestamp < deadlineMs[msg.sender]);
  }
}
```

Safe counterexample:

```solidity
contract Claims {
  mapping(address => uint256) public deadlineMs;
  function claim() external {
    require(block.timestamp * 1000 < deadlineMs[msg.sender]);
  }
}
```

Expected normalized finding for the vulnerable fixture (`toNormalizedFindings(result, "Fixture.sol")`):

```json
{
  "ruleId": "time-unit-mismatch",
  "message": "Time units are mixed (seconds vs milliseconds): block.timestamp [seconds], deadlineMs [milliseconds] (in claim())",
  "severity": "high",
  "location": {
    "file": "Fixture.sol",
    "startLine": 4,
    "endLine": 4
  },
  "suggestedFix": {
    "description": "Convert to seconds explicitly (`count * 1 days`, `ms / 1000`) and compare timestamps only with timestamps.",
    "documentationUrl": "https://docs.gasguard.dev/rules/time-unit-mismatch"
  },
  "metadata": {
    "title": "Mixed time units in one expression",
    "confidence": "high",
    "function": "claim",
    "evidence": [
      "require(block.timestamp < deadlineMs[msg.sender])",
      "block.timestamp [seconds]",
      "deadlineMs [milliseconds]"
    ],
    "rationale": "The value drives an expiry, lockup, vesting, cooldown or rate limit, so a unit error shifts it by orders of magnitude.",
    "diagnostics": [],
    "limitations": [
      "see LIMITATIONS in the detector module"
    ]
  }
}
```

`metadata` also carries `diagnostics` and `limitations`. Use `toNormalizedFindings` from `rules/security/_shared/solidity-source.ts` to convert a result into the analyzer pipeline's `Finding` shape.

## Verification status

Unit tests (vulnerable, safe, boundary, malformed-input cases) are in `rules/security/time/__tests__/detect-timestamp-unit-mismatch.spec.ts`. They have not been run yet, and no benchmark or independent security review has been recorded; both are open items for this rule.
