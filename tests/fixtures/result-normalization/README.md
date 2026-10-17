# Result Normalization Fixtures

- `realistic-mixed-output.json` — raw output as several analyzers emit it today: Windows
  separators, `./` prefixes, severity aliases (`ERROR`, `warning`), inverted line ranges,
  legacy flat `file`/`line` fields, near-duplicate findings, CRLF messages.
- `regression-malformed-findings.json` — regression case: findings that must be dropped
  (no rule id, path traversal, absolute host path, non-objects) or repaired (line 0,
  unknown severity, empty message, negative gas savings, fractional line) without
  failing the whole result.
