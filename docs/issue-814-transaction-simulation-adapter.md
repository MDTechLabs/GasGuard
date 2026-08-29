# Soroban Transaction Simulation Adapter (closes #814)

## Problem
GasGuard currently only estimates Soroban resource usage statically, via the
formulas in `docs/soroban-cost-model-spec.md` and the fee logic in
`packages/gas-estimator/stellar/fee-estimator.ts`. Static estimates drift
from reality; the RPC's own `simulateTransaction` result is the ground
truth we should be able to compare against (see #815).

## Design
New package `packages/soroban/simulation/` (mirrors the existing
`packages/gas-estimator/stellar` layout: `index.ts`, `types.ts`,
`simulation-adapter.ts`, `__tests__/`):

```ts
interface SimulationRequest {
  contractId: string; functionName: string; args: unknown[]; networkPassphrase: string;
}
interface SimulationResult {
  cpuInstructions: number; memoryBytes: number; ledgerReads: number; ledgerWrites: number;
  transactionSizeBytes: number; minResourceFee: string /* stroops */; raw: unknown; // for #816
}
class SorobanSimulationAdapter {
  constructor(rpcUrl: string);
  buildRequest(contract, fn, args): SimulationRequest;
  async simulate(req: SimulationRequest): Promise<SimulationResult | SimulationFailure>;
}
```

The adapter calls Soroban RPC `simulateTransaction`, normalizing the
response's `cost`/`transactionData` fields into the CPU/memory/ledger
dimensions used by the static model, so downstream code
(`packages/gas-estimator/stellar/types.ts`) never branches on source.
XDR envelope build/submit glue lives in `packages/integrations/stellar/`,
following `packages/stellar-sdk`'s existing boundary (SDK wrapper stays
separate from analysis packages). `tests/soroban/simulation/` holds
fixture-response tests (recorded RPC payloads), per
`docs/RULE_TESTING_FRAMEWORK.md`.

## Acceptance Criteria
- [ ] `SorobanSimulationAdapter.buildRequest` builds a valid simulation request
- [ ] Supported transactions can be submitted via `simulate()`
- [ ] Successful responses are normalized into `SimulationResult`
- [ ] Failed responses are returned as a distinct type, not thrown, for #816 to classify
