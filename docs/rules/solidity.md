# Solidity Rules

Signature and authorization checks are documented in [Solidity Signature and Authorization Rules](./signature-authorization.md).

## Uint8VsUint256Rule

**Rule ID:** `uint8vsuint256rule`

**Language:** solidity

**Category:** solidity

**Severity:** medium

### Description

Using uint8 outside structs is often more gas-expensive than uint256 on EVM chains.

### Implementation

**File:** `packages\rules\src\solidity\uint8_vs_uint256.rs`

### Example

#### Before: Inefficient use of uint8 outside structs
```solidity
// Less efficient - uint8 outside struct
uint8 public counter;

// More efficient within struct (allowed)
struct Point {
    uint8 x;
    uint8 y;
}

// More efficient - using uint256 for storage variables
uint256 public balance;
```

#### After: Improved gas efficiency
```solidity
// More efficient - using uint256 for storage variables
uint256 public counter;

// Still acceptable within structs
struct Point {
    uint8 x;
    uint8 y;
}

// More efficient - using uint256 for storage variables
uint256 public balance;
```

### Gas Savings
- Using uint256 instead of uint8 for storage variables can save up to 20% gas
- The EVM operates on 32-byte words, so smaller types often require extra conversion operations
- Only use uint8/uint16/etc. when they are part of a struct to enable tight packing

## Exact Ether Balance Accounting

**Rule ID:** `sol-019`  
**Severity:** medium  
**Category:** security

Detects `require` or `assert` conditions that directly require
`address(this).balance == <tracked-accounting-variable>`. The compared
identifier must be named like native-asset accounting (for example
`totalDeposits`, `totalLiabilities`, or `accountedBalance`). A forced Ether
transfer can raise the actual balance without updating Solidity state, making
such an exact-equality guard fail. If that guard protects deposits, withdrawals,
or other value-bearing operations, the result can be an availability failure.
Forced Ether is not reported as a vulnerability on its own.

The rule intentionally does not report lower-bound solvency checks such as
`address(this).balance >= totalLiabilities` or explicit surplus reconciliation
using `>` and tracked surplus. A payable deposit that increments the accounting
variable is likewise not a finding by itself.

### Supported input and compiler assumptions

- The rule scans Solidity source text and does not invoke `solc`.
- It accepts source with no version pragma, and pragma versions in Solidity
  `0.4.x` through `0.8.x`; explicit versions outside that range produce an
  analyzer diagnostic. The repository's Foundry configuration currently
  selects Solidity `0.8.20`, optimizer enabled, with 1,000 runs; those settings
  are not read or needed by this source-pattern rule.
- The analyzer recognizes the high-level `address(this).balance` spelling,
  direct equality expressions within `require`/`assert`, and accounting-like
  identifier names. It does not interpret compiler settings, bytecode, inline
  assembly, aliases, inheritance, or cross-file data flow.
- Unbalanced delimiters cause this detector to skip the source and return an
  analyzer diagnostic rather than attempting a partial match.

### Confidence, impact, and false positives

The normalized finding carries the exact source location, confidence evidence,
and an explicit limitation: lexical matching cannot prove that the guard is
reachable or that a revert strands funds. Review the affected call path before
classifying impact. An exact equality inside a harmless view or a deliberate
post-reconciliation assertion may be a false positive; conversely, accounting
variables with generic names and guards implemented indirectly can be missed.

Prefer checks that ensure the raw balance covers recorded liabilities, and
account for or explicitly sweep any surplus. Keep user claims based on recorded
balances rather than assuming forced Ether cannot change `address(this).balance`.

### Reproducible fixture and normalized output

The vulnerable vault, direct payable deposit, forced-Ether sender, and
surplus-aware counterexample are in
`tests/rules/fixtures/sol-019-ether-accounting.json`. The expected normalized
finding is recorded in
`tests/rules/expected/sol-019-normalized.json`; the integration test
compares the analyzer result against it.


