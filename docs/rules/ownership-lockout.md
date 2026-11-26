# Ownership and last-admin lockout (`sol-028`)

Detector: `rules/security/access-control/detect-ownership-lockout.ts` · Helpers: `rules/security/lib/solidity-lite.ts`, `rules/security/lib/solidity-inheritance.ts` · Tests: `rules/security/access-control/__tests__/detect-ownership-lockout.spec.ts`

## What it detects

In a concrete contract with a mutable administrator address, role, or administrator
mapping, `detectOwnershipLockout` reports flows that can leave the contract with no
usable administrator or remove the recovery path needed to use privileged functions.
It also inventories every analyzed contract as `risk`, `safe`, `immutable`,
`permissionless`, or `exempt`.

| `kind` | Meaning |
| --- | --- |
| `one-step-ownership-transfer` | `transferOwnership`-style function writes the admin directly without a pending-owner acceptance step. |
| `ownership-transfer-to-zero` | The direct transfer target is explicitly `address(0)` or an unvalidated parameter that allows zero. |
| `broken-two-step-transfer` | A pending-owner variable exists, but the transfer function still writes the active admin directly. |
| `pending-owner-zero` | A transfer stages a pending owner without rejecting `address(0)`, so acceptance cannot complete. |
| `unprotected-ownership-transfer` | The transfer entry point has no recognized owner, role, or sender authorization. |
| `unprotected-acceptance` | The acceptance entry point has no recognized pending-owner authorization. |
| `acceptance-not-pending-owner` | Acceptance assigns a new owner without checking the pending-owner slot. |
| `pending-owner-not-cleared` | Acceptance leaves the pending owner set, allowing a previous nominee to accept again. |
| `missing-acceptance` | A pending owner is staged but no accept/claim/complete function exists in the analyzed source. |
| `renounce-lockout` | An authorized renunciation removes the final administrator while privileged functions still depend on it. |
| `unprotected-renunciation` | Anyone can renounce the administrator while privileged functions still depend on it. |
| `last-admin-revocation` | A role or administrator mapping is removed without proving another administrator remains. |
| `last-admin-renunciation` | A caller can remove their own administrator role or flag without a remaining-admin guard. |
| `unprotected-role-revocation` | Anyone can revoke an administrator role or mapping entry. |

Each finding includes the contract, entry point, statement-level source location, a
severity rationale, confidence evidence, and a limitation. The detector result also
returns `flows` and `contracts` for tooling that needs the full inventory.

## Administrator model

The detector recognizes:

- mutable `address` state variables named like `owner`, `admin`, `governor`,
  `governance`, `manager`, `controller`, `authority`, `guardian`, `timelock`,
  `custodian`, `operator`, `multisig`, or configured `adminVariables`;
- pending-owner variables such as `pendingOwner`, `newOwner`, `proposedOwner`, or
  `ownerCandidate`;
- OpenZeppelin-style administrator roles (`DEFAULT_ADMIN_ROLE`, `ADMIN_ROLE`,
  `GOVERNOR_ROLE`, `OWNER_ROLE`, and configured `adminRoles`);
- administrator mappings such as `isAdmin`, `admins`, `operators`, `isOperator`,
  `managers`, and `governors`;
- access-control modifiers and inline checks based on `msg.sender`, `owner`,
  `hasRole`, `isAdmin`, or equivalent allow-list expressions.

Mappings declared in the source are modelled as simple key/value stores. Role
membership held in external contracts or inherited implementations that are not in
the analyzed source is not inspected.

## Two-step ownership transfer

A safe two-step flow stages a pending owner, validates it, requires the nominee to
accept, assigns the active owner, and clears the pending value:

```solidity
address public owner;
address public pendingOwner;

modifier onlyOwner() {
    require(msg.sender == owner, "not owner");
    _;
}

function transferOwnership(address newOwner) external onlyOwner {
    require(newOwner != address(0), "zero owner");
    pendingOwner = newOwner;
}

function acceptOwnership() external {
    require(msg.sender == pendingOwner, "not pending owner");
    owner = msg.sender;
    delete pendingOwner;
}
```

The detector reports the transfer if it writes `owner` directly, if it stages
`pendingOwner` without rejecting zero, if acceptance is unprotected, if acceptance
does not use the pending slot, or if the pending slot is not cleared.

Functions named like `renounceOwnership`, `renounceAdmin`, `resignGovernance`, and
their role equivalents are treated as renunciation. Renunciation is only a lockout
finding when at least one privileged function remains. If the contract intentionally
has no recovery or privileged functionality, the flow is recorded as `safe`.

## Last-admin revocation

Role revocation is reported when a function named like `revokeRole`,
`renounceRole`, `removeAdmin`, or `removeGovernor` removes an administrator role or
mapping flag and the analyzed source does not prove that another administrator
remains. Recognized guards include:

