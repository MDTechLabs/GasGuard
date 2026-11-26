# Missing access control on emergency configuration setters (`GG-ACCESS-SETTER-001`)

Detector: `rules/security/access-control/detect-missing-setter-access-control.ts` · Helper: `rules/security/lib/solidity-inheritance.ts` · Tests: `rules/security/access-control/__tests__/detect-missing-setter-access-control.spec.ts`

## What it detects

Externally callable functions that change **pause state, fees, limits, destinations** (treasury, recipient) or **trusted integrations** (oracle, router, bridge, whitelist, operator ...) without an effective authorization boundary. Returns the normalized `RuleResult` plus an `inventory` (`restricted`, `unrestricted`, `ineffective`, `permissionless`, `read-only`).

| `kind` | Meaning |
| --- | --- |
| `unrestricted-config-setter` | No modifier, inline check or helper restricts the caller. |
| `ineffective-access-control` | A check exists but cannot work: `tx.origin` comparison, or `msg.sender` compared with a function parameter. |

## What counts as authorization

- Modifiers resolved through inherited and overridden modifiers (an override with an empty body removes the check).
- Access-looking modifiers whose body is not in the source (`onlyOwner`, `onlyRole`, `auth` ...), accepted by name.
- Inline `require(msg.sender == x)`, `hasRole` / `_checkRole` / `_checkOwner`, `require(admins[msg.sender])`.
- Internal helpers (`_checkAdmin()`) whose body performs a check, and internal setters that are themselves restricted.

## Handled separately

- Public `view`/`pure` functions are listed as `read-only`.
- Per-caller settings (`x[msg.sender] = ...`) are not global configuration.
- Intentionally permissionless controls: option `permissionlessFunctions` or a `// gasguard-permissionless: <reason>` / `@custom:permissionless` comment above the function (`permissionless` in the inventory).
- Initializers are skipped (unprotected initializers are a separate rule).

## Severity and confidence

Critical for pause, destination and integration setters (anyone can halt the protocol, redirect funds or install a malicious integration); high for fees and limits. Confidence is high for a direct write, medium when the write is reached through an internal call or the check is ineffective.

## Assumptions and limitations

- Solidity 0.6 – 0.8.x, one source string; compiler settings are not read and no scripts or project configuration are executed.
- Setters are recognised by name verbs (`set`, `update`, `enable` ...) or by plain assignment of a parameter to a sensitive variable; sensitive variables are matched by name.
- Who holds an owner or role at runtime is not visible; imported bases are recognised by name only.
- Malformed, empty or non-Solidity input returns `analyzed: false` with diagnostics.

## Fixtures

Vulnerable: `function setTreasury(address t) external { treasury = t; }`

Safe: `function setTreasury(address t) external onlyOwner { treasury = t; }`

More cases (inherited and weakened modifiers, helpers, tx.origin, internal setters, view and permissionless) are in the spec.

## Verification status

Tests were written but not run; no benchmark or independent review has been recorded.
