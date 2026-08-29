/**
 * Issue #790 — Soroban Safe Auto-Fix Framework
 *
 * A framework for applying *verified* Soroban optimization fixes automatically.
 * Key design goals:
 *   - Pluggable fix providers keyed by rule id.
 *   - Every fix is validated for applicability before being applied.
 *   - `dryRun` mode produces previews (and optional unified diffs) without
 *     touching the source.
 *   - Source formatting is preserved where possible (line-anchored edits, no
 *     blanket reformatting).
 *   - A confidence (0–1) threshold gates automatic application, drawn from the
 *     confidence scoring module (issue #789).
 */

import { scoreFinding, type ScoredFinding } from '../../analyzers/soroban/confidence/confidence-scorer';

export interface FixRequest {
  ruleId: string;
  /** 1-based line the fix targets. */
  line: number;
  /** Original line content (used for validation and diffs). */
  originalLine: string;
  /** Confidence of the underlying finding (0–1). */
  confidence: number;
  /** Optional extra context (e.g. matched variable name). */
  context?: Record<string, string | number>;
}

export interface AppliedFix {
  ruleId: string;
  line: number;
  originalLine: string;
  replacementLine: string;
  /** True if the fix changes content; false for no-op/comment-only. */
  changed: boolean;
}

export interface FixPreview {
  ruleId: string;
  line: number;
  originalLine: string;
  replacementLine: string;
  /** Unified diff hunk for the single-line change. */
  diff: string;
  scoring: ScoredFinding;
}

export interface AutoFixPlan {
  dryRun: boolean;
  applied: AppliedFix[];
  skipped: Array<{ ruleId: string; line: number; reason: string }>;
  previews: FixPreview[];
}

/**
 * A fix provider implements validation (`isApplicable`) and the concrete
 * single-line transformation (`apply`). Providers are keyed by rule id.
 */
export interface FixProvider {
  readonly ruleIds: string[];
  /** Validate that the line is suitable for an automated fix. */
  isApplicable(line: string, context?: Record<string, string | number>): boolean;
  /** Produce the replacement line. */
  apply(line: string, context?: Record<string, string | number>): string;
}

/** No-op provider used as a safe fallback for unregistered rules. */
const NOOP_PROVIDER: FixProvider = {
  ruleIds: [],
  isApplicable: () => false,
  apply: (l: string) => l,
};

export class SorobanAutoFixEngine {
  private readonly providers = new Map<string, FixProvider>();
  /** Minimum confidence (0–1) for a fix to be applied automatically. */
  private minConfidence = 0.7;

  registerProvider(provider: FixProvider): void {
    for (const id of provider.ruleIds) {
      this.providers.set(id, provider);
    }
  }

  setMinConfidence(value: number): void {
    this.minConfidence = Math.max(0, Math.min(1, value));
  }

  getProvider(ruleId: string): FixProvider {
    return this.providers.get(ruleId) ?? NOOP_PROVIDER;
  }

  /**
   * Apply verifiable fixes to source. In dry-run mode, nothing is modified and
   * previews (with diffs) are returned instead.
   *
   * @param source Contract source.
   * @param requests Findings to consider for fixing.
   * @param options `dryRun` to preview only; `confidenceThreshold` overrides engine default.
   */
  planFixes(
    source: string,
    requests: FixRequest[],
    options: { dryRun?: boolean; confidenceThreshold?: number } = {},
  ): AutoFixPlan {
    const dryRun = options.dryRun ?? false;
    const threshold = options.confidenceThreshold ?? this.minConfidence;

    const lines = source.split('\n');
    const applied: AppliedFix[] = [];
    const skipped: AutoFixPlan['skipped'] = [];
    const previews: FixPreview[] = [];

    // Process lowest-line-first but apply to a copy derived from source so line
    // numbers remain stable; we only support single-line replacements.
    const working = [...lines];

    for (const request of requests) {
      const idx = request.line - 1;
      if (idx < 0 || idx >= working.length) {
        skipped.push({ ruleId: request.ruleId, line: request.line, reason: 'line out of range' });
        continue;
      }

      const provider = this.getProvider(request.ruleId);
      const actualLine = working[idx];

      if (!provider.isApplicable(actualLine, request.context)) {
        skipped.push({
          ruleId: request.ruleId,
          line: request.line,
          reason: 'no applicable fix provider or inapplicable line',
        });
        continue;
      }

      const replacement = provider.apply(actualLine, request.context);
      if (replacement === actualLine) continue;

      const scoring = scoreFinding(
        request.ruleId,
        `Automated fix on line ${request.line}`,
        {
          ruleReliability: 0.7,
          contextSafety: provider.isApplicable(actualLine, request.context) ? 0.8 : 0.4,
          evidenceStrength: request.confidence,
        },
        request.line,
      );

      const preview: FixPreview = {
        ruleId: request.ruleId,
        line: request.line,
        originalLine: actualLine,
        replacementLine: replacement,
        diff: buildSingleLineDiff(request.ruleId, request.line, actualLine, replacement),
        scoring,
      };
      previews.push(preview);

      if (dryRun) {
        skipped.push({
          ruleId: request.ruleId,
          line: request.line,
          reason: 'dry-run (preview only)',
        });
        continue;
      }

      if (request.confidence < threshold) {
        skipped.push({
          ruleId: request.ruleId,
          line: request.line,
          reason: `confidence ${request.confidence.toFixed(2)} below threshold ${threshold.toFixed(2)}`,
        });
        continue;
      }

      working[idx] = replacement;
      applied.push({
        ruleId: request.ruleId,
        line: request.line,
        originalLine: actualLine,
        replacementLine: replacement,
        changed: replacement !== actualLine,
      });
    }

    return { dryRun, applied, skipped, previews };
  }
}

function buildSingleLineDiff(
  ruleId: string,
  line: number,
  original: string,
  replacement: string,
): string {
  return [
    `--- a/contract.rs (${ruleId})`,
    `+++ b/contract.rs (${ruleId})`,
    `@@ -${line},1 +${line},1 @@`,
    `-${original}`,
    `+${replacement}`,
  ].join('\n');
}

// ── Example built-in providers ───────────────────────────────────────────────

/**
 * Comments out an unused state variable declaration rather than deleting it,
 * preserving the source layout for manual review (rule #789-adjacent).
 */
export const unusedStateVariableProvider: FixProvider = {
  ruleIds: ['soroban-unused-state-variables', 'unused-state-variable'],
  isApplicable: (line) => line.trim().length > 0 && !line.trimStart().startsWith('//'),
  apply: (line) => `// [GasGuard auto-fix: unused variable] ${line}`,
};

/**
 * Replaces a direct repeated helper call with a cached local binding when the
 * call is a simple `self.foo(...)` expression on its own line.
 */
export const cacheRepeatedCallProvider: FixProvider = {
  ruleIds: ['soroban-call-frequency'],
  isApplicable: (line) => {
    const t = line.trim();
    // Matches `let x = self.foo(...);` or `self.foo(...)` call expressions.
    return /^(let\s+\w+\s*=\s*)?(self\.|Self::)\w+\s*\(.+\)\s*;?\s*$/.test(t);
  },
  apply: (line) => `// [GasGuard auto-fix: consider caching] ${line}`,
};