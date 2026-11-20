# block.number assumptions across L2 and sidechain deployments (`time-block-number-assumptions`)

Issue: #1373 · Detector: `rules/security/time/detect-block-number-assumptions.ts` · Tests: `rules/security/time/__tests__/detect-block-number-assumptions.spec.ts`

## What it detects

Logic that assumes block numbers map consistently to elapsed time or security guarantees across deployment environments: fixed block-count delays (`block.number + 50400`, `*_BLOCKS` constants) used for locks, timelocks, cooldowns, challenge windows and confirmations, and block-number-to-time conversions (`block.number * 12`, `blocks * SECONDS_PER_BLOCK`, `block.number / BLOCKS_PER_DAY`). Findings describe deployment-dependent behavior, not a universal exploit.

## Supported inputs

- Solidity 0.8.x source text (checked arithmetic by default). Sources with an older `pragma solidity` are still analyzed but get a warning diagnostic.
- Single file; inheritance, imports and library bodies are not resolved. No compiler settings are read, and no project scripts or configuration are executed.
- Input larger than 2,000,000 characters, empty input, non-string input, unbalanced braces and non-Solidity text are rejected with a diagnostic (`diagnostics[].level === "error" | "info"`) and zero findings; the detector never throws.

## How it decides

A chain profile maps each target chain to an approximate block time in seconds (defaults: ethereum 12, optimism 2, base 2, arbitrum 12 (block.number tracks an L1 approximation, see the note), polygon 2). Choose targets with `options.chains` and add or override profiles with `options.profiles` (`{ blockTimeSeconds, note }`). A fixed delay is reported with its duration on every target chain when the block times differ by more than 10%; a conversion constant (`SECONDS_PER_BLOCK`, `BLOCKS_PER_DAY`, `* 12`) is reported for the chains whose block time differs from the implied one. The chain profile used is always listed in an info diagnostic. Invalid profiles and unknown chains produce warnings and fall back to the defaults.

## Severity and confidence

Medium when the statement or function has a delay/lock/timelock/cooldown/challenge/finality context; low otherwise. Confidence is medium because the intended duration is not known.

## Assumptions and limitations

- Built-in block times are approximate defaults; override them for your deployment.
- The intended duration of a block count is unknown unless a constant name says so.
- Only block.number arithmetic and named block-count constants in this file are analyzed.
- Comparisons with a stored block number at distance 0 or 1 (same-block guards, `blockhash(block.number - 1)`) are ignored.

## False-positive considerations

A count that is deliberately a number of blocks (for example `blockhash(block.number - 256)` or a reorg-depth requirement) is still listed with its per-chain duration; the finding is informational for such uses. Single-chain deployments should set `chains` to that one chain.

## Fixtures

Vulnerable:

```solidity
contract Locker {
  mapping(address => uint256) public unlockBlock;
  function lock() external {
    unlockBlock[msg.sender] = block.number + 50400;
  }
}
```

Safe counterexample:

```solidity
contract Locker {
  mapping(address => uint256) public unlockTime;
  function lock() external {
    unlockTime[msg.sender] = block.timestamp + 7 days;
  }
}
```

Expected normalized finding for the vulnerable fixture (`toNormalizedFindings(result, "Fixture.sol")`):

```json
{
  "ruleId": "time-block-number-assumptions",
  "message": "A delay of 50400 blocks lasts ethereum: 7d, optimism: 28h, base: 28h, arbitrum: 7d, polygon: 28h (in lock())",
  "severity": "medium",
  "location": {
    "file": "Fixture.sol",
    "startLine": 4,
    "endLine": 4
  },
  "suggestedFix": {
    "description": "Use block.timestamp with a duration in seconds, or take the block time from per-chain configuration.",
    "documentationUrl": "https://docs.gasguard.dev/rules/time-block-number-assumptions"
  },
  "metadata": {
    "title": "Fixed block-count delay depends on the chain's block time",
    "confidence": "medium",
    "function": "lock",
    "evidence": [
      "unlockBlock[msg.sender] = block.number + 50400",
      "50400 blocks",
      "target chains: ethereum, optimism, base, arbitrum, polygon",
      "optimism: block.number is the L2 block number",
      "base: block.number is the L2 block number",
      "arbitrum: block.number reports an approximation of the L1 block number, not the L2 block count (ArbSys.arbBlockNumber() gives the L2 number); check the current Arbitrum documentation"
    ],
    "rationale": "The block count controls a delay or security window whose real duration depends on the chain; deployment-dependent, severity medium.",
    "diagnostics": [],
    "limitations": [
      "see LIMITATIONS in the detector module"
    ]
  }
}
```

`metadata` also carries `diagnostics` and `limitations`. Use `toNormalizedFindings` from `rules/security/_shared/solidity-source.ts` to convert a result into the analyzer pipeline's `Finding` shape.

## Verification status

Unit tests (vulnerable, safe, boundary, malformed-input cases) are in `rules/security/time/__tests__/detect-block-number-assumptions.spec.ts`. They have not been run yet, and no benchmark or independent security review has been recorded; both are open items for this rule.
