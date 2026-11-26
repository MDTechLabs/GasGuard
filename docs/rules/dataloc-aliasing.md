# Calldata, memory and storage aliasing (`GG-DATALOC-001`)

Issue: #1297 · Detector: `rules/security/data-location/detect-data-location-aliasing.ts`

## What it detects

| Kind | Severity | Meaning |
| --- | --- | --- |
| `memory-copy-mutation-lost` | medium | a `memory` local copied from a state variable is modified and never written back |
| `storage-alias-snapshot` | medium | a `storage` pointer is read, the same storage is written directly, then the pointer is read again, so it is not a snapshot |
| `memory-param-mutation-lost` | low | an internal function mutates a `memory` parameter and returns nothing while a caller passes it a state variable |

## Supported inputs

- Solidity 0.6 to 0.8.x source text, one file, per contract. No project scripts or configuration are read or executed.
- Empty, non-string, oversized or non-Solidity input returns `analyzed: false` with an error diagnostic. Unbalanced delimiters give a warning diagnostic. The detector never throws.

## Determinism

Findings carry a stable `ruleId` and `kind`, a 1-based `line` and `column`, and are sorted by line, column and kind.

## Limitations

- State variables inherited from bases defined elsewhere are not known, so copies of them are not reported.
- Write-back is recognised only as `stateVar... = local`; helper functions are not followed.
- Calls are matched by function name only.

## False positives

A deliberate local copy that is only read is never reported. If a mutated copy is intentional, rename it or add the write-back to make the intent explicit.
