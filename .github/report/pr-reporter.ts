import { Injectable, Logger } from '@nestjs/common';

export interface FindingSummaryItem {
  ruleId: string;
  severity: 'high' | 'medium' | 'low';
  message: string;
  contractPath: string;
}

export interface PullRequestAnalysisReport {
  pullRequestId: number;
  repository: string;
  newFindings: FindingSummaryItem[];
  resolvedFindings: FindingSummaryItem[];
  resourceChanges: {
    estimatedCpuDelta: number;
    estimatedMemoryDelta: number;
    estimatedStorageCostDelta: number;
  };
  optimizationOpportunitiesCount: number;
}

@Injectable()
export class GasGuardPullRequestReporter {
  private readonly logger = new Logger(GasGuardPullRequestReporter.name);

  public generateMarkdownSummary(report: PullRequestAnalysisReport): string {
    this.logger.debug(`Generating markdown summary for PR #${report.pullRequestId}`);

    const newFindingsList = report.newFindings.length > 0
      ? report.newFindings.map(f => `- **[${f.severity.toUpperCase()}]** \`${f.ruleId}\` in \`${f.contractPath}\`: ${f.message}`).join('\n')
      : '_No new findings detected._';

    const resolvedFindingsList = report.resolvedFindings.length > 0
      ? report.resolvedFindings.map(f => `- \`${f.ruleId}\` in \`${f.contractPath}\`: ${f.message}`).join('\n')
      : '_No resolved findings._';

    return `## 🛡️ GasGuard Pull Request Analysis
    
### Resource & Cost Impact
| Metric | Change | Status |
| :--- | :--- | :--- |
| **Estimated CPU Delta** | \`${report.resourceChanges.estimatedCpuDelta >= 0 ? '+' : ''}${report.resourceChanges.estimatedCpuDelta} instructions\` | ${report.resourceChanges.estimatedCpuDelta <= 0 ? '🟢 Improved' : '⚠️ Increased'} |
| **Estimated Memory Delta** | \`${report.resourceChanges.estimatedMemoryDelta >= 0 ? '+' : ''}${report.resourceChanges.estimatedMemoryDelta} bytes\` | ${report.resourceChanges.estimatedMemoryDelta <= 0 ? '🟢 Improved' : '⚠️ Increased'} |
| **Storage Cost Delta** | \`${report.resourceChanges.estimatedStorageCostDelta >= 0 ? '+' : ''}${report.resourceChanges.estimatedStorageCostDelta} stroops\` | ${report.resourceChanges.estimatedStorageCostDelta <= 0 ? '🟢 Improved' : '⚠️ Increased'} |

---

### 🚨 New Findings (${report.newFindings.length})
${newFindingsList}

### ✅ Resolved Findings (${report.resolvedFindings.length})
${resolvedFindingsList}

> **Optimization Opportunities:** ${report.optimizationOpportunitiesCount} actionable recommendations available for review.
`;
  }
}