# Role Revocation Rules

This document describes the role revocation behavior for the Soroban property-token contract.

## Scope

The contract maintains two permission layers:

- `ADMIN`: the single administrative authority stored as a dedicated state item
- `AUTHORIZED_ROLES`: a map of additional addresses that may perform privileged actions

## Revocation Rules

1. Only the current `ADMIN` may change permissions.
2. Revoking a role removes the address from `AUTHORIZED_ROLES` entirely.
3. The contract rejects revocation requests for addresses that were never granted a role.
4. Legacy `AUTHORIZED_ROLES[address] = false` tombstones are treated as revocable stale state and are removed when revoked again.
5. The admin role cannot be cleared. Admin control can only change through an explicit `new_admin` replacement value.
6. Empty or whitespace-only principals are rejected for both role updates and admin changes.
7. Duplicate updates for the same address in a single config change are rejected to avoid ambiguous final state.

## Auditability

Every successful `UpdateConfig` execution emits attributes for:

- the actor performing the change
- whether the admin changed
- the current admin after the change
- granted role count and address list
- revoked role count and address list

These attributes provide an on-chain audit trail for permission changes.

## Operational Notes

- `CleanupStorage` remains available to remove legacy `false` tombstones that may still exist from older deployments.
- `SelfCheck` reports legacy tombstones as a failure until they are removed.
- Revoking an address from `AUTHORIZED_ROLES` does not clear the dedicated `ADMIN` value. Admin transfer must be done explicitly.