# Storage layout across compiler and inheritance changes (`GG-STORAGE-LAYOUT-001`)

Issue: #1313 · Detector: `rules/security/storage-layout/detect-layout-inheritance-risks.ts`

## What it detects

Applies to contracts in an upgradeable tree: contracts with `Initializable` or `*Upgradeable` bases, `initialize`, `__*_init`, `_authorizeUpgrade` or `upgradeTo*` functions, and every contract they inherit from or are inherited by in the source.

| Kind | Severity | Meaning |
| --- | --- | --- |
| `missing-storage-gap` | medium | a base contract with state variables has no `__gap` array |
| `shadowed-state-variable` | medium | a derived contract redeclares a base state variable name and gets a separate slot |
| `multi-base-storage-order` | low | several bases declare state variables, so the inheritance list order decides the layout |
| `floating-pragma-upgradeable` | low | a non-exact `pragma solidity` lets the compiler version change between builds |

## Supported inputs

- Solidity 0.6 to 0.8.x source text, one file. Inheritance is resolved with C3 linearization for bases defined in the source. No project scripts or configuration are read or executed.
- Constants and immutables do not use storage and are ignored.
- Empty, non-string, oversized or non-Solidity input returns `analyzed: false` with an error diagnostic. Unbalanced delimiters or an inconsistent hierarchy give warning diagnostics. The detector never throws.

## Determinism

Findings carry a stable `ruleId` and `kind`, a 1-based `line` and `column`, and are sorted by line, column and kind.

## Limitations

- Imported bases and their storage are not known.
- Two builds cannot be compared from one source, so only structural risks are reported. Record `solc --storage-layout` output per release and diff it in CI for the exact comparison.

## False positives

A base that is never extended in an upgrade, or a gap kept under another name, can be reported. Name the gap `__gap` or `_gap` to satisfy the check.
