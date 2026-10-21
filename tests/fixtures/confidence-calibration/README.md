# Confidence calibration fixtures

Used by `libs/engine/core/confidence-calibration.spec.ts`.

| Fixture | Purpose |
| --- | --- |
| `realistic-review-history.json` | Reviewed outcomes for three rules (one accurate, one noisy, one with too little history) plus an older rule-pack version that must be ignored, and the findings of a new scan. |
| `regression-edge-cases.json` | Stale/invalid/duplicate profiles, saturated counts, invalid raw confidence, pinned and per-rule threshold overrides, and a finding without a `ruleId`. |
