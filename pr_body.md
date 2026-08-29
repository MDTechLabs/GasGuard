## Summary

This pull request implements the **Multi-Contract Execution Call-Graph Generator** (`CallGraphBuilder` and `GasTreeEvaluator`) under `src/analysis/graph/`. It parses multi-contract monorepo suites, constructs a directed execution call graph tracing cross-contract and internal function invocations, and evaluates cumulative gas expenditure down the entire call stack to pinpoint gas bottlenecks, recursive call loops, and deep call stacks.

## What Changed

- **`src/analysis/graph/call-graph-builder.ts`**:
  - **`CallGraphBuilder`**: Parses multi-contract import graphs and contract declarations (Solidity, Soroban Rust, Vyper).
  - Extracts function nodes (`CallGraphNode`) detailing visibility, state accesses (`SSTORE`/`SLOAD`/`storage`), base gas estimates, and source line locations.
  - Constructs call graph edges (`CallGraphEdge`) for internal calls, cross-contract calls, `delegatecall`, `staticcall`, and `env.invoke_contract()`.
  - Detects function calls executed inside `for` and `while` loops and applies execution loop multipliers.
  - Identifies public/external entry points.

- **`src/analysis/graph/gas-tree-evaluator.ts`**:
  - **`GasTreeEvaluator`**: Performs depth-first traversal (DFS) starting from each entry point down the execution call stack.
  - Calculates total cumulative gas incorporating base execution gas, call opcode overheads, and loop multipliers.
  - Detects recursive call cycles (e.g. `ContractA` -> `ContractB` -> `ContractA`) and deep call stack depths (> 5 hops).
  - Generates structured findings:
    - `HIGH_CUMULATIVE_GAS_EXCEEDED`: Cumulative gas expenditure exceeds safety threshold.
    - `DEEP_CALL_STACK_EXCEEDED`: Execution call stack depth exceeds maximum hops limit (63/64th gas rule risk).
    - `RECURSIVE_CALL_LOOP`: Recursive call cycles detected in execution path.
    - `EXPENSIVE_CROSS_CONTRACT_LOOP`: External function calls executed repeatedly inside loops.

- **`src/analysis/graph/call-graph-builder.spec.ts` & `gas-tree-evaluator.spec.ts`**:
  - Unit test suite verifying multi-contract file parsing, node/edge creation, entry point identification, loop detection, cumulative gas estimation, recursion cycle detection, and high-gas threshold warnings.

- **`src/analysis/graph/index.ts`**:
  - Re-exported `CallGraphBuilder`, `GasTreeEvaluator`, and associated types.

## Why

Single-function analyzers miss gas bottlenecks caused by deep external call trees, recursive contract loops, and expensive cross-contract state queries. This multi-contract execution call graph generator allows GasGuard to trace execution paths across entire contract suites and calculate total cumulative gas usage.

## Testing Performed

- [x] Added 8 unit tests in `call-graph-builder.spec.ts` and `gas-tree-evaluator.spec.ts` (100% pass rate).
- [x] Verified full Rust test suite `cargo test -p gasguard-rules` (104/104 tests passing).
- [x] Tested cross-contract calls, recursion detection, loop multipliers, and threshold limit enforcement.

## Edge Cases Considered

- Unconnected or orphan contract functions with no callers.
- Recursive call loops (e.g., A -> B -> A) causing potential infinite stack traversal (handled gracefully with cycle detection).
- External calls nested within `for`/`while` loops.
- Contracts with multiple external entry points.

## Risks

None. This is an additive feature in `src/analysis/graph/`.

Closes #604
