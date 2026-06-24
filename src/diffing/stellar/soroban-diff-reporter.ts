/**
 * Soroban Diff Reporter
 * 
 * Generates human-readable summaries of changes between Soroban contract scans.
 * Highlights added and removed issues with detailed breakdowns.
 */

import { SorobanScanDiff, SorobanDiffReportOptions } from './types';

export class SorobanDiffReporter {
  /**
   * Generate a text-based summary of the diff
   */
  generateSummary(diff: SorobanScanDiff, options?: SorobanDiffReportOptions): string {
    const { added, removed, delta, bySeverity, byCategory } = diff.summary;
    let output = '=== Soroban Scan Diff Summary ===\n\n';

    // Overall status
    if (delta < 0) {
      output += `✨ Improvement: ${Math.abs(delta)} issues resolved!\n`;
    } else if (delta > 0) {
      output += `⚠️ Regression: ${delta} new issues detected.\n`;
    } else {
      output += '✅ No change in issue count.\n';
    }

    output += `\n[+] Added: ${added}\n`;
    output += `[-] Fixed: ${removed}\n`;
    output += `[=] Persistent: ${diff.summary.unchanged}\n\n`;

    // Severity breakdown
    output += '--- Severity Breakdown ---\n';
    output += `Errors: +${bySeverity.error.added} / -${bySeverity.error.removed}\n`;
    output += `Warnings: +${bySeverity.warning.added} / -${bySeverity.warning.removed}\n`;
    output += `Info: +${bySeverity.info.added} / -${bySeverity.info.removed}\n\n`;

    // Category breakdown
    output += '--- Category Breakdown ---\n';
    for (const [category, stats] of Object.entries(byCategory)) {
      output += `${category}: +${stats.added} / -${stats.removed}\n`;
    }
    output += '\n';

    // New issues
    if (diff.newIssues.length > 0) {
      output += '=== NEW ISSUES ===\n';
      const sortedIssues = this.sortAndGroupIssues(diff.newIssues, options);
      output += this.formatIssues(sortedIssues, 'NEW');
      output += '\n';
    }

    // Fixed issues
    if (diff.fixedIssues.length > 0) {
      output += '=== FIXED ISSUES ===\n';
      const sortedIssues = this.sortAndGroupIssues(diff.fixedIssues, options);
      output += this.formatIssues(sortedIssues, 'FIXED');
      output += '\n';
    }

    // Persistent issues (optional)
    if (options?.includePersistent && diff.persistentIssues.length > 0) {
      output += '=== PERSISTENT ISSUES ===\n';
      const sortedIssues = this.sortAndGroupIssues(diff.persistentIssues, options);
      output += this.formatIssues(sortedIssues, 'PERSISTENT');
      output += '\n';
    }

    return output;
  }

  /**
   * Generate a JSON report of the diff
   */
  generateJsonReport(diff: SorobanScanDiff): string {
    return JSON.stringify(diff, null, 2);
  }

  /**
   * Generate a markdown report of the diff
   */
  generateMarkdownReport(diff: SorobanScanDiff, options?: SorobanDiffReportOptions): string {
    const { added, removed, delta, bySeverity, byCategory } = diff.summary;
    let output = '# Soroban Scan Diff Report\n\n';

    // Overall status
    const statusEmoji = delta < 0 ? '✨' : delta > 0 ? '⚠️' : '✅';
    const statusText = delta < 0 
      ? `Improvement: ${Math.abs(delta)} issues resolved!` 
      : delta > 0 
        ? `Regression: ${delta} new issues detected.` 
        : 'No change in issue count.';
    
    output += `${statusEmoji} ${statusText}\n\n`;

    // Summary table
    output += '## Summary\n\n';
    output += '| Metric | Count |\n';
    output += '|--------|-------|\n';
    output += `| Added | ${added} |\n`;
    output += `| Fixed | ${removed} |\n`;
    output += `| Persistent | ${diff.summary.unchanged} |\n`;
    output += `| Delta | ${delta > 0 ? '+' : ''}${delta} |\n\n`;

    // Severity breakdown
    output += '## Severity Breakdown\n\n';
    output += '| Severity | Added | Removed |\n';
    output += '|----------|-------|--------|\n';
    output += `| Error | ${bySeverity.error.added} | ${bySeverity.error.removed} |\n`;
    output += `| Warning | ${bySeverity.warning.added} | ${bySeverity.warning.removed} |\n`;
    output += `| Info | ${bySeverity.info.added} | ${bySeverity.info.removed} |\n\n`;

    // Category breakdown
    output += '## Category Breakdown\n\n';
    output += '| Category | Added | Removed |\n';
    output += '|----------|-------|--------|\n';
    for (const [category, stats] of Object.entries(byCategory)) {
      output += `| ${category} | ${stats.added} | ${stats.removed} |\n`;
    }
    output += '\n';

    // New issues
    if (diff.newIssues.length > 0) {
      output += '## New Issues\n\n';
      output += this.formatIssuesMarkdown(diff.newIssues, 'NEW', options);
    }

    // Fixed issues
    if (diff.fixedIssues.length > 0) {
      output += '## Fixed Issues\n\n';
      output += this.formatIssuesMarkdown(diff.fixedIssues, 'FIXED', options);
    }

    return output;
  }

