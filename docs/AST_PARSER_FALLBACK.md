# AST Parser Fallback Strategy

A single parser failing should not cost a whole file. New syntax, a half-edited file, a parser bug
or a timeout can all make the preferred parser reject input that an analyzer could still use in
part. The fallback chain tries parser strategies in order for each file, returns the best tree it
can get, and records exactly what happened, so degraded results are visible and never silent.

| Layer | Location |
| --- | --- |
| Fallback chain and lexical outline (pure, engine) | `libs/engine/core/ast-parser-fallback.ts` |
| Fixtures | `tests/fixtures/ast-parser-fallback/` |
| Tests | `libs/engine/core/ast-parser-fallback.spec.ts` |

## Public interface

```ts
import {
  parseWithFallback,
  createLexicalOutlineStrategy,
  TransientParserError,
} from '@engine/core/ast-parser-fallback';

const result = await parseWithFallback(
  [{ path: 'contracts/Vault.sol', content: '...' }],
  [strictSolidityParser, recoveringSolidityParser, createLexicalOutlineStrategy()],
  { timeoutMs: 5000, requireComplete: false },
);

for (const file of result.files) {
  if (file.status === 'degraded') {
    // file.ast is usable but file.complete may be false; file.attempts says why.
  }
}
```

A strategy is `{ name, languages, maxBytes?, parse(source, { path, language }) }`. `parse` may be
sync or async and returns `{ ast, complete?, diagnostics? }`. `complete: false` marks a partial
tree (a recovering parser, an outline). Register strategies most faithful first.

## Selection rules

1. The first strategy returning a complete tree wins. The file is `parsed` if that was the first
   strategy tried, `degraded` if an earlier one failed (`fallbackUsed: true`).
2. A partial tree is remembered and the chain continues in case a later strategy completes.
3. If none completes, the earliest partial tree is returned as `degraded` (`complete: false`).
   With `requireComplete: true` the file is `failed` instead, for gates that need a full tree.
4. A file whose language no strategy supports is `unsupported`; a file larger than `maxFileBytes`
   is `skipped`; if every strategy fails the file is `failed`. None of these produce an AST, so an
   analyzer can never mistake them for an empty file.

`strategyOrder` overrides the order per language by strategy name. `disabledStrategies` removes
strategies without changing the registered list.

## Built-in lexical outline

`createLexicalOutlineStrategy()` never fails on text input. For Solidity, Rust and Vyper it blanks
comments and strings, matches braces (or indentation for Vyper) and returns an `OutlineAst` of
declarations with line ranges: top-level contracts, functions, structs, enums, events, errors,
traits, modules and constants, plus functions and events inside contracts, interfaces, libraries,
`impl`, `trait` and `mod` blocks. It always reports `complete: false` with a `lexical_outline`
warning, plus `unterminated_block` / `unmatched_close_brace` errors for unbalanced files.
Its default `maxBytes` (20 MiB) is higher than typical parsers', so large files that strict
parsers skip still get an outline.

## Configuration

| Option | Default | Meaning |
| --- | --- | --- |
| `timeoutMs` | `5000` | Budget per attempt. |
| `maxAttemptsPerStrategy` | `2` | Attempts for *transient* errors only. |
| `maxFileBytes` | 5 MiB | Larger files are `skipped`. |
| `maxDiagnosticsPerFile` | `50` | Diagnostics beyond this are dropped. |
| `requireComplete` | `false` | Fail instead of returning a partial tree. |
| `strategyOrder` | none | `{ [language]: [strategy names] }`. |
| `disabledStrategies` | `[]` | Strategy names to skip. |
| `languageOf` | by extension | Custom path to language mapping. A source can also set `language`. |
| `rootDir` | none | Absolute root used to relativize absolute input paths. |

## Failure semantics

| Situation | Behavior |
| --- | --- |
| Strategy throws | Attempt `error`; next strategy. Not retried: parsers are deterministic. |
| `TransientParserError` (or `error.transient === true`) | Attempt `transient-error`; retried up to `maxAttemptsPerStrategy`. |
| Strategy exceeds `timeoutMs` | Attempt `timeout`; next strategy. A synchronous parser cannot be interrupted, so its result is discarded. |
| Strategy returns no `ast` | Attempt `invalid-output`; next strategy. |
| File larger than a strategy's `maxBytes` | Attempt `skipped-size`; next strategy. |
| Invalid path, duplicate path or duplicate strategy name | File or strategy dropped, reported in `issues`. |
| Invalid option or unknown name in `strategyOrder` | Default used or name ignored, `INVALID_CONFIG` / `UNKNOWN_STRATEGY`. |

`parseWithFallback` never throws for bad input. Error text is truncated to one line (200 chars) and
diagnostics are reduced to code, line, column and message, so file content is not copied into
results. Diagnostics map directly onto `ParserRecoveryDiagnostics` (`apps/api/src/scanner`).

## Determinism, retries and tenancy

- Files are processed in path order, one at a time. The result depends only on sources, strategies
  and options, never on input order. Run-dependent data lives in `telemetry`. A timeout is the one
  machine-dependent outcome; it is visible per file in `attempts` and counted in `summary.timedOut`.
- Retrying a whole job is safe; there is no module state or I/O. Cache by commit, options and the
  versions of the strategies in the chain.
- Strategies are supplied per call, so each tenant or job can have its own chain, and the chain
  only sees the sources passed in.

## Using the result

`status`, `complete` and `strategy` tell an analyzer how much to trust the tree. Rules that need
full syntax should skip `complete: false` files and say so; rules that work from declarations can
use an outline. A common policy is to treat findings from degraded files with lower confidence,
for example with a `ruleOverrides` entry in rule-level confidence calibration.

## Backward compatibility

Additive. Existing analyzers and parsers are untouched; a parser joins the chain by being wrapped
as a strategy. Without a chain, behavior is unchanged.