## Unchecked ERC-20 approve Return Value

**Rule ID:** `sol-023`  
**Severity:** medium  
**Category:** security

ERC-20 tokens disagree about `approve`: most return `true`, some return `false`
instead of reverting, and some (USDT-style) return no data at all. This rule
reports approval flows that assume one of those behaviours.

| Kind | Meaning | Token behaviour affected |
| --- | --- | --- |
| `discarded-return` | Typed `approve()` result is dropped or assigned and never checked | A token returning `false` leaves the allowance unset silently |
| `assumes-bool-return` | Typed `approve()` result is required as a `bool` | Tokens returning no data revert at ABI decoding |
| `unchecked-low-level-call` | Low-level approve call whose success flag is not checked | A reverting token is ignored |
| `returndata-ignored` | Success checked, returndata dropped or never decoded | Explicit `false` is treated as success |
| `decode-without-length-check` | `abi.decode(data, (bool))` without a `data.length` guard | No-return tokens revert; malformed short returndata is not handled |
| `wrapper-unavailable` | A `safeApprove`/`forceApprove`-style wrapper is called but no import, library, or local definition exists in the analyzed source | Wrapper behaviour cannot be verified |

Recognised call shapes: `token.approve(a, b)`, `IERC20(x).approve(a, b)`, and
`.call(...)` whose payload uses `abi.encodeWithSelector(IERC20.approve.selector, …)`,
`abi.encodeWithSignature("approve(address,uint256)", …)`, `abi.encodeCall`, or the
`0x095ea7b3` selector. Calls through `SafeERC20` (`safeApprove`, `forceApprove`,
`safeIncreaseAllowance`, `safeDecreaseAllowance`) are **not** reported when the
wrapper is imported or defined in the source; an unsafe local wrapper is reported at
its inner `approve` call site instead. `this.approve`, `super.approve`, and receivers
named like ERC-721/1155 contracts are skipped.

### Supported input and limitations

- Scans Solidity source text; it does not invoke `solc`, execute scripts, or read
  project configuration. Compiler settings are not needed.
- Accepts sources with no pragma or pragmas within Solidity `0.4.x`–`0.8.x`;
  other versions, unbalanced delimiters, and unterminated strings/comments yield an
  analyzer diagnostic and no findings.
- Does not resolve token addresses, inheritance, aliases, inline-assembly calls, or
  calldata assembled outside the call expression. Whether a given token actually
  returns `false` or nothing is not known statically, so confidence is at most 0.9
  and each finding lists its evidence.

### Remediation

Use OpenZeppelin `SafeERC20.forceApprove` (or `safeIncreaseAllowance`) for all token
approvals. For hand-written low-level calls require
`success && (data.length == 0 || abi.decode(data, (bool)))`.

### Fixtures

`tests/rules/fixtures/sol-023-approve-return.sol` models true, false, no-return,
reverting, and malformed-return tokens plus unsafe and safe callers;
`sol-023-approve-return.json` lists the expected findings.

## Unsafe Allowance Adjustment Assumptions

**Rule ID:** `sol-024`  
**Severity:** medium  
**Category:** security

`increaseAllowance` and `decreaseAllowance` are not part of ERC-20, and changing an
allowance with a separate read and write is race-sensitive. This rule models the
helpers present in the analyzed source rather than trusting their names.

| Kind | Meaning |
| --- | --- |
| `unchecked-adjust-call` | `token.increaseAllowance/decreaseAllowance(...)` result is discarded and no implementation is available to show it always reverts on failure |
| `nonstandard-adjust-method` | The call result is consumed, but the method is assumed to exist (absent from many tokens such as USDT and from OpenZeppelin 5.x) |
| `read-modify-write-approve` | `approve`/`safeApprove`/`forceApprove` on an external token receives a value computed from `allowance()` plus/minus an amount, inline or via a local variable |
| `unchecked-decrease-underflow` | A function subtracts a parameter from an allowance with no preceding comparison, under Solidity < 0.8 or an `unchecked` block |
| `saturating-decrease` | A function clamps an excessive decrease to zero instead of reverting |

