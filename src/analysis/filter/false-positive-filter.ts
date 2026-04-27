/**
 * False Positive Reduction System (#245)
 *
 * Adds a filtering layer with rule tuning to minimize incorrect detections.
 */

import { AnalysisResult, SuppressionRule } from './analysis-filter';

export interface RuleTuning {
  ruleId: string;
  confidenceBoost?: number; // positive or negative adjustment
  enabled: boolean;
}

export interface FalsePositiveFilterConfig {
  minConfidence: number;
  ruleTunings: RuleTuning[];
  suppressions: SuppressionRule[];
}

export class FalsePositiveFilter {
  private config: FalsePositiveFilterConfig;

  constructor(config: Partial<FalsePositiveFilterConfig> = {}) {
    this.config = {
      minConfidence: config.minConfidence ?? 0.6,
      ruleTunings: config.ruleTunings ?? [],
      suppressions: config.suppressions ?? [],
    };
  }

  /**
   * Tune a specific rule's confidence threshold or enable/disable it.
   */
  tuneRule(tuning: RuleTuning): void {
    const existing = this.config.ruleTunings.findIndex(t => t.ruleId === tuning.ruleId);
    if (existing >= 0) {
      this.config.ruleTunings[existing] = tuning;
    } else {
      this.config.ruleTunings.push(tuning);
    }
  }

  /**
   * Add a suppression rule to silence specific findings.
   */
  addSuppression(suppression: SuppressionRule): void {
    this.config.suppressions.push(suppression);
  }

  /**
   * Apply false positive reduction to a list of analysis results.
   */
  reduce(results: AnalysisResult[]): AnalysisResult[] {
    return results
      .map(result => this.applyTuning(result))
      .filter(result => result !== null && this.passes(result as AnalysisResult)) as AnalysisResult[];
  }

  private applyTuning(result: AnalysisResult): AnalysisResult | null {
    const tuning = this.config.ruleTunings.find(t => t.ruleId === result.ruleId);
    if (!tuning) return result;
    if (!tuning.enabled) return null;

    return {
      ...result,
      confidence: Math.min(1, Math.max(0, result.confidence + (tuning.confidenceBoost ?? 0))),
    };
  }

  private passes(result: AnalysisResult): boolean {
    if (result.confidence < this.config.minConfidence) return false;

    for (const s of this.config.suppressions) {
      const ruleMatch = !s.ruleId || s.ruleId === result.ruleId;
      const fileMatch = !s.filePath || s.filePath === result.filePath;
      const lineMatch = !s.line || s.line === result.line;
      if (ruleMatch && fileMatch && lineMatch) return false;
    }

    return true;
  }
}
