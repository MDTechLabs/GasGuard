# Timelock Upgrade Administration Bypass (`sol-027`)

Detector: `libs/engine/analyzers/timelock-upgrade-bypass-detector.ts`
Tests: `libs/engine/analyzers/timelock-upgrade-bypass-detector.spec.ts`

## What it detects

Contracts that implement or reference timelocked upgrade mechanisms, but introduce administrative bypasses that allow instant or unreviewed proxy upgrades or delay reductions without respecting the timelock window.

| `kind`                     | Description                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `direct-admin-upgrade`     | An upgrade entry point (e.g. `upgradeTo`, `_authorizeUpgrade`) callable directly by owner or admin without timelock queue and delay enforcement. |
| `emergency-upgrade-bypass` | An emergency or fast-track upgrade function (e.g. `emergencyUpgrade`, `instantUpgrade`) that bypasses scheduled review delays.                   |
| `unprotected-delay-setter` | A timelock delay setter function callable by accounts other than the timelock itself.                                                            |
| `unbounded-zero-delay`     | A timelock delay setter that allows reducing the delay to zero or fails to enforce an immutable non-zero lower bound.                            |

## Recognized as safe

- Upgrades restricted strictly to `msg.sender == timelock` or protected with `onlyTimelock`.
- Upgrade execution verifying operation readiness and execution delay maturity (`isOperationReady(opId)`).
- Delay setters requiring `onlyTimelock` and enforcing `require(newDelay >= MIN_DELAY)`.

## Severity and rationale

Severity: HIGH.
Bypassing timelock delays allows a compromised administrative key or rogue insider to immediately alter contract logic, drain assets, or manipulate state without the community notice period guaranteed by governance timelocks.

## Limitations

Lexical and AST source pattern analysis. External contract code, cross-contract calls through unlinked interfaces, and complex off-chain multi-sig governor patterns without on-chain timelock contracts are not fully modeled.