### How helpers are modelled

- The receiver of each adjustment call is resolved to its declared type (function
  parameter, state variable, or cast). If that type is a contract or library defined
  in the source and has an implementation of the method, the call is not reported
  and the implementation itself is analyzed. Interfaces, unresolved types, and
  imported contracts are treated as unknown.
- Allowance-writing functions are analyzed by their body (assignments to
  allowance-like storage or `_approve(...)` with a subtraction), whatever they are
  named. `this.` and `super.` calls are skipped.
- An in-token adjustment (`_allowances[o][s] += x`) is atomic and not reported.

### Supported input and limitations

- Source-text analysis only; `solc`, scripts, and project configuration are not
  used. Sources with no pragma or pragmas in `0.4.x`–`0.8.x` are analyzed; other
  versions, unbalanced delimiters, and unterminated strings/comments produce a
  diagnostic and no findings.
- Not modelled: inheritance, cross-file implementations, aliases, assembly, and
  token semantics such as infinite-allowance sentinels, rebasing, or permit-only
  approvals. Confidence is at most 0.8 and each finding lists its evidence. A
  read-modify-write on an allowance granted to a fully trusted spender may be an
  accepted risk.

### Remediation

Set the exact allowance needed (`SafeERC20.forceApprove`, resetting to zero first
for tokens that require it) and consume it in the same transaction. In custom
allowance code, `require` the decrease is within the current allowance and revert
rather than clamp or wrap.

### Fixtures

`tests/rules/fixtures/sol-024-allowance-adjustment.sol` covers a standard token,
a wrapping non-standard token, a clamping custom token, and unsafe and safe callers;
`sol-024-allowance-adjustment.json` lists the expected findings.

## Fee-on-Transfer Accounting Assumption

**Rule ID:** `sol-025`  
**Severity:** medium  
**Category:** security

Traces the nominal amount passed to a token pull against the accounting that
follows. If a token deducts a fee on transfer, crediting the requested amount
records more than the contract received, and the shortfall is paid out of other
users' funds.

| Kind | Meaning |
| --- | --- |
| `nominal-credit` | `token.transferFrom/safeTransferFrom(_, address(this), amount)` (or `SafeERC20.safeTransferFrom(token, _, address(this), amount)`) is followed by an assignment, `+=`/`-=`, or mint/deposit-style call that uses `amount` or a value derived from it |
| `withdrawal-nominal-forward` | An amount is withdrawn from another contract (`withdraw`/`redeem`/`unstake`/`remove*`/`exit`) and the same nominal amount is forwarded with `transfer`/`safeTransfer` |

Each finding records the inferred `flow` (`deposit`, `liquidity`, `staking`,
`swap`, `repayment`, `withdrawal`, `transfer-in`) from the function name and the
accounting it performs, and the `creditLine` of the statement that uses the
nominal amount.

### Policy: explicit versus accidental

The enclosing contract's comments, identifiers, and revert strings are read for
fee-on-transfer / deflationary / rebasing / tax-token terms:

- **`explicit-unsupported`** (a negation such as "not supported", "rejected", or
  "revert" near the term): not reported. The decision is surfaced as
  `suppressedByPolicy` in the detector result.
- **`claimed-support`** (the term appears without a negation): reported with
  higher confidence (0.85 / 0.65), because the code does not deliver what it states.
- **`unspecified`**: reported with lower confidence (0.6 / 0.45) as an accidental
  assumption.

A pull is considered balance-delta accounted, and not reported, when a
`balanceOf(...)` read appears both before and after it in the same function.

### Remediation and trade-offs

Account with the measured delta:

