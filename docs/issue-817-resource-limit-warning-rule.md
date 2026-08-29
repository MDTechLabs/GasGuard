# Soroban Resource Limit Warning Rule (#817)

## Problem
Soroban contracts are metered against per-transaction and per-ledger limits
(`txMaxInstructions`, `ledgerMaxInstructions`, and ledger read/write/bandwidth
caps documented in `docs/soroban-cost-model-spec.md`). A contract that stays
under these caps in dev/test can still fail in production once real state
size or call depth grows. GasGuard currently has no rule that estimates a
contract's proximity to these caps and warns before deployment.

## Design
Add a new rule `SorobanResourceLimitWarningRule` (RULE_ID:
`soroban-resource-limit-warning`) alongside the existing
`SorobanStorageRentCheckRule` in `packages/rules/soroban/src/`, exported from
`packages/rules/soroban/src/index.ts`.

- **Thresholds**: a `ResourceThresholds` config object (CPU instructions,
  memory bytes, ledger read/write entry counts) with defaults derived from
  the constants in `docs/soroban-cost-model-spec.md`, overridable per-project
  (mirrors how `estimatedRentSavings` is optional/configurable on
  `StorageRentWarning`).
- **Comparison**: reuse the estimation output already produced by
  `packages/gas-estimator/stellar/fee-estimator.ts` (`fee-estimator.ts`,
  `types.ts`) as the source of estimated resource usage per dimension.
- **Severity**: map `usage / threshold` ratio to `info` (<70%), `warning`
  (70-90%), `critical` (>90%), following the existing warning-object shape
  (`line`, `message`, `suggestion`) used by `StorageRentWarning`.
- **Output shape**:
  ```ts
  interface ResourceLimitWarning {
    resource: 'cpu' | 'memory' | 'ledgerReads' | 'ledgerWrites' | 'txSize';
    estimated: number;
    threshold: number;
    severity: 'info' | 'warning' | 'critical';
    suggestion: string;
  }
  ```

## Acceptance Criteria
- [ ] Rule defined with configurable `ResourceThresholds`
- [ ] Estimated usage compared against each threshold dimension
- [ ] Severity levels assigned per the ratio bands above
- [ ] Each warning includes a remediation `suggestion` string