  /**
   * Sort and group issues based on options
   */
  private sortAndGroupIssues(issues: any[], options?: SorobanDiffReportOptions): Map<string, any[]> {
    const groupBy = options?.groupBy || 'contract';
    const groups = new Map<string, any[]>();

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
        default:
          key = issue.contractName;
      }

      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(issue);
    }

    // Sort within groups if needed
    if (options?.sortBy) {
      for (const [key, groupIssues] of groups.entries()) {
        groups.set(key, this.sortBy(groupIssues, options.sortBy));
      }
    }

    return groups;
  }

  /**
   * Sort issues by specified criteria
   */
  private sortBy(issues: any[], sortBy: string): any[] {
    const sorted = [...issues];

    switch (sortBy) {
      case 'severity':
        const severityOrder: Record<string, number> = { error: 0, warning: 1, info: 2 };
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
   * Format issues as text
   */
  private formatIssues(groupedIssues: Map<string, any[]>, status: string): string {
    let output = '';

    for (const [groupKey, issues] of groupedIssues.entries()) {
      output += `\n${groupKey}:\n`;
      for (const issue of issues) {
        const severityIcon = this.getSeverityIcon(issue.severity);
        const functionInfo = issue.function ? ` in ${issue.function}()` : '';
        output += `  [${status}] ${severityIcon} ${issue.ruleId}: ${issue.message}\n`;
        output += `       Location: ${issue.filePath}:${issue.line}${functionInfo}\n`;
        output += `       Confidence: ${(issue.confidence * 100).toFixed(0)}%\n`;
      }
    }

    return output;
  }

  /**
   * Format issues as markdown
   */
  private formatIssuesMarkdown(issues: any[], status: string, options?: SorobanDiffReportOptions): string {
    let output = '';

    const sortedIssues = options?.sortBy ? this.sortBy(issues, options.sortBy) : issues;

    for (const issue of sortedIssues) {
      const severityIcon = this.getSeverityIcon(issue.severity);
      const functionInfo = issue.function ? ` in \`${issue.function}()\`` : '';
      const severityBadge = this.getSeverityBadge(issue.severity);
      
      output += `### ${severityIcon} ${issue.ruleId} ${severityBadge}\n\n`;
      output += `- **Status**: ${status}\n`;
      output += `- **Contract**: ${issue.contractName}\n`;
      output += `- **Location**: ${issue.filePath}:${issue.line}${functionInfo}\n`;
      output += `- **Message**: ${issue.message}\n`;
      output += `- **Confidence**: ${(issue.confidence * 100).toFixed(0)}%\n`;
      output += `- **Category**: ${issue.category}\n\n`;
    }

    return output;
  }

  /**
   * Get icon for severity level
   */
  private getSeverityIcon(severity: string): string {
    switch (severity) {
      case 'error':
        return '🔴';
      case 'warning':
        return '🟡';
      case 'info':
        return '🔵';
      default:
        return '⚪';
    }
  }

  /**
   * Get markdown badge for severity level
   */
  private getSeverityBadge(severity: string): string {
    switch (severity) {
      case 'error':
        return '<span style="color:red">ERROR</span>';
      case 'warning':
        return '<span style="color:orange">WARNING</span>';
      case 'info':
        return '<span style="color:blue">INFO</span>';
      default:
        return 'UNKNOWN';
    }
  }
}
