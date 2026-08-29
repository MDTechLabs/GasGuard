/**
 * Soroban Result Differ
 * 
 * Compares two sets of Soroban contract analysis results to track changes over time.
 * Provides detailed diffing with severity and category breakdowns.
 */

import { SorobanAnalysisResult, SorobanScanDiff } from './types';

export class SorobanResultDiffer {
  /**
   * Compare previous results with current results
   */
  diff(previous: SorobanAnalysisResult[], current: SorobanAnalysisResult[]): SorobanScanDiff {
    const prevMap = this.createIssueMap(previous);
    const currMap = this.createIssueMap(current);

    const newIssues: SorobanAnalysisResult[] = [];
    const fixedIssues: SorobanAnalysisResult[] = [];
    const persistentIssues: SorobanAnalysisResult[] = [];

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

    // Calculate severity breakdown
    const bySeverity = this.calculateSeverityBreakdown(newIssues, fixedIssues);
    
    // Calculate category breakdown
    const byCategory = this.calculateCategoryBreakdown(newIssues, fixedIssues);

    return {
      newIssues,
      fixedIssues,
      persistentIssues,
      summary: {
        added: newIssues.length,
        removed: fixedIssues.length,
        unchanged: persistentIssues.length,
        delta: newIssues.length - fixedIssues.length,
        bySeverity,
        byCategory
      }
    };
  }

  /**
   * Create a unique key for a Soroban issue
   * Uses contractName, ruleId, function (if present), filePath, and line
   */
  private createIssueKey(issue: SorobanAnalysisResult): string {
    const functionPart = issue.function ? `:${issue.function}` : '';
    return `${issue.contractName}:${issue.ruleId}${functionPart}:${issue.filePath}:${issue.line}`;
  }

  /**
   * Convert an array of issues into a map for fast lookup
   */
  private createIssueMap(issues: SorobanAnalysisResult[]): Map<string, SorobanAnalysisResult> {
    const map = new Map<string, SorobanAnalysisResult>();
    for (const issue of issues) {
      map.set(this.createIssueKey(issue), issue);
    }
    return map;
  }

  /**
   * Calculate breakdown by severity
   */
  private calculateSeverityBreakdown(
    newIssues: SorobanAnalysisResult[],
    fixedIssues: SorobanAnalysisResult[]
  ) {
    const breakdown = {
      error: { added: 0, removed: 0 },
      warning: { added: 0, removed: 0 },
      info: { added: 0, removed: 0 }
    };

    newIssues.forEach(issue => {
      breakdown[issue.severity].added++;
    });

    fixedIssues.forEach(issue => {
      breakdown[issue.severity].removed++;
    });

    return breakdown;
  }

  /**
   * Calculate breakdown by category
   */
  private calculateCategoryBreakdown(
    newIssues: SorobanAnalysisResult[],
    fixedIssues: SorobanAnalysisResult[]
  ): Record<string, { added: number; removed: number }> {
    const breakdown: Record<string, { added: number; removed: number }> = {};

    newIssues.forEach(issue => {
      if (!breakdown[issue.category]) {
        breakdown[issue.category] = { added: 0, removed: 0 };
      }
      breakdown[issue.category].added++;
    });

    fixedIssues.forEach(issue => {
      if (!breakdown[issue.category]) {
        breakdown[issue.category] = { added: 0, removed: 0 };
      }
      breakdown[issue.category].removed++;
    });

    return breakdown;
  }

  /**
   * Sort issues by specified criteria
   */
  sortIssues(
    issues: SorobanAnalysisResult[],
    sortBy: 'severity' | 'confidence' | 'contract'
  ): SorobanAnalysisResult[] {
    const sorted = [...issues];

    switch (sortBy) {
      case 'severity':
        const severityOrder = { error: 0, warning: 1, info: 2 };
        sorted.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
        break;
      case 'confidence':
        sorted.sort((a, b) => b.confidence - a.confidence);
        break;
      case 'contract':
        sorted.sort((a, b) => a.contractName.localeCompare(b.contractName));
        break;
    }

    return sorted;
  }

  /**
   * Group issues by specified criteria
   */
  groupIssues(
    issues: SorobanAnalysisResult[],
    groupBy: 'contract' | 'rule' | 'severity' | 'category'
  ): Map<string, SorobanAnalysisResult[]> {
    const groups = new Map<string, SorobanAnalysisResult[]>();

    for (const issue of issues) {
      let key: string;
      switch (groupBy) {
        case 'contract':
          key = issue.contractName;
          break;
        case 'rule':
          key = issue.ruleId;
          break;
        case 'severity':
          key = issue.severity;
          break;
        case 'category':
          key = issue.category;
          break;
      }

      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(issue);
    }

    return groups;
  }
}
