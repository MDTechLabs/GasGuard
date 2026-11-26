# Post-mortem benchmark

`tests/benchmarks/post-mortem/` checks the Solidity analyzer against minimal reproductions of
vulnerable patterns from public incidents, and against fixed controls that must stay clean.

## What it runs

- `post-mortem-cases.ts` lists the cases. Each has an incident name, the vulnerability class,
  the source, the rules that must fire (`expectedRules`), and the rules that must not fire
  (`forbiddenRules`).
- `post-mortem-benchmark.spec.ts` runs the `SolidityAnalyzer` on every case and checks:
  - **recall**: every expected rule is reported;
  - **false positives**: no forbidden rule is reported;
  - **determinism**: two runs produce identical findings;
  - the case ids are unique.

Run it with `npx jest tests/benchmarks/post-mortem`.

## Current cases

| Case | Kind | Rules checked |
| --- | --- | --- |
| `the-dao-2016-reentrancy` | vulnerable | `sol-006` must fire |
| `tx-origin-wallet-authorisation` | vulnerable | `sol-014` must fire |
| `the-dao-guarded-control` | control | `sol-006` must not fire |

The cases are reconstructions written from the public description of each bug. They are not
copies of deployed code.

## Not covered

These patterns are not in the benchmark, because the current detectors cannot express them
reliably:

- **Parity-style unprotected initialisation** of a library-backed wallet (2017). It depends on
  delegatecall and initialiser-access semantics that no rule models.
- **Cross-contract reentrancy** through shared state. Rules only look inside a single function.
- **Oracle manipulation and flash-loan attacks.** These need economic context, not syntax.
- **Compiler-version-specific behaviour** beyond what is written in the source.

Add a case only with its public reference, a minimal reproduction, and the rules it should
trigger.

## Adding a case

1. Cite the incident by name and date in `incident`.
2. Keep the reproduction minimal. Do not include code from an exploited contract.
3. Add a `control` case for each fix, so a detector that flags everything fails.
4. Run the benchmark and fix the detector, or move the pattern to "Not covered" with a reason.
