# Static-to-Simulation Cost Comparison (closes #815)

## Problem
GasGuard produces static estimates (`docs/soroban-cost-model-spec.md`,
`packages/gas-estimator/stellar/fee-estimator.ts`) and, once #814 lands,
real simulation results via `packages/soroban/simulation/`. Nothing today
tells a developer whether the static model over- or under-predicts actual
usage for their contract, which undermines trust in the static score.

## Design
New module `packages/analyzers/soroban/comparison/`, depending on both
`packages/soroban/simulation/` (for `SimulationResult`) and the existing
static cost outputs:

```ts
interface CostComparison {
  functionName: string;
  dimension: 'cpu' | 'memory' | 'ledger'; // same three dimensions as the cost model spec
  estimated: number;
  simulated: number;
  variancePct: number;      // (simulated - estimated) / estimated * 100
  significant: boolean;     // |variancePct| exceeds configurable threshold
}

class StaticSimulationComparator {
  constructor(private thresholdPct = 15);
  compare(estimated: PerFunctionCost, simulated: SimulationResult): CostComparison[];
}
```

Variance is computed per-dimension using the same C_cpu/C_mem/C_ledger
breakdown documented in `docs/soroban-cost-model-spec.md`, so a deviation
can be traced back to the specific constant (e.g.
`feeRatePerInstructionsIncrement`) that diverged. Deviations beyond
`thresholdPct` are flagged `significant: true` and escalated the same way
`SorobanResourceHotspotDetector` (#813) escalates high-cost functions, so
the two features share a `relatedFindings` shape in the report.

## Reporting
Comparison results are appended to the Soroban report alongside hotspots,
under a `costComparison` key, via `packages/reporting/soroban/`.

## Acceptance Criteria
- [ ] Estimated (static) and simulated resource values are compared per dimension
- [ ] Percentage variance is calculated per function/dimension
- [ ] Deviations beyond the configurable threshold are flagged as significant
- [ ] Comparison results are included in the analysis report
