import { Injectable, Logger } from '@nestjs/common';

export interface CodeReviewFinding {
  ruleId: string;
  severity: 'high' | 'medium' | 'low';
  message: string;
  recommendation: string;
  confidenceScore: number; // 0.0 to 1.0
  location: {
    contractPath: string;
    line: number;
    column?: number;
  };
}

export interface PullRequestReviewComment {
  path: string;
  line: number;
  body: string;
}

@Injectable()
export class GasGuardReviewCommentGenerator {
  private readonly logger = new Logger(GasGuardReviewCommentGenerator.name);

  public generateComment(finding: CodeReviewFinding): PullRequestReviewComment {
    this.logger.debug(`Generating review comment for rule ${finding.ruleId} at ${finding.location.contractPath}:${finding.location.line}`);

    const severityBadge = this.getSeverityBadge(finding.severity);
    const confidencePercentage = Math.round(finding.confidenceScore * 100);

    const body = `### ${severityBadge} GasGuard Analysis: \`${finding.ruleId}\`

**Issue:** ${finding.message}

**Recommendation:** ${finding.recommendation}

---
*Confidence: ${confidencePercentage}% | Powered by [GasGuard](https://github.com/MDTechLabs/GasGuard)*`;

    return {
      path: finding.location.contractPath,
      line: finding.location.line,
      body,
    };
  }

  private getSeverityBadge(severity: 'high' | 'medium' | 'low'): string {
    switch (severity) {
      case 'high':
        return '🚨 [High]';
      case 'medium':
        return '⚠️ [Medium]';
      case 'low':
        return 'ℹ️ [Low]';
    }
  }
}