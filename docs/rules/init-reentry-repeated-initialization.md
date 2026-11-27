# Initializer re-entry and repeated initialization (`GG-INIT-REENTRY-001`)

Issue: #1314 · Detector: `rules/security/initialization/detect-solidity-initializer-reentry.ts`

Solidity counterpart of the Soroban-only `detect-unprotected-initializers`.

## What it detects

| Kind | Severity | Meaning |
| --- | --- | --- |
| `unguarded-initializer` | high | an external `initialize`, `init` or `setup` has no initializer modifier and no initialized-flag or zero-owner guard |
| `public-chained-initializer` | high | a `__X_init` function is public or external and not protected by `onlyInitializing` |
| `flag-set-after-external-call` | high | the initialized flag is set after an external call, so the call can re-enter and initialize again |
| `missing-disable-initializers` | medium | an implementation uses `initializer` but its constructor does not call `_disableInitializers()` |

## Supported inputs

- Solidity 0.6 to 0.8.x source text, one file. No project scripts or configuration are read or executed.
- Recognised guards: `initializer`, `reinitializer`, `onlyInitializing` and a few custom names (`once`, `onlyOnce`, `notInitialized`), or a `require`, `assert` or `if` on an initialized flag or a zero owner or admin.
- Empty, non-string, oversized or non-Solidity input returns `analyzed: false` with an error diagnostic. Unbalanced delimiters give a warning diagnostic. The detector never throws.

## Determinism

Findings carry a stable `ruleId` and `kind`, a 1-based `line` and `column`, and are sorted by line, column and kind.

## Limitations

- Guards inside called helpers are not followed.
- External calls are recognised by method name only.
- The constructor check looks at the contract itself, not at its bases.

## False positives

An initializer protected by a custom modifier with an unrecognised name is reported as unguarded. Rename the modifier to a recognised name or add an explicit flag check.
