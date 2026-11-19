# block.timestamp use in high-value randomness decisions (`time-timestamp-randomness`)

Issue: #1372 · Detector: `rules/security/time/detect-timestamp-randomness.ts` · Tests: `rules/security/time/__tests__/detect-timestamp-randomness.spec.ts`

## What it detects

Block data (`block.timestamp`, `block.number`, `blockhash`, `block.prevrandao`, `block.difficulty`, `block.coinbase`, `now`) used to select winners or assign valuable outcomes: hashed or modded into an index, used as an array index, compared with a threshold after hashing, or returned from a `random()`-style helper. Timestamps used only for deadlines, expiry or accounting are not reported.

## Supported inputs

- Solidity 0.8.x source text (checked arithmetic by default). Sources with an older `pragma solidity` are still analyzed but get a warning diagnostic.
- Single file; inheritance, imports and library bodies are not resolved. No compiler settings are read, and no project scripts or configuration are executed.
- Input larger than 2,000,000 characters, empty input, non-string input, unbalanced braces and non-Solidity text are rejected with a diagnostic (`diagnostics[].level === "error" | "info"`) and zero findings; the detector never throws.

## How it decides

Block-derived values are traced through local assignments and hashes (`keccak256`, `abi.encode*`). A statement is a selection when the traced value is the left side of `%`, an array index, hashed and compared with a threshold in `if/require`, or returned by a function named like `random`/`seed`/`roll`. A variable that already holds a reported outcome is not reported again. `fulfillRandomWords` callbacks (VRF) are skipped.

Why each source is unsuitable against an adversary: timestamp (proposer-adjustable, same value for same-block contracts), block number (public, predictable), blockhash (readable in the same block, zero when older than 256 blocks), prevrandao/difficulty (visible in the block, biasable by skipping a slot), coinbase (chosen by the proposer).

## Severity and confidence

High for timestamp, block number, blockhash or coinbase in a function that transfers value or names a winner/prize/jackpot/raffle/lottery/reward; medium for prevrandao in such a function or for the stronger sources elsewhere; low for prevrandao elsewhere.

## Assumptions and limitations

- Block-derived values are traced only through local assignments in one function.
- Cosmetic uses (day-of-week `% 7`) are reported at reduced severity when no value path exists.
- Value impact is inferred from transfers, minting and names (winner, prize, jackpot, raffle, lottery, reward, loot, payout).
- Commit-reveal is recognised only by the absence of block data in the selection.

## False-positive considerations

Non-adversarial uses such as rotating a display banner by time, or a `% n` on a block value used for sharding, are reported at lower severity; they are not exploitable but also not random.

## Fixtures

Vulnerable:

```solidity
contract Lottery {
  address[] public players;
  address public winner;
  function draw() external {
    uint256 idx = uint256(keccak256(abi.encodePacked(block.timestamp, msg.sender))) % players.length;
    winner = players[idx];
    payable(winner).transfer(address(this).balance);
  }
}
```

Safe counterexample:

```solidity
contract Lottery {
  address[] public players;
  address public winner;
  function fulfillRandomWords(uint256, uint256[] memory randomWords) internal {
    winner = players[randomWords[0] % players.length];
    payable(winner).transfer(address(this).balance);
  }
}
```

Expected normalized finding for the vulnerable fixture (`toNormalizedFindings(result, "Fixture.sol")`):

```json
{
  "ruleId": "time-timestamp-randomness",
  "message": "block.timestamp feeds an outcome decision in draw() (used as the left side of a modulo); block data is not suitable as adversarial randomness and this function moves value or assigns a prize.",
  "severity": "high",
  "location": {
    "file": "Fixture.sol",
    "startLine": 5,
    "endLine": 5
  },
  "suggestedFix": {
    "description": "Use Chainlink VRF or commit-reveal; if randomness is cosmetic only, document that and cap what it can award.",
    "documentationUrl": "https://docs.gasguard.dev/rules/time-timestamp-randomness"
  },
  "metadata": {
    "title": "Block data used as a source of randomness",
    "confidence": "high",
    "function": "draw",
    "evidence": [
      "uint256 idx = uint256(keccak256(abi.encodePacked(block.timestamp, msg.sender))) % players.length",
      "block.timestamp: the proposer can shift the timestamp within the accepted window and same-block contracts see the same value",
      "result stored in idx",
      "high-value context: transfers, minting or prize/winner names in this function"
    ],
    "rationale": "A validator or a calling contract can predict or bias the value and capture the prize; severity follows the strength of the source.",
    "diagnostics": [],
    "limitations": [
      "see LIMITATIONS in the detector module"
    ]
  }
}
```

`metadata` also carries `diagnostics` and `limitations`. Use `toNormalizedFindings` from `rules/security/_shared/solidity-source.ts` to convert a result into the analyzer pipeline's `Finding` shape.

## Verification status

Unit tests (vulnerable, safe, boundary, malformed-input cases) are in `rules/security/time/__tests__/detect-timestamp-randomness.spec.ts`. They have not been run yet, and no benchmark or independent security review has been recorded; both are open items for this rule.
