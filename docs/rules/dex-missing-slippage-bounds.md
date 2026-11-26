# Missing slippage bounds in token exchange operations (`GG-DEX-SLIPPAGE-001`)

Issue: #1306 · Detector: `rules/security/dex/detect-missing-slippage-bounds.ts`

## What it detects

| Kind | Severity | Meaning |
| --- | --- | --- |
| `zero-min-output` | high | the minimum output of a swap is the literal `0` (`amountOutMin`, `amountOutMinimum`, Curve `min_dy`) |
| `unbounded-max-input` | high | the maximum input of an exact-output swap is `type(uintN).max` |
| `onchain-derived-bound` | medium | the bound is computed from `getAmountsOut`, `getReserves`, `slot0` or a quoter in the same transaction |
| `immediate-deadline` | low | the deadline is `block.timestamp` |

Recognised calls: Uniswap V2 router swaps, Uniswap V3 `exactInput`, `exactInputSingle`, `exactOutput` and `exactOutputSingle` struct params, and Curve `exchange` and `exchange_underlying`.

## Supported inputs

- Solidity 0.6 to 0.8.x source text, one file, checks within a single function. No project scripts or configuration are read or executed.
- Bounds taken from a function parameter or storage are accepted.
- Empty, non-string, oversized or non-Solidity input returns `analyzed: false` with an error diagnostic. Unbalanced delimiters give a warning diagnostic. The detector never throws.

## Determinism

Findings carry a stable `ruleId` and `kind`, a 1-based `line` and `column`, and are sorted by line, column and kind.

## Limitations

- Only the call shapes listed above are recognised. Aggregators and custom pool interfaces are not analyzed.
- A bound enforced after the swap by comparing the returned amount is not recognised and can be reported.
- Bounds passed through helper functions are not followed.

## False positives

A zero minimum can be intentional for a keeper that checks the result afterwards. Move that check next to the call or pass the bound as a parameter so the finding is not raised.
