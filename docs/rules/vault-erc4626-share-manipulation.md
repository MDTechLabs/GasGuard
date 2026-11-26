# ERC-4626 accounting and share-price manipulation (`GG-VAULT-4626-001`)

Issue: #1303 · Detector: `rules/security/vault/detect-erc4626-share-manipulation.ts`

## What it detects

| Kind | Severity | Meaning |
| --- | --- | --- |
| `spot-balance-total-assets` | high (low if mitigated) | `totalAssets()` reads `balanceOf(address(this))` or `address(this).balance`, so a donation moves the share price |
| `unmitigated-first-depositor` | high / medium | shares are priced as `assets * supply / totalAssets` with no virtual offset and no dead shares |
| `unchecked-zero-shares` | medium | `deposit` mints a computed share amount without reverting when it is zero |

## Supported inputs

- Solidity 0.6 to 0.8.x source text, one file, contract by contract. A contract is treated as a vault when it defines `totalAssets` with `deposit`, `mint`, `convertToShares` or `previewDeposit`.
- No project scripts or configuration are read or executed.
- Empty, non-string, oversized or non-Solidity input returns `analyzed: false` with an error diagnostic. Unbalanced delimiters give a warning diagnostic. The detector never throws.

## Recognised mitigations

- a non-zero `_decimalsOffset()` return, `+ 10 ** n`, `totalAssets() + 1` or `VIRTUAL_*` constants
- a mint to `address(0)` or a dead address, or `MINIMUM_LIQUIDITY` style constants

## Determinism

Findings carry a stable `ruleId` and `kind`, a 1-based `line` and `column`, and are sorted by line, column and kind.

## Limitations

- Analysis is lexical and per contract. Inherited conversion logic is not followed, so a contract that only inherits OpenZeppelin `ERC4626` is not reported for the first-depositor kind.
- Accounting kept in a state variable is assumed donation-safe.

## False positives

Silence `unmitigated-first-depositor` by adding a recognised mitigation next to the conversion, or by documenting an enforced minimum initial deposit.
