# Solidity authorization rules

Authorization and configuration detectors built on the shared toolkit in
[`rules/security/lib/solidity-lite.ts`](../../rules/security/lib/solidity-lite.ts), the multi-file contract model in
[`project-model.ts`](../../rules/security/lib/project-model.ts) and the caller-gate model in
[`authority-model.ts`](../../rules/security/lib/authority-model.ts). Results use the normalized `RuleResult`
(`findings[]`, `diagnostics[]`, `limitations[]`, `notes[]`) and convert to the analyzer `Finding` schema with
`toNormalizedFindings`; the Solidity analyzer runs them through
[`security-detector-pipeline.ts`](../../libs/engine/analyzers/security-detector-pipeline.ts).

| Rule id | Entry point | Source |
| --- | --- | --- |
| `GG-AUTH-LOCKOUT-001` | `detectAuthorityLockout` | `rules/security/access-control/detect-authority-lockout.ts` |
| `GG-AUTH-PAUSE-001` | `detectPauseAuthority` | `rules/security/access-control/detect-pause-authority.ts` |

## Supported input and general limitations

- Solidity 0.6 – 0.8.x source text: one string or `{ path, content }[]` resolved by contract name. Compiler settings,
  remappings and project configuration are never read or trusted; no repository script is executed.
- Bounds: 200 files, 3,000,000 characters in total, inheritance depth 12. Malformed or oversized input returns
  `analyzed: false` with an error diagnostic and never throws.
- Lexical, name-based analysis. A *gate* is derived from modifiers (project-defined ones are read, `onlyX` names are
  interpreted), `msg.sender` comparisons against owner/admin-style identifiers, `admins[msg.sender]`, `hasRole`,
  `onlyRole` and `_checkOwner()`. Frameworks (Ownable, Ownable2Step, AccessControl, AccessControlDefaultAdminRules)
  are recognized by base-contract name only. Who holds a key or role at runtime is not visible.

## GG-AUTH-LOCKOUT-001 — accidental administrator lockout

| `kind` | Condition | Severity |
| --- | --- | --- |
| `single-step-owner-transfer` | Owner is assigned straight from an argument (or inherited single-step `Ownable`). | high without a zero-address check, medium with one, low with a recovery authority or inherited |
| `pending-accept-unrestricted` | A two-step acceptance function does not require `msg.sender == pendingOwner`. | critical |
| `pending-accept-not-by-pending` | Acceptance is gated by the current owner, so the recipient never confirms. | medium |
| `pending-acceptance-missing` | A pending owner is stored but nothing promotes it to owner. | medium |
| `ownership-renounce-lockout` | `owner = address(0)` or an inherited, un-overridden `renounceOwnership` while owner-gated functions exist. | high when unpause/withdraw/upgrade/recovery are gated, otherwise medium; low with recovery or a finalization guard |
| `last-admin-removable` / `last-admin-renounceable` | An admin mapping entry can be cleared with no admin-count guard or `target != msg.sender` check; inherited `AccessControl` without `DefaultAdminRules` (low). | medium–high; low with a recovery authority |

**Intentional designs** are distinguished rather than reported: a contract with no privileged functions is permanently
permissionless; a comment on the contract or function documenting immutability, ownerless-by-design or intentional
renounce, or the `intentionallyImmutable` option, suppresses lockout findings. Each decision is recorded in `notes`.
A second authority (for example `onlyGuardian`) able to reset the owner counts as a recovery path and lowers severity.

**Fixtures** — `rules/security/access-control/__tests__/ownership-lockout.fixtures.ts`: single-step transfer, pending-owner
mistakes (unrestricted accept, never accepted), safe two-step, renounce, documented intent, permissionless, recovery
authority, last-admin removal and its safe counter-example, inherited Ownable / Ownable2Step / AccessControl.

Vulnerable: `function acceptOwnership() external { owner = pendingOwner; }`
Safe: `require(msg.sender == pendingOwner); owner = pendingOwner; pendingOwner = address(0);`

## GG-AUTH-PAUSE-001 — pause / unpause authority

Resolves who can pause and who can unpause and builds the role graph around them: role constants, `_grantRole` /
`_setupRole` / `grantRole` holders (constructors and initializers included) and `_setRoleAdmin` edges (default admin:
`DEFAULT_ADMIN_ROLE`). The graph is emitted in `details.roleGraph` and as one-line `notes`
(`UNPAUSER_ROLE: admin PAUSER_ROLE; holders msg.sender (Vault constructor)`).

The documented policy is passed as `policy: { pauseAuthorities, unpauseAuthorities, requirePause, requireSeparation }`
using authority names as written in the code. Without a policy only unconditional problems are reported.

| `kind` | Condition | Severity |
| --- | --- | --- |
| `unpause-unrestricted` / `pause-unrestricted` | No caller restriction. | critical / high |
| `unpause-broader-than-policy` | Unpause gate is wider than `policy.unpauseAuthorities`. | high |
| `pause-broader-than-policy` | Pause gate is wider than `policy.pauseAuthorities`. | medium |
| `unpause-role-admin-broad` | The admin of the unpause role is a pause-only authority. | medium |
| `pause-authority-lost` / `unpause-authority-lost` | Role and its admin have no holder: emergency control unusable / contract can stay paused forever. | high |
| `pause-authority-unassigned` / `unpause-authority-unassigned` | Role has no holder yet but its admin can grant it. | low |
| `pause-unpause-not-separated` | One authority does both and `policy.requireSeparation` is set. | low |
| `missing-emergency-pause` | No pause function and `policy.requirePause` is set. | medium |

**Limitations** — pause/unpause functions are recognized by name; grants made by later transactions and roles inherited
from unresolved bases are not visible; policy names are compared case-insensitively as written.

**Fixtures** — `rules/security/access-control/__tests__/pause-authority.fixtures.ts`.
