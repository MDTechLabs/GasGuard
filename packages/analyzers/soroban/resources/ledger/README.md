# @gasguard/analyzer-soroban-ledger

Soroban Ledger Read and Write Cost Analyzer for GasGuard.

## Overview

In Soroban smart contracts on the Stellar network, ledger operations (reads and writes) directly impact:
1. **Ledger Read/Write Byte Footprints** - metered directly by the host environment.
2. **Transaction Fees (Stroops)** - proportional to ledger entries accessed and written.
3. **State Rent / TTL Extension** - persistent/temporary storage rent allocation.

This package provides static analysis engines to detect, track, and optimize:
- **Soroban Ledger Read Costs**: Repeated reads, loops containing storage reads, read-heavy functions.
- **Soroban Ledger Write Costs**: Repeated state mutations, writes in loops, dead stores, high write frequency.

## Usage

```typescript
import { SorobanLedgerCostAnalyzer } from '@gasguard/analyzer-soroban-ledger';

const analyzer = new SorobanLedgerCostAnalyzer();
const report = analyzer.analyze(contractSourceCode);

console.log(report.summary);
console.log(report.readAnalysis.suggestions);
console.log(report.writeAnalysis.suggestions);
```
