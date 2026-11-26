# Unsafe transient storage access patterns (`GG-TSTORE-001`)

Detector: `rules/security/storage-layout/detect-transient-storage-access.ts` · Tests: `rules/security/storage-layout/__tests__/detect-transient-storage-access.spec.ts`

## What it detects

Transient storage (EIP-1153: `tstore` / `tload`, or `transient` state variables) is cleared at the end of the *transaction*, not at the end of the call. Accesses are grouped per contract (including in-source bases and modifiers) by slot text or variable name. Returns the normalized `RuleResult` plus `slots` (sets, zero-stores and reads per slot).

| `kind` | Meaning | Severity |
| --- | --- | --- |
| `transient-value-never-reset` | A slot is set to a non-zero value and nothing in the contract stores zero to it. Medium for lock-like slots (literal non-zero set, read by a function that reverts or branches on it). | medium / low |
| `transient-read-never-written` | A slot is read with `tload` but never written in the contract, so it always reads zero. | low |
| `delegatecall-shares-transient-storage` | A function that uses transient storage also delegatecalls; the callee can read or clear the slots. | low |
| `unsupported-compiler-version` | Pragma pins a compiler below 0.8.24 (`tstore`/`tload`) or 0.8.28 (`transient` variables). | low |

## Accepted patterns

A lock that is released on the normal path (`tstore(SLOT, 0)` or `locked = false`) is not reported; the rule does not check that every revert/early-exit path releases it.

## Assumptions and limitations

- Solidity 0.8.x, one source string; slots are compared as text and helper functions that wrap `tstore` are not followed.
- Slot constants and aliases that spell the same slot differently look like different slots.
- Malformed, empty, oversized or non-Solidity input returns `analyzed: false`; no project scripts or configuration are executed.
- False positives: a value intentionally left set for the whole transaction (for example a flash-accounting delta settled by a later call) can be marked by storing zero in the settlement function.

## Fixtures

Vulnerable: `assembly { if tload(SLOT) { revert(0, 0) } tstore(SLOT, 1) }` with no `tstore(SLOT, 0)` anywhere.
Safe: the same block plus `assembly { tstore(SLOT, 0) }` at the end of the protected section. More cases are in the spec.
