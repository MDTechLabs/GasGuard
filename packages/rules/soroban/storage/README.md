# @gasguard/rules-soroban-storage

Soroban Storage Rules for GasGuard.

## Rules Included

- `SOROBAN_STORAGE_LEDGER_READ_COST`: Detects un-cached repeated storage reads and storage reads nested inside loops.
- `SOROBAN_STORAGE_LEDGER_WRITE_COST`: Detects redundant intermediate state mutations and writes nested inside loops.
