/**
 * Analysis Filter
 * 
 * Filters analysis results to reduce false positives and apply suppressions
 */

export interface AnalysisResult {
  ruleId: string;
  filePath: string;
  line: number;
  message: string;
  confidence: number; // 0.0 to 1.0
}

export interface SuppressionRule {
  ruleId?: string;
  filePath?: string;
  line?: number;
  reason?: string;
}

export class AnalysisFilter {
  private suppressions: SuppressionRule[] = [];
  private minConfidence: number = 0.5;

  /**
   * Add a suppression rule
   */
  addSuppression(suppression: SuppressionRule): void {
    this.suppressions.push(suppression);
  }

  /**
   * Set minimum confidence threshold
   */
  setConfidenceThreshold(threshold: number): void {
    this.minConfidence = threshold;
  }

  /**
   * Filter analysis results
   */
  filter(results: AnalysisResult[]): AnalysisResult[] {
    return results.filter(result => {
      // 1. Check confidence threshold
      if (result.confidence < this.minConfidence) {
        return false;
      }

      // 2. Check suppressions
      for (const suppression of this.suppressions) {
        const ruleMatches = !suppression.ruleId || suppression.ruleId === result.ruleId;
        const fileMatches = !suppression.filePath || suppression.filePath === result.filePath;
        const lineMatches = !suppression.line || suppression.line === result.line;

        if (ruleMatches && fileMatches && lineMatches) {
          return false; // Result is suppressed
        }
      }

      return true;
    });
  }
}
