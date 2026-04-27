/**
 * Result Differ
 * 
 * Compares two sets of analysis results to track changes over time.
 */

import { AnalysisResult } from '../../analysis/filter/analysis-filter';
import { ScanDiff } from './types';

export class ResultDiffer {
  /**
   * Compare previous results with current results
   */
  diff(previous: AnalysisResult[], current: AnalysisResult[]): ScanDiff {
    const prevMap = this.createIssueMap(previous);
    const currMap = this.createIssueMap(current);

    const newIssues: AnalysisResult[] = [];
    const fixedIssues: AnalysisResult[] = [];
    const persistentIssues: AnalysisResult[] = [];

    // Find new and persistent issues
    for (const [key, issue] of currMap.entries()) {
      if (prevMap.has(key)) {
        persistentIssues.push(issue);
      } else {
        newIssues.push(issue);
      }
    }

    // Find fixed issues (present in previous but not in current)
    for (const [key, issue] of prevMap.entries()) {
      if (!currMap.has(key)) {
        fixedIssues.push(issue);
      }
    }

    return {
      newIssues,
      fixedIssues,
      persistentIssues,
      summary: {
        added: newIssues.length,
        removed: fixedIssues.length,
        unchanged: persistentIssues.length,
        delta: newIssues.length - fixedIssues.length
      }
    };
  }

  /**
   * Create a unique key for an issue
   * For simplicity, we use ruleId, filePath, and line.
   */
  private createIssueKey(issue: AnalysisResult): string {
    return `${issue.ruleId}:${issue.filePath}:${issue.line}`;
  }

  /**
   * Convert an array of issues into a map for fast lookup
   */
  private createIssueMap(issues: AnalysisResult[]): Map<string, AnalysisResult> {
    const map = new Map<string, AnalysisResult>();
    for (const issue of issues) {
      map.set(this.createIssueKey(issue), issue);
    }
    return map;
  }
}
