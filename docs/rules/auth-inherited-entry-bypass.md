# Authorization bypassed through inherited entry points (`GG-AUTH-INHERIT-001`)

Issue: #1298 · Detector: `rules/security/access-control/detect-inherited-auth-bypass.ts`

## What it detects

| Kind | Severity | Meaning |
| --- | --- | --- |
| `override-drops-auth` | high | an override of a guarded function is an external entry point with no access check and no `super` call |
| `modifier-override-weakens-auth` | high | a derived modifier replaces a base modifier that checked the caller with a body that does not |
| `unguarded-sibling-entry` | medium | an inherited unguarded entry point reaches the same sensitive internal function as a guarded entry point of another contract |

## Supported inputs

- Solidity 0.6 to 0.8.x source text, one file. Inheritance is resolved with C3 linearization for bases defined in the source. No project scripts or configuration are read or executed.
- Imported bases (for example OpenZeppelin) are not resolved; their checks are neither assumed nor reported.
- Empty, non-string, oversized or non-Solidity input returns `analyzed: false` with an error diagnostic. Unbalanced delimiters or an inconsistent hierarchy give warning diagnostics. The detector never throws.

## How an access check is recognised

A modifier whose name starts with `only`, `auth`, `restricted`, `requires`, `isOwner` or `isAdmin`; a `require`, `assert` or `if` that mentions `msg.sender` or `_msgSender()`; calls to `_checkOwner`, `_checkRole`, `_requireAuth`, `hasRole` and similar; and one level of helper functions named `check*`, `require*`, `only*` or `auth*`.

## Determinism

Findings carry a stable `ruleId` and `kind`, a 1-based `line` and `column`, and are sorted by line, column and kind.

## Limitations

- Custom authorization schemes can be missed or reported.
- Reachability of internal functions is followed one call level deep.

## False positives

An override that intentionally opens a function should document it and still call `super` or be renamed. A public function that is safe because the sensitive callee checks the caller internally is not reported when the helper is named `_check*`.