```solidity
uint256 beforeBalance = token.balanceOf(address(this));
token.safeTransferFrom(msg.sender, address(this), amount);
uint256 received = token.balanceOf(address(this)) - beforeBalance;
balances[msg.sender] += received;
```

Trade-offs: two extra `balanceOf` calls per pull (gas); the balance can change
during the transfer through hooks, so use a reentrancy guard; events and share
math must use `received`, not `amount`; and rebasing tokens still break the
invariant because their balance moves without transfers. If delta accounting is not
wanted, reject such tokens explicitly (an allowlist, or `require(received == amount)`)
and document the policy so the assumption is deliberate.

### Supported input and limitations

- Source-text analysis only; no `solc`, scripts, or project configuration are used.
  Sources with no pragma or pragmas in `0.4.x`–`0.8.x` are analyzed; other versions,
  unbalanced delimiters, and unterminated strings/comments produce a diagnostic.
- Analysis is per function and only considers pulls whose recipient is
  `address(this)`. It does not follow internal helper calls, inheritance, or imported
  code, and cannot know whether a given token charges a fee. NFT-like receivers
  are skipped. Policy detection is lexical and can be fooled by unrelated comments.

### Fixtures

`tests/rules/fixtures/sol-025-fee-on-transfer.sol` has positive and negative
deposit, liquidity, swap, and withdrawal flows, plus a contract that claims
support and one that rejects such tokens; `sol-025-fee-on-transfer.json` lists
the expected findings and policy-suppressed site.

## Missing Zero-Address Check in Critical Configuration

**Rule ID:** `sol-026`  
**Severity:** medium  
**Category:** security

Finds configuration entry points that store or forward a critical address without
rejecting `address(0)`. Entry points are classified as `constructor`,
`initializer` (`initialize*`, `init`, `setup`, `__*_init`, or an `initializer` /
`reinitializer` modifier), `factory` (`create*`/`deploy*`/`clone*` functions that use
`new`, a clone, or `.initialize(...)`), or `setter` (any other `external`/`public`
non-view function).

### Prioritised address categories and impact

| Category | Inferred from names such as | Downstream impact of zero |
| --- | --- | --- |
| `upgrade` | implementation, impl, logic, beacon, upgrade, template | A proxy delegates to empty code (calls succeed without effect or revert); an upgrade to zero may be irreversible |
| `authorization` | owner, admin, governor, guardian, operator, minter, role, timelock | Every function behind that privilege is permanently locked; the contract may be impossible to recover or upgrade |
| `custody` | token, asset, vault, treasury, recipient, receiver, escrow, collateral | A zero token bricks high-level token calls or lets low-level calls succeed silently; a zero treasury or recipient burns funds |
| `pricing` | oracle, feed, aggregator, twap | Every price read reverts, halting borrowing, liquidation, and swaps, or empty data is read as a price of zero |

Each finding carries the category, the parameter, the exact storing or forwarding
statement, its impact text, and whether the entry point is restricted by an
access-control modifier (restricted entry points report ten points lower
confidence: the realistic failure is operator error, not an attacker).

### What counts as validated

A parameter is not reported when it is:

- compared with `address(0)` (or `0x0`/`0`) anywhere in the function, in a `require`,
  `if ... revert`, or a branch, which also covers code that deliberately handles zero;
- checked with `isContract(x)`, `x.code.length`, or `extcodesize(x)`;
- passed through a modifier or internal helper whose body is in the source and
  compares its own parameter with zero (followed up to three calls deep), or one
  named like `nonZero`/`notZero`/`validAddress`;
- forwarded to a base constructor such as `Ownable(initialOwner)`;
- documented as a zero sentinel in the comment directly above the function
  (it must name the parameter, mention zero or `address(0)`, and say what it means,
  for example "zero disables fee collection");
- passed to a `new T(...)` or `x.initialize(...)` whose implementation is in the
  source and validates the matching parameter.

### Supported input and limitations

