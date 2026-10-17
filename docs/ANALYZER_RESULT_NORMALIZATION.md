# Analyzer Result Normalization

Analyzers report findings in slightly different shapes: backslash paths, `./` prefixes, severity
spellings such as `ERROR` or `warning`, inverted or zero-based line ranges, flat `file`/`line`
fields, and duplicate reports. Normalization converts any analyzer output into one canonical,
deterministic shape before it reaches persistence or reporting.

| Layer | Location |
| --- | --- |
| Normalizer (pure, engine) | `libs/engine/core/result-normalizer.ts` |
| Worker integration | `apps/api/src/scanner/command-injection-scan.job.ts` |
| Fixtures | `tests/fixtures/result-normalization/` |
| Tests | `libs/engine/core/result-normalizer.spec.ts` |

## Public interface

```ts
import { normalizeAnalysisResult, normalizeFindings } from '@engine/core/result-normalizer';

const normalized = normalizeAnalysisResult(analyzerResult, {
  analyzerName: 'command-injection',
  rootDir: '/workspace/job-123', // optional
});
```

- `normalizeAnalysisResult(raw, options)` returns a `NormalizedAnalysisResult`
  (`schemaVersion`, `findings`, `summary`, `errors`, `issues`, `counts`, `telemetry`).
- `normalizeFindings(rawFindings, options)` normalizes only a findings array.
- `normalizeFindingPath` and `normalizeSeverity` are exported for reuse.

## Rules

| Field | Behavior |
| --- | --- |
| `ruleId` | Trimmed. Missing or empty: finding dropped (`MISSING_RULE_ID`). |
| `location.file` | Repository-relative, `/` separators, `.`/empty segments removed, `..` resolved. Traversal above the root, absolute paths outside `rootDir`, empty paths and control characters: finding dropped (`INVALID_PATH`). Host paths never reach stored results. |
| `severity` | Case-insensitive, with aliases (`error`→high, `warning`/`warn`→medium, `note`/`hint`→info, …). Unknown values use `fallbackSeverity` (default `info`) and report `UNKNOWN_SEVERITY`. |
| lines | Integers `>= 1`. Fractions are floored. An invalid `startLine` becomes `1` (`INVALID_LINE`). `endLine < startLine` becomes `startLine`. Legacy `location.line` and flat `file`/`line` are accepted. |
| columns | Invalid values are ignored (`INVALID_COLUMN`). `endColumn` is dropped when there is no `startColumn`, and clamped to `startColumn` on a single line. |
| `message` | CRLF becomes LF, trimmed, truncated to `maxMessageLength` (default 2000). Empty: the `ruleId` is used (`EMPTY_MESSAGE`). |
| `estimatedGasSavings` | Must be a finite number `>= 0`, otherwise removed (`INVALID_GAS_SAVINGS`). |
| `metadata` | Copied as JSON-safe data with sorted keys. Functions, `undefined` and non-finite numbers are removed. |
| duplicates | Same rule, location and message produce one finding (highest severity wins). Counted in `counts.duplicates`. |
| `summary`, `totalEstimatedGasSavings` | Recomputed from the normalized findings, never trusted from the analyzer. |

## Determinism

Findings are sorted by file, start line, start column, rule id, severity (most severe first), then
key. Each finding gets a `key`: the first 32 hex chars of a sha256 over rule, location and message.
The same findings in any order, with any timing, give byte-identical output. Run-dependent values
(`analysisTime`, `memoryUsage`, `incremental`) are moved to `telemetry` and are excluded from this
guarantee. Normalizing an already normalized result changes nothing.

## Failure semantics

- The normalizer is **pure and never throws**. It does no I/O, uses no clock and keeps no shared
  state, so it is safe per tenant and safe to retry.
- **Unsupported input**: a non-object result gives an empty result with a `MALFORMED_RESULT` issue.
  A non-array `findings` field is treated the same way.
- **Partial failure**: a bad finding is dropped (`issues[].dropped === true`) or repaired
  (`dropped === false`). Other findings are unaffected. Callers should log `counts` and decide
  whether `counts.dropped > 0` should mark a scan `partial`.
- **Issue volume**: `issues` is capped at `maxIssues` (default 100). `counts.issues` is always exact.
- **Retries**: because output depends only on input and options, a retried job produces the same
  findings and the same `key`s, so persistence stays idempotent.

## Configuration

| Option | Default | Purpose |
| --- | --- | --- |
| `fallbackSeverity` | `info` | Severity for unknown or missing values. |
| `maxMessageLength` | `2000` | Message truncation limit. |
| `rootDir` | none | Strip this absolute prefix from absolute paths. Anything outside it is rejected. |
| `maxIssues` | `100` | Limit on recorded issues. |
| `analyzerName` | none | Carried through to the result (`normalizeAnalysisResult` only). |

## Backward compatibility

- `schemaVersion` is `1`. Additive fields will not bump it. Removing or renaming fields will.
- Accepted legacy input shapes: `location.line`, flat `file`/`filePath`/`line`, and the severity
  aliases above.
- The command-injection scan outcome gains an additive `normalization` object
  (`droppedFindings`, `duplicateFindings`, `issues`). Existing outcome fields are unchanged.
- Other scan jobs (deserialization, redirect) are unchanged. Adopt normalization by passing the
  analyzer result through `normalizeAnalysisResult` before persisting.
