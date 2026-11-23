# Solidity call-safety rules

Control-flow and call-safety detectors built on the shared toolkit in
[`rules/security/lib/solidity-lite.ts`](../../rules/security/lib/solidity-lite.ts) and the multi-file contract model in
[`rules/security/lib/project-model.ts`](../../rules/security/lib/project-model.ts). Each returns the normalized
`RuleResult` (`ruleId`, `analyzed`, `findings[]`, `diagnostics[]`, `limitations[]`) and can be converted to the analyzer
pipeline's `Finding` schema with `toNormalizedFindings` ([`normalize.ts`](../../rules/security/lib/normalize.ts)). The
Solidity analyzer runs every registered rule through
[`security-detector-pipeline.ts`](../../libs/engine/analyzers/security-detector-pipeline.ts).

| Rule id | Entry point | Source |
| --- | --- | --- |
| `GG-REENTRANCY-XCONTRACT-001` | `detectCrossContractReentrancy` | `rules/security/external-calls/detect-cross-contract-reentrancy.ts` |
| `GG-CALLORDER-001` | `detectExternalCallOrdering` | `rules/security/external-calls/detect-external-call-ordering.ts` |

## Supported input and general limitations

- Solidity source text for compiler versions 0.6 – 0.8.x. Compiler settings, EVM version, remappings and project
  configuration are never read or trusted; no repository script is executed and nothing is fetched.
- One source string, or an array of `{ path, content }` sources. Contracts, bases and call targets are resolved **by name
  across the supplied sources only**; `path` is a label and is never opened.
- Bounded: at most 200 files, 3,000,000 characters in total (1,000,000 per file), inheritance depth 12, internal-helper
  inlining depth 4 and 1,500 timeline events per function. A bound being hit is reported as a diagnostic and a limitation.
- Malformed or unsupported input never throws: non-strings, empty input, oversized input and text without a
  `contract`/`library`/`interface` return `analyzed: false` with an `error` diagnostic.
- Analysis is lexical. Branches are flattened in source order, asset/liability state is recognized by identifier name, and
  reentrancy locks are recognized by modifier name or by a project modifier that references a lock variable.

## GG-REENTRANCY-XCONTRACT-001 — cross-contract reentrancy through shared accounting

A function that hands control to an untrusted callee before it finishes updating its accounting opens a window in which
the callee can call a *different* contract that reads or mutates the same accounting. A lock on the first contract does
not close that window when the second contract only reads the first through a view function (read-only reentrancy) or
reaches an unguarded mutator.

**How it decides**

1. For every state-changing public/external function `F` of each contract `A`, build an ordered timeline of storage
   writes and external calls, inlining internal helpers and inherited implementations (`super.f()` and `Base.f()` too).
2. Find the first *reentrant interaction* (ETH/low-level `call`, `delegatecall`, token or interface calls whose code is
   not in the sources, calls into project contracts that themselves reach such a call) followed by a write to asset or
   liability state (`balances`, `shares`, `totalSupply`, `debt`, `reserves`, ...). `address.transfer/send` (2300 gas
   stipend), `staticcall` and view calls are not interactions.