- Source-text analysis only; no `solc`, scripts, or project configuration are used.
  Sources with no pragma or pragmas in `0.4.x`–`0.8.x` are analyzed; other versions,
  unbalanced delimiters, and unterminated strings/comments produce a diagnostic.
- Criticality is inferred from parameter and callee names, so addresses with generic
  names are not reported. `internal`/`private` functions are skipped; a public setter
  that delegates to an unvalidated internal helper is reported at the call.
  Callee implementations outside the analyzed source, inheritance, and cross-file
  validation are not inspected (such callees lower confidence by 0.05).

### Remediation

```solidity
error ZeroAddress();

function setOracle(address newOracle) external onlyOwner {
    if (newOracle == address(0)) revert ZeroAddress();
    oracle = newOracle;
}
```

Where zero is intentional, document it on the parameter and handle it explicitly.
For tokens and oracles consider also checking `code.length > 0`.

### Fixtures

`tests/rules/fixtures/sol-026-zero-address.sol` has constructor, initializer,
setter, and factory configuration with unvalidated, validated (inline, helper, and
modifier), sentinel, and modelled-callee cases; `sol-026-zero-address.json` lists
the expected findings.

## Rebasing-Token Stored Balance Assumption

**Rule ID:** `sol-027`  
**Severity:** medium  
**Category:** security

Runs the `GG-TOKEN-REBASE-001` detector
(`rules/security/tokens/detect-rebasing-balance-assumptions.ts`) in the analyzer. It
reports a stored token amount or balance snapshot that is later paid out as if the
token balance could only change through the contract's own transfers. The detector's
own severity, confidence, evidence, and details are kept in the finding metadata.
Tracing, recognised share-based designs and exclusions, assumptions, and limitations
are described in [token-rebasing-balance-assumptions.md](token-rebasing-balance-assumptions.md).

### Fixtures

`tests/rules/fixtures/sol-027-rebasing-balance.sol` has two positive patterns (a
stored deposit and a balance snapshot) and two negative ones (share-based accounting
and an explicit exclusion); `sol-027-rebasing-balance.json` lists the expected findings.

## Ownership and Last-Admin Lockout

**Rule ID:** `sol-028`  
**Severity:** high  
**Category:** security

Reports ownership transfers, renunciations, role revocations, and administrator
mapping removals that can permanently lock out the contract's administrator or remove
its recovery path. The detector models two-step ownership transfer, pending-owner
acceptance, final-admin renunciation, and last-admin role removal, and classifies
contracts as `risk`, `safe`, `immutable`, `permissionless`, or `exempt`.

The finding kinds, recognized administrator model, annotations, severity rationale,
confidence evidence, and limitations are described in
[ownership-lockout.md](ownership-lockout.md).

### Fixtures

`tests/rules/fixtures/sol-028-ownership-lockout.sol` covers one-step and broken
two-step transfers, zero pending owners, unprotected transfer/acceptance, renunciation,
role revocation, mapping-admin removal, missing acceptance, stale pending owners, and
safe or documented-exempt variants. `sol-028-ownership-lockout.json` lists the
expected findings and `tests/rules/expected/sol-028-normalized.json` records the
normalized analyzer output.

## Unsafe ERC-721 Safe-Transfer Callback Assumptions

**Rule ID:** `sol-030`
**Severity:** high for stateful unauthenticated receiver callbacks; medium for
post-transfer state updates
**Category:** security

Reports state updates after callback-capable ERC-721 transfers and unauthenticated,
stateful `onERC721Received` callbacks. Apply effects before safe transfers, use a
reentrancy guard, and authenticate the caller against an allowlisted collection.

### Fixtures

`tests/rules/fixtures/sol-030-erc721-safe-transfer-callback.sol` covers unsafe
transfer ordering, unauthenticated receiver callbacks, effects-before-interactions,
authenticated receivers, guard modifiers, and library transfers.
