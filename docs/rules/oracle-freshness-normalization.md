# Oracle freshness and decimal-normalization defects (`GG-ORACLE-FRESH-001`)

Issue: #1304 · Detector: `rules/security/oracle/detect-oracle-freshness-normalization.ts`

Complements `GG-ORACLE-ANSWER-001`, which covers sign and round-completeness checks.

## What it detects

| Kind | Severity | Meaning |
| --- | --- | --- |
| `discarded-updated-at` | high | `latestRoundData()` is read but `updatedAt` is thrown away, so age cannot be checked |
| `missing-freshness-bound` | high | `updatedAt` is kept but never compared with `block.timestamp` |
| `hardcoded-feed-decimals` | medium | the answer is scaled with a literal such as `1e18` and no `decimals()` is read anywhere |
| `unnormalized-feed-mix` | medium | two feed answers are multiplied or divided with no decimals handling in the function |

## Supported inputs

- Solidity 0.6 to 0.8.x source text, one file, checks within a single function. No project scripts or configuration are read or executed.
- Reads whose answer never reaches financial logic, and sequencer-uptime feeds, are not reported.
- Empty, non-string, oversized or non-Solidity input returns `analyzed: false` with an error diagnostic. Unbalanced delimiters give a warning diagnostic. The detector never throws.

## Determinism

Findings carry a stable `ruleId` and `kind`, a 1-based `line` and `column`, and are sorted by line, column and kind.

## Limitations

- A freshness helper is recognised only as `isStale`, `checkStale` or `requireFresh`.
- Decimals count as handled when any `.decimals()` call appears in the source; it is not matched to a feed.

## False positives

Name the freshness helper with one of the recognised names, or inline the `block.timestamp - updatedAt <= HEARTBEAT` check. Read `decimals()` from the feed to silence the decimals kinds.
