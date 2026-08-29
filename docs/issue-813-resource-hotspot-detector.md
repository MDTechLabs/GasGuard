# Soroban Resource Hotspot Detector (closes #813)

## Problem
GasGuard's static cost model (`docs/soroban-cost-model-spec.md`) produces
per-contract CPU/memory/ledger scores, but developers still have to eyeball
which functions or source regions actually drive those totals. There is no
ranked, addressable list of "expensive" locations.

## Design
Add a new analyzer package `packages/analyzers/soroban/resources/hotspots/`
that consumes the per-function cost breakdown already produced by
`packages/rules/soroban/src/analyzer/wasm-inspector.ts` (which walks
`#[contractimpl]` blocks parsed the same way as
`packages/rules/src/soroban/parser.rs`) and re-aggregates it into hotspots:

```ts
interface ResourceHotspot {
  functionName: string;
  filePath: string;
  line: number;
  costDimension: 'cpu' | 'memory' | 'ledger'; // matches C_cpu/C_mem/C_ledger
  score: number;        // normalized 0-1, same scale as cost-model spec
  rank: number;
  relatedFindings: string[]; // RULE_IDs, e.g. SorobanStorageRentCheckRule.RULE_ID
}

class SorobanResourceHotspotDetector {
  static readonly RULE_ID = 'soroban-resource-hotspot';
  detect(costBreakdown: PerFunctionCost[]): ResourceHotspot[];
}
```

Ranking sorts descending by `score` per dimension, then merges overlapping
line ranges so a single expensive loop isn't reported as N separate
findings. Findings referencing the same function as existing rules (e.g.
`soroban-storage-rent`) get cross-linked via `relatedFindings` rather than
duplicated.

## Reporting
Output is exposed through `packages/reporting/soroban/`, appended to the
existing report shape as a `hotspots` array, matching how
`soroban-cost-model-spec.md` recommends aggregate scoring be surfaced.

## Acceptance Criteria
- [ ] `SorobanResourceHotspotDetector` ranks functions by normalized cost score per dimension
- [ ] Expensive source regions are identified with file/line
- [ ] Related findings from other Soroban rules are aggregated, not duplicated
- [ ] Hotspots are included in the Soroban analysis report output
