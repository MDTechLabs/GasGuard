# Rule-Level Confidence Calibration

Some rules are right almost every time, others mostly produce noise. Calibration turns reviewed
outcomes (true / false positive verdicts) into a per-rule track record and uses it to attach a
confidence value and band to each finding, so reports and gates can rank or filter by how much a
finding is likely to be real.

| Layer | Location |
| --- | --- |
| Calibrator (pure, engine) | `libs/engine/core/confidence-calibration.ts` |
| Fixtures | `tests/fixtures/confidence-calibration/` |
| Tests | `libs/engine/core/confidence-calibration.spec.ts` |

## Public interface

```ts
import {
  buildCalibrationProfiles,
  calibrateFindings,
  confidenceBand,
} from '@engine/core/confidence-calibration';

// 1. Aggregate one tenant's reviewed outcomes for the active rule pack.
const { profiles } = buildCalibrationProfiles(outcomes, { rulePackVersion: '2.1.0' });

// 2. Calibrate a scan's findings (normalized or raw; anything with a `ruleId`).
const result = calibrateFindings(findings, { profiles, rulePackVersion: '2.1.0', minConfidence: 0.3 });
result.findings;   // kept, in input order, each with metadata.confidence / confidenceBand / ...
result.suppressed; // below the threshold, still carrying their confidence
result.issues;     // every ignored profile, bad value or fallback
```

Each returned finding gets these `metadata` fields: `confidence` (0 to 1, 4 decimals),
`confidenceBand` (`high` / `medium` / `low`), `confidenceSource`, `calibrationSamples`, and
`rawConfidence` when the finding supplied one in `metadata.confidence`.

## Model

For a rule with `tp` true and `fp` false positives, prior `p` and prior strength `s`:

```
q          = (tp + p*s) / (tp + fp + s)                      smoothed true-positive rate
confidence = sigmoid(logit(r) + logit(q) - logit(p))         r = raw confidence, or p if absent
```

With no raw confidence the result is `q`. With one, the raw value is shifted by how far the rule's
record is from its prior, so an accurate rule raises it and a noisy rule lowers it, and the result
always stays in (0, 1). Rules with fewer than `minSamples` reviewed outcomes are not calibrated: the
finding keeps its raw confidence (`confidenceSource: "raw"`) or the prior (`"prior"`).

Worked example (prior 0.5, strength 10): 45 true and 5 false positives give `q = 50/60 = 0.8333`.
A finding with raw confidence 0.9 has odds 9, the rule's odds are 5, and the result is `45/46 = 0.9783`.

## Configuration

| Option | Default | Meaning |
| --- | --- | --- |
| `profiles` | `[]` | Per-rule `{ ruleId, truePositives, falsePositives, priorConfidence?, priorStrength?, rulePackVersion? }`. |
| `rulePackVersion` | none | When set, profiles recorded against another version are ignored (`STALE_PROFILE`). |
| `defaultPrior` | `0.5` | Prior for rules without their own. |
| `priorStrength` | `10` | Prior weight, in pseudo-observations. |
| `minSamples` | `5` | Reviewed outcomes needed before calibration applies. |
| `minConfidence` | `0` | Findings below this are moved to `suppressed`. `0` suppresses nothing. |
| `ruleOverrides` | `{}` | `{ [ruleId]: { confidence?, minConfidence? } }`. `confidence` pins the value (`source: "override"`); `minConfidence` replaces the global threshold for that rule. |
| `bandThresholds` | `{ high: 0.8, medium: 0.5 }` | Inclusive lower bounds of the bands. Must satisfy `0 <= medium < high <= 1`. |

## Failure semantics

The calibrator never throws for bad data; it ignores the bad part, falls back to defaults and
records an issue.

| Situation | Behavior |
| --- | --- |
| Profile with bad counts, prior or strength | Ignored, `INVALID_PROFILE`. The rule is treated as having no history. |
| Profile for another rule-pack version | Ignored, `STALE_PROFILE`. |
| Several profiles for one rule | The one with the most samples is kept, `DUPLICATE_PROFILE`. |
| Raw `metadata.confidence` outside [0, 1] or not a number | Ignored, `INVALID_CONFIDENCE`. |
| Finding without a `ruleId` | Gets the default prior, `MISSING_RULE_ID`. |
| Invalid config value | Default used, `INVALID_CONFIG`. |
| Malformed review outcome | Skipped, `INVALID_OUTCOME`. |
| Unknown rule or no outcomes | Not an error: raw confidence or prior, `source` says which. |

## Determinism, retries and tenancy

- Pure function: no I/O, clock or state. The same findings, profiles and config always give
  identical output, regardless of profile order. Retrying a failed job is safe.
- Idempotent: calibrating findings that were already calibrated gives the same result, because the
  original raw confidence is kept in `rawConfidence`.
- Tenant isolation is by construction: only the outcomes and profiles passed in are used. Build
  profiles from one tenant's reviews and cache them per tenant, rule-pack version and review window.
- Persist profiles (or the outcomes) with the rule-pack version they were computed for. Reproducing
  a result needs the same commit, config and rule-pack version.

## Backward compatibility

Additive. Without config, findings only gain `confidence*` metadata; nothing is suppressed and no
existing field changes. Consumers that do not read the new metadata see no difference.
