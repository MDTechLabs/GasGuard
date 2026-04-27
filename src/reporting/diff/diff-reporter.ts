/**
 * Diff Reporter
 * 
 * Generates human-readable summaries of changes between scans.
 */

import { ScanDiff } from './types';

export class DiffReporter {
  /**
   * Generate a text-based summary of the diff
   */
  generateSummary(diff: ScanDiff): string {
    const { added, removed, delta } = diff.summary;
    let output = '--- Scan Diff Summary ---\n';
    
    if (delta < 0) {
      output += `✨ Improvement: ${Math.abs(delta)} issues resolved!\n`;
    } else if (delta > 0) {
      output += `⚠️ Regression: ${delta} new issues detected.\n`;
    } else {
      output += '✅ No change in issue count.\n';
    }

    output += `[+] Added: ${added}\n`;
    output += `[-] Fixed: ${removed}\n`;
    output += `[=] Persistent: ${diff.summary.unchanged}\n`;

    if (diff.newIssues.length > 0) {
      output += '\nNew Issues:\n';
      diff.newIssues.forEach(issue => {
        output += `  [NEW] ${issue.ruleId} at ${issue.filePath}:${issue.line}\n`;
      });
    }

    if (diff.fixedIssues.length > 0) {
      output += '\nFixed Issues:\n';
      diff.fixedIssues.forEach(issue => {
        output += `  [FIXED] ${issue.ruleId} at ${issue.filePath}:${issue.line}\n`;
      });
    }

    return output;
  }
}
