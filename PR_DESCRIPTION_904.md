# Detect Overloaded Soroban Entry Points (#904)

## Summary

This pull request implements the **Soroban Overloaded Entry-Point Analyzer** and detection rules under Issue #904. Entry points that handle excessive responsibilities (complex branching, high cognitive nesting, excessive storage reads/writes, multiple external contract calls) increase execution costs, consume transaction CPU/metering budget, and become difficult to audit and maintain safely. This implementation measures entry-point complexity, tracks storage and external call resources, provides configurable complexity thresholds, and surfaces overloaded entry points with actionable refactoring guidance.

## What Changed

### 1. Soroban Complexity Analyzer (`packages/analyzers/soroban/complexity/`)
- **`types.ts`**: Complete type definitions for `ComplexityMetrics` (cyclomatic, cognitive, LOC, branches, loops, nesting depth, parameters), `StorageResourceMetrics` (reads, writes, TTLs, unique keys, loop storage ops), `ExternalCallResourceMetrics` (raw cross-contract calls, typed client calls, token transfers, mint/burn, balance queries, calls in loops), `ComplexityThresholds`, `OverloadFinding`, and `ComplexityReport`.
- **`complexity-analyzer.ts`**:
  - Implements `SorobanComplexityAnalyzer` and `analyzeEntryPointComplexity(source, filePath?, thresholds?)`.
  - Calculates McCabe Cyclomatic Complexity (`if`, `match` arms, `while`, `for`, `loop`, `&&`, `||`, `?` error propagation).
  - Calculates Cognitive Complexity with nesting depth penalties.
  - Measures structural metrics: non-empty Lines of Code (LOC), statements, parameter counts.
  - Tracks storage operations: instance, persistent, temporary reads, writes, TTL extensions, distinct accessed keys, and storage operations executed inside loops.
  - Tracks external calls: `env.invoke_contract`, typed `TokenClient` and `<Contract>Client` invocations, token transfers/mints/burns, balance queries, and calls inside loops.
  - Computes composite overload scores (0–100) and hazard penalties.
  - Generates executive summaries and contract-wide aggregate metrics (`averageCyclomaticComplexity`, `averageLinesOfCode`, `totalStorageOperations`, `totalExternalCalls`, `mostComplexEntryPoint`).
- **`index.ts`**: Re-exports types and analyzer.
- **`__tests__/complexity-analyzer.spec.ts`**: 10 unit tests covering complexity measurement, storage & external call tracking, overload detection, threshold overrides, and edge cases.

### 2. Soroban Entry-Point Rules (`packages/rules/soroban/entrypoints/`)
- **`types.ts`**:
  - Added `'soroban-overloaded-entry-point'` rule ID to `EntryPointRuleId`.
  - Defined `OverloadedEntryPointRuleReport` and updated `EntryPointRuleFinding` with dimensional metrics (`dimension`, `metricValue`, `threshold`).
- **`entry-point-rule.ts`**:
  - Implemented `detectOverloadedEntryPoints(source, thresholds?)` and `validateEntryPointComplexity(source, thresholds?)`.
  - Integrated complexity and overload findings into `detectEntryPointIssues` for unified entry-point scanning.
- **`index.ts`**: Updated header and re-exports.
- **`__tests__/overloaded-entry-point-rule.spec.ts`**: 5 unit tests covering clean vs overloaded contracts, dimensional findings, custom thresholds, and integration with `detectEntryPointIssues`.

## Requirements & Acceptance Criteria Checklist

- [x] **Complex entry points detected**: Accurately flags functions handling excessive responsibilities via `soroban-overloaded-entry-point`.
- [x] **Complexity measured**: Measures cyclomatic complexity, cognitive complexity, lines of code, and parameter counts.
- [x] **Resource-heavy operations reported**: Tracks and reports storage reads/writes, unique keys, cross-contract calls, and token invocations (including operations in loops).
- [x] **Configurable complexity thresholds**: Supports custom threshold overrides (`maxCyclomaticComplexity`, `maxCognitiveComplexity`, `maxLinesOfCode`, `maxStorageOperations`, `maxStorageWrites`, `maxExternalCalls`, `maxParameters`, `maxOverloadScore`).
- [x] **Tests added**: 15 new test cases added across complexity analyzer and overloaded entry-point rule test suites (40 total passing tests).

## Verification

```text
=== RUNNING SOROBAN COMPLEXITY ANALYZER SPEC ===
  ✓ measures low complexity for clean and modular entry points
  ✓ measures high cyclomatic and cognitive complexity in branched entry points
  ✓ tracks lines of code and statement counts accurately
  ✓ tracks storage operations count, reads, writes, and unique keys
  ✓ tracks external and cross-contract call volume
  ✓ flags overloaded entry point with specific findings and recommendations
  ✓ generates informative executive summary and aggregate metrics
  ✓ honors strict custom thresholds to flag smaller functions
  ✓ honors relaxed custom thresholds to suppress findings
  ✓ handles empty contracts gracefully

=== RUNNING OVERLOADED ENTRY-POINT RULE SPEC ===
  ✓ reports no overloaded entry points for modular contracts
  ✓ detects overloaded entry point handling excessive responsibilities
  ✓ respects custom threshold limits
  ✓ returns only complexity and overload findings
  ✓ includes overloaded entry point findings in full entry point report

=== RUNNING SOROBAN ENTRY-POINT ANALYZER SPEC ===
  ✓ identifies public entry points, constructors, and internal functions
  ✓ identifies entry points from trait implementations
  ✓ identifies standalone pub fn functions
  ✓ extracts parameters with types, flags, and doc comments
  ✓ extracts collection parameters and return types
  ✓ extracts mutable and reference parameters correctly
  ✓ tracks require_auth and maps authorized parameters
  ✓ tracks require_auth_for_args and extracts arguments
  ✓ detects unprotected state-mutating entry points
  ✓ detects authorization check inside loops
  ✓ detects redundant authorization checks
  ✓ tracks instance storage reads and writes with keys
  ✓ detects storage operations inside loops
  ✓ tracks TTL extensions on instance and persistent storage
  ✓ tracks cross-contract invocations
  ✓ tracks TokenClient and typed Client calls
  ✓ detects external calls inside loops
  ✓ generates accurate metrics and executive summary
  ✓ handles empty contract source gracefully

=== RUNNING ENTRY-POINT RULE SPEC ===
  ✓ returns 0 critical/high findings for clean contracts
  ✓ detects all entry point issue categories in vulnerable contract
  ✓ validateEntryPointAuthorization returns only authorization findings
  ✓ validateEntryPointExternalCalls returns only external call findings
  ✓ validateEntryPointStorage returns only storage findings
  ✓ behaves identically to detectEntryPointIssues

TOTAL: passed=40, failed=0
```

Closes #904
