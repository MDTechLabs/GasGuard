# Unchecked custom-error and revert paths

Rule ID: `unchecked-revert-paths`

Entry point: `detectUncheckedRevertPaths` in
[`rules/security/error-handling/detect-unchecked-revert-paths.ts`](../../rules/security/error-handling/detect-unchecked-revert-paths.ts).

The detector uses the shared Solidity source sanitizer and lexical helpers. It does not invoke a
Solidity compiler, inspect AST/IR, execute repository code, or run package/build scripts.

## Supported input and limitations

- Solidity 0.8.x source text, one source file per analysis. Compiler versions and settings are
  not consulted, and source pragmas do not select a parser.
- Custom errors are available from Solidity 0.8.4; on older 0.8.x compilers, use an explicit
  `require` or revert reason instead.
- Only assertions directly using a named parameter, `msg.sender`, `msg.value`, `msg.data`, or
  `tx.origin` in a public/external function are considered caller-controlled.
- Empty catches and catches containing only event emissions are reported. Safe recovery logic,
  helpers, and state changes across function boundaries are not analyzed.
- Malformed or oversized source is returned through shared validation diagnostics without
  throwing. No untrusted project code is run.

## Findings

| Finding | Severity | Meaning |
| --- | --- | --- |
| `assert used for caller-controlled input` | Medium | An externally callable function uses an assertion on a direct caller-controlled value. Use explicit validation and an appropriate custom error/revert. |
| `Caught external revert is silently accepted` | Medium for an empty catch; low for a logging-only catch | A `try/catch` failure path neither reverts nor returns an explicit failure result, so callers may proceed without the external operation succeeding. |

Use `assert` for internal invariants rather than user-input validation. For caught errors,
propagate failure data when appropriate, return an explicit failure result, or perform a clearly
documented recovery action. These findings are static review prompts, not proof that subsequent
state is inconsistent.

Focused cases are in
[`rules/security/error-handling/__tests__/detect-unchecked-revert-paths.spec.ts`](../../rules/security/error-handling/__tests__/detect-unchecked-revert-paths.spec.ts).
They were not executed as requested.
