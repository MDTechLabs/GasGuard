# Pause enforcement bypass (`GG-PAUSE-BYPASS-001`)

Detector: `rules/security/emergency/detect-pause-bypass.ts` · Helper: `rules/security/lib/solidity-inheritance.ts` · Tests: `rules/security/emergency/__tests__/detect-pause-bypass.spec.ts`

## What it detects

In a concrete contract that has a pause mechanism (a `Pausable`-style base, a pause flag, or `pause()`/`unpause()`), sensitive entry points that stay callable while paused. It returns the normalized `RuleResult` with an extra `inventory` listing every sensitive entry point and whether pause is `enforced`, `missing` or `exempt`.

| `kind` | Meaning |
| --- | --- |
| `unpaused-entry-point` | External function with a sensitive effect and no pause check. |
| `cross-function-pause-gap` | The entry point reaches the sensitive code through internal calls without a guard; `details.guardedSiblings` lists guarded entry points reaching the same sink. |
| `inherited-entry-point-unpaused` | Defined in a base contract and inherited unchanged. |
| `callback-bypasses-pause` | Token hook, flash-loan/swap callback, cross-chain receiver, `receive`/`fallback` that changes state. |
| `privileged-operation-unpaused` | Owner/role-gated function; often intentional, so lower severity. |

## Inventory of pause-sensitive operations

Functions named like deposit, withdraw, mint/burn, borrow/repay/liquidate, swap, claim, transfer or bridge operations, plus any function that moves value (`transfer`, `.call{value}`, `mint`...) or writes balance-like state. Extend it with `operations: [{ category, namePattern }]`.

## Pause enforcement recognized

`whenNotPaused`-style modifiers (resolved through inherited and overridden modifiers; an override with no check removes the guard), inline `require(!paused)` / `if (paused) revert` / `_requireNotPaused()`, `ERC20Pausable`-style `_beforeTokenTransfer`/`_update` hooks, and a guard anywhere on the call path to the effect. Add names with `pauseModifiers` and `pauseVariables`.

## Exemptions

Not every function must be paused. Exempt: `pause`/`unpause`, `emergency*`, `rescue*`, functions only callable while paused (`whenPaused`), `exemptFunctions`, `exemptPatterns`, and a comment above the function: `// gasguard-pause-exempt: <reason>` or `@custom:pause-exempt <reason>`.

## Severity and confidence

High for an unprivileged entry point (anyone can move value during a pause); medium for callbacks and privileged value movers; low for other privileged functions. Confidence is high when a guarded sibling reaches the same sink, low for privileged-only paths or when an inherited base is not visible.

## Assumptions and limitations

- Solidity 0.6 – 0.8.x source text, one source string; compiler settings are not read, and no scripts or project configuration are executed.
- Bases not defined in the source are invisible (well-known names such as `Pausable` are recognized by name only).
- Guards are matched textually; the rule does not prove the guard dominates the effect.
- Option regexes are length-limited and rejected if they look like nested quantifiers.
- Malformed, empty or non-Solidity input returns `analyzed: false` with diagnostics.

## Fixtures

Vulnerable (cross-function):

```solidity
contract Vault is Pausable {
  function withdraw(uint256 a) external whenNotPaused { _withdraw(msg.sender, a); }
  function withdrawTo(address to, uint256 a) external { _withdraw(to, a); }
  function _withdraw(address to, uint256 a) internal { balances[msg.sender] -= a; payable(to).transfer(a); }
}
```

Safe: add `whenNotPaused` to `withdrawTo`, or guard `_withdraw`. More cases (inherited, override, weakened modifier, callback) are in the spec.

## Verification status

Tests were written but not run; no benchmark or independent review has been recorded.
