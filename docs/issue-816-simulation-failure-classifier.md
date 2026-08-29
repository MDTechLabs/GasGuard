# Soroban Simulation Failure Classifier (closes #816)

## Problem
Once `packages/soroban/simulation/` (#814) can submit real
`simulateTransaction` calls, some will fail — bad auth, exceeded resource
limits, invalid footprint, host trap, etc. The raw RPC error payload is not
actionable for a developer reading a GasGuard report.

## Design
New module `packages/soroban/simulation/errors/`, consuming the
`SimulationFailure` variant returned by `SorobanSimulationAdapter.simulate`
(#814):

```ts
type SimulationFailureCategory =
  | 'resource_limit_exceeded'  // instructions/memory/footprint over network limits
  | 'invalid_footprint'        // missing/incorrect read-write footprint
  | 'auth_failed'               // signature/auth entry rejected
  | 'host_trap'                 // contract panicked / trapped during execution
  | 'network_error'             // RPC unreachable, timeout, malformed response
  | 'unknown';

interface ClassifiedFailure {
  category: SimulationFailureCategory;
  explanation: string;   // developer-facing, actionable text
  originalError: unknown; // untouched `raw` field from SimulationResult/failure
}

class SorobanSimulationFailureClassifier {
  static readonly RULE_ID = 'soroban-simulation-failure';
  classify(failure: SimulationFailure): ClassifiedFailure;
}
```

Classification matches known Soroban RPC error codes/messages (e.g.
`UnknownError`, `ExceededLimit`, host trap codes) via a pattern table,
analogous to how `storage-rent-check.ts` matches source patterns via
keyword lists — same "known patterns, fallback to `unknown`" approach,
applied to RPC errors instead of source text. Classified failures surface
in `packages/reporting/soroban/` next to hotspots (#813) and cost
comparisons (#815), so a failed simulation still yields a useful report
entry instead of aborting the run.

## Acceptance Criteria
- [ ] Simulation failure categories are defined (resource limit, footprint, auth, trap, network, unknown)
- [ ] Known failure responses are parsed into the correct category
- [ ] Original RPC error details are preserved unmodified in `originalError`
- [ ] An actionable, developer-facing explanation is generated per category