3. In every other contract `C`, look for public/external functions `H` that call back into `A` through a typed state
   variable, cast, parameter or local (interface-typed receivers resolve to `A`'s implementation or public getter) and
   touch a not-yet-updated variable: `stale-read` when `H` reads it and then acts, `shared-mutation` when `H` reaches a
   mutator of it.
4. Drop a pair when `A`'s lock covers the path: `F` holds a lock and the reached mutator is locked, or the reached view
   refuses to answer while locked (`_checkNotEntered()`, `nonReentrantView`, `require(!locked)`).

| `kind` | Meaning |
| --- | --- |
| `cross-contract-stale-read` | Another contract reads accounting that `F` has not updated yet and acts on it. |
| `cross-contract-shared-mutation` | Another contract can mutate the same accounting through an unguarded function while `F` is mid-update. |

**Severity** — `critical` when the interaction is a low-level call and the re-entered function moves value;
`high` when either an ETH-forwarding call or a value-moving re-entered function is present; otherwise `medium`
(token hook / unresolved interface). **Confidence** — `high` for low-level calls and resolved project calls, `medium`
for unresolved interface or token targets. Every finding carries `severityRationale`, `confidenceEvidence[]` and
`details` (`interaction`, `pendingWrites`, `sharedState.assets|liabilities`, `reentryPath[]`, `surfaces[]`, `lock`).

**Unresolved boundaries** — low-level calls, `delegatecall`, address-typed targets and interface calls without an
implementation in the sources are listed as `unresolved-dynamic-call` diagnostics (file:line, enclosing function) and
summarized in `limitations`. Code behind them is not analyzed. Use the `trustedTargets` option to name contract or
interface types whose calls are known not to re-enter.

**Remediation** — apply checks-effects-interactions (write every balance, share and debt variable before the external
call); for read-only reentrancy make exposed views revert while the lock is held, or have consumers read a snapshot;
guard cross-contract mutators with the same lock or a single entry point.

**False-positive considerations** — a late write on a different branch than the call is reported as "after" it; shared
state reached only through delegatecall/proxy storage is not modeled; names that look like accounting but are not (and
vice versa) change the classification; a token whose transfers cannot call back (plain ERC-20) is still reported at
`medium` unless listed in `trustedTargets`.

**Fixtures** — `rules/security/external-calls/__tests__/cross-contract-reentrancy.fixtures.ts`: stale read, locked
mutator with unguarded view, shared mutator, inherited helpers, interface consumer, token hook, multi-file, and the
protected designs (effects first, locked view, locked mutator, stipend transfer, single contract).

Vulnerable:

```solidity
contract Vault {
  mapping(address => uint256) public balances;
  function withdraw(uint256 amount) external {
    (bool ok, ) = msg.sender.call{value: amount}("");
    require(ok);
    balances[msg.sender] -= amount;   // updated after the interaction
  }
}
contract Lender {
  Vault public vault;
  function borrow(uint256 amount) external {
    require(vault.balances(msg.sender) >= amount);  // stale collateral during the callback
    payable(msg.sender).transfer(amount);
  }
}
```

Safe counterexample: move `balances[msg.sender] -= amount;` above the `call`.

## GG-CALLORDER-001 — external call ordering around state changes

Finds public/external functions that make an external interaction and only afterwards write storage that can be observed
or re-entered. Storage writes before and after every external call are tracked across internal helpers, inherited
functions (including `super.f()` / `Base.f()`), and the bodies of non-lock modifiers (code before and after `_;`).

A late write is reported only when it is **relevant**:

| Relevance | Meaning |
| --- | --- |
| `check-then-act` | The function checked the variable (or a local copied from it, `uint amt = balances[x]; require(amt > 0)`) before the call, so a re-entrant call passes the same check again. |
| `accounting` | The variable is asset or liability state (balances, shares, debt, reserves, totals, ...). |
| `observed` | Another external function of the contract, or another contract that calls back into it, reads or mutates the variable. Used only when no stronger relevance applies. |

| `kind` | Condition | Severity |
| --- | --- | --- |
| `check-effects-violation` | A checked variable is written after the call. | critical for a value-forwarding low-level call (or accounting), high otherwise |
| `accounting-after-interaction` | Asset/liability state is written after the call. | high for low-level calls, medium for token/interface calls |
| `observable-state-after-interaction` | Other readers can see the stale value. | medium for low-level calls, low otherwise |

Confidence is `high` for low-level calls and resolved project calls and `medium` for token or interface targets.
Every finding lists `writesBefore`, `writesAfter` (with `relevance` and `readers`), every interaction in the function and
the calls treated as non-interactive.

**False-positive reducers**

- Not interactions: `address.transfer/send` (2300 gas stipend), `staticcall`, view/pure calls and getters, `this.f()`.
- Calls into project contracts whose resolved implementation cannot reach an untrusted call (recorded with the reason).
- Targets named in the `trustedTargets` option.
- Inline mutexes: a boolean written before and after the call and checked first is treated as a lock.
- Locks: when the function holds a recognized reentrancy lock only readers outside the lock are counted (an unguarded
  mutator, or a consumer in another contract that is not covered by a view lock check). Same-contract views are not
  counted under a lock.

**Limitations** — lexical analysis; branches are flattened in source order; relevance and accounting classification are
name based; callee code behind low-level calls, address-typed targets and interfaces without an implementation is not
analyzed (listed as `unresolved-dynamic-call` diagnostics and in `limitations`); modifiers are modeled only when defined
in the supplied sources; bases that are not in the supplied sources are listed as limitations.

**Fixtures** — `rules/security/external-calls/__tests__/call-ordering.fixtures.ts`: the exploit-shaped drain, accounting
after payout, helpers and inheritance, modifier post-body writes, token transfer, multi-file, and the safe designs
(effects before interactions, locked without consumers, inline mutex, non-interactive calls).

Vulnerable:

```solidity
function withdraw() external {
  uint256 amt = balances[msg.sender];
  require(amt > 0);
  (bool ok, ) = msg.sender.call{value: amt}("");
  require(ok);
  balances[msg.sender] = 0;   // checked before the call, cleared after it
}
```

Safe counterexample:

```solidity
function withdraw() external {
  uint256 amt = balances[msg.sender];
  require(amt > 0);
  balances[msg.sender] = 0;   // effects first
  (bool ok, ) = msg.sender.call{value: amt}("");
  require(ok);
}
```