- `require(getRoleMemberCount(role) > 1)` or `>= 2`;
- the same comparison on a role-member mapping or administrator count;
- `> 1` / `!= 1` count checks followed by `revert`;
- configured count variables named like `adminCount`, `ownerCount`, or
  `numberOfAdmins`.

A guard is matched in the entry point or any reachable in-source helper. It is a
review prompt, not a proof that the remaining administrator is usable or that the
guard dominates every revocation path.

## Exemptions and annotations

Contracts that are intentionally immutable or permissionless are not reported:

- an administrator variable that is `immutable` or `constant`, with no ownership
  change or renunciation path, is classified `immutable`;
- a contract with no administrator variables, no privileged functions, and no role
  surface is classified `permissionless`;
- a contract whose administrator variables are never used as an authorization
  boundary is also classified `permissionless`.

Documented exemptions are accepted above the contract or function:

```solidity
// gasguard-ownership-lockout-exempt: the owner is replaced by a governance vote
// gasguard-immutable-admin: the administrator is set once at deployment
// gasguard-permissionless: no privileged functionality
```

`@custom:ownership-lockout-exempt`, `@custom:immutable-admin`,
`@custom:no-admin`, and `@custom:permissionless` are also accepted. Options can add
`exemptContracts`, `exemptFunctions`, `exemptPatterns`, `adminVariables`, and
`adminRoles`; malformed option lists and patterns produce diagnostics instead of
throwing.

## Severity and confidence

- **Critical:** unprotected ownership transfer, unprotected acceptance, or
  unprotected renunciation. Any caller can take or destroy administrative control.
- **High:** an authorized but irreversible one-step transfer, broken two-step
  transfer, zero pending owner, missing acceptance, last-admin revocation, or
  renunciation with remaining privileged functions.
- **Medium:** stale pending owner that was not cleared, because it requires a later
  control change to become exploitable.

Confidence is `high` when the write, pending slot, authorization check, and recovery
surface are all visible, and `medium` for stale-pending and indirect count-guard
cases. The analyzer's `sol-028` rule severity is applied to the normalized finding;
the detector's per-kind severity and rationale are kept in the metadata.

## Assumptions and limitations

- Source-text analysis only: no `solc`, scripts, bytecode, project configuration, or
  live chain state are read.
- One source string is analyzed. Inherited implementations and imported contracts
  outside that string are invisible; well-known base names such as `Ownable` and
  `AccessControl` are recognized by name only.
- Authorization and guard matches are lexical. The detector does not prove that a
  check dominates the write, that a role member is still active, or that an external
  recovery path exists.
- Administrator names and role constants drive detection, so generic names and
  custom role storage can be missed. Use `adminVariables` and `adminRoles` for
  project-specific names.
- Malformed delimiters, unterminated strings/comments, non-string input, and
  unbalanced source return `analyzed: false` or diagnostics with no partial
  conclusions.
- Intentionally centralized or permanently permissionless designs can be false
  positives when the recovery path is external to the analyzed source; use the
  documented annotations or options after review.

## Fixtures and verification

The reproducible corpus is in:

- `tests/rules/fixtures/sol-028-ownership-lockout.sol` — one-step, broken two-step,
  zero pending owner, unprotected transfer/acceptance/renunciation, renunciation
  lockout, role revocation, mapping-admin removal, missing acceptance, stale pending
  owner, plus safe two-step, guarded role, immutable, permissionless, and exempt
  contracts.
- `tests/rules/fixtures/sol-028-ownership-lockout.json` — expected findings and
  expected contract classifications.
- `tests/rules/expected/sol-028-normalized.json` — expected normalized analyzer
  output.
- `tests/regression/solidity/fixtures/ownership-lockout-*.json` — positive,
  negative, and last-admin boundary regression cases.

Unit, integration, regression, malformed-input, and generated-input tests are in
`rules/security/access-control/__tests__/detect-ownership-lockout.spec.ts` and
`tests/regression/solidity/semantic-corpus.spec.ts`.

### Verification status

- Targeted Jest run: 9 detector tests and 19 regression tests passed, along with the
  existing ownership, zero-address, timelock, and false-positive suites.
- The generated-input test exercises 200 deterministic malformed strings and asserts
  that the detector never throws and always returns the documented result shape.
- A local detector-only microbenchmark over the 15-contract fixture measured an
  average of 3.06 ms, median 2.55 ms, and p95 5.24 ms over 100 warm runs (Node 24,
  Windows). This is an indicative measurement, not a CI performance gate.
- Independent security review has not yet been recorded; the `sol-028` rule is
  enabled by default and should be reviewed before production rollout.
