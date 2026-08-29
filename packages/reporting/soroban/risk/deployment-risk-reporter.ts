/**
 * Soroban Deployment Risk Report Generator
 *
 * Converts a `DeploymentRiskScore` into:
 *  1. A structured `DeploymentRiskReport` object (machine-readable)
 *  2. A Markdown string (human-readable, suitable for CI comments or dashboards)
 */

import {
  DeploymentRiskScore,
  FindingCategory,
  NormalizedFinding,
  RiskGrade,
  RiskLevel,
} from '../../../analyzers/soroban/risk/types';

// ─── Report shape ─────────────────────────────────────────────────────────

export interface CategorySummary {
  category: FindingCategory;
  count: number;
  contribution: number;
  ruleIds: string[];
}

export interface DeploymentRiskReport {
  /** ISO timestamp of when the report was generated */
  generatedAt: string;

  /** Contract / project identifier (optional, provided by the caller) */
  contractId?: string;

  score: {
    overall: number;
    grade: RiskGrade;
    riskLevel: RiskLevel;
  };

  categories: CategorySummary[];

  severitySummary: Record<string, number>;

  /** Most impactful findings for display */
  topFindings: Array<{
    ruleId: string;
    severity: string;
    category: string;
    message: string;
  }>;

  totalGasCost: number;
  explanation: string[];
  recommendations: string[];

  /** Raw score object for further processing */
  raw: DeploymentRiskScore;
}

// ─── Generator ────────────────────────────────────────────────────────────

export class DeploymentRiskReporter {
  /**
   * Build the structured report object from a scored result.
   */
  buildReport(
    score: DeploymentRiskScore,
    contractId?: string,
  ): DeploymentRiskReport {
    const categories: CategorySummary[] = (
      ['security', 'resource', 'deployment', 'optimization'] as FindingCategory[]
    ).map((cat) => ({
      category: cat,
      count: score.categoryBreakdown[cat].count,
      contribution: score.categoryBreakdown[cat].contribution,
      ruleIds: score.topFindings
        .filter((f) => f.category === cat)
        .map((f) => f.ruleId),
    }));

    return {
      generatedAt: new Date().toISOString(),
      contractId,
      score: {
        overall: score.overallScore,
        grade: score.grade,
        riskLevel: score.riskLevel,
      },
      categories,
      severitySummary: { ...score.severityCounts },
      topFindings: score.topFindings.map((f) => ({
        ruleId: f.ruleId,
        severity: f.severity,
        category: f.category,
        message: f.message,
      })),
      totalGasCost: score.totalGasCost,
      explanation: score.explanation,
      recommendations: score.recommendations,
      raw: score,
    };
  }

  /**
   * Render the report as a Markdown string.
   *
   * Example output:
   * ```
   * # 🔐 Soroban Deployment Risk Report
   * ...
   * ```
   */
  toMarkdown(report: DeploymentRiskReport): string {
    const lines: string[] = [];

    const riskEmoji = this.riskEmoji(report.score.riskLevel);

    lines.push('# 🔐 Soroban Deployment Risk Report');
    lines.push('');
    if (report.contractId) {
      lines.push(`**Contract:** \`${report.contractId}\``);
    }
    lines.push(`**Generated:** ${report.generatedAt}`);
    lines.push('');

    // ── Score banner ──────────────────────────────────────────────────────
    lines.push('## Overall Score');
    lines.push('');
    lines.push(
      `| Score | Grade | Risk Level |`,
    );
    lines.push(`|-------|-------|------------|`);
    lines.push(
      `| **${report.score.overall}/100** | **${report.score.grade}** | ${riskEmoji} **${capitalize(report.score.riskLevel)}** |`,
    );
    lines.push('');

    // ── Severity breakdown ─────────────────────────────────────────────────
    lines.push('## Severity Breakdown');
    lines.push('');
    lines.push(`| Severity | Count |`);
    lines.push(`|----------|-------|`);
    for (const [sev, count] of Object.entries(report.severitySummary)) {
      if (count > 0) {
        lines.push(`| ${this.severityEmoji(sev)} ${capitalize(sev)} | ${count} |`);
      }
    }
    lines.push('');

    // ── Category breakdown ─────────────────────────────────────────────────
    lines.push('## Category Breakdown');
    lines.push('');
    lines.push(`| Category | Findings | Score Contribution |`);
    lines.push(`|----------|----------|--------------------|`);
    for (const cat of report.categories) {
      if (cat.count > 0) {
        lines.push(`| ${capitalize(cat.category)} | ${cat.count} | ${cat.contribution} pts |`);
      }
    }
    lines.push('');

    // ── Top findings ──────────────────────────────────────────────────────
    if (report.topFindings.length > 0) {
      lines.push('## Top Findings');
      lines.push('');
      for (const f of report.topFindings) {
        lines.push(
          `- **[${f.ruleId}]** ${this.severityEmoji(f.severity)} \`${f.severity.toUpperCase()}\` *(${f.category})*: ${f.message}`,
        );
      }
      lines.push('');
    }

    // ── Gas cost ──────────────────────────────────────────────────────────
    if (report.totalGasCost > 0) {
      lines.push('## Estimated Gas Impact');
      lines.push('');
      lines.push(`⛽ Cumulative estimated cost across flagged patterns: **${report.totalGasCost.toLocaleString()} units**`);
      lines.push('');
    }

    // ── Explanation ───────────────────────────────────────────────────────
    lines.push('## Score Explanation');
    lines.push('');
    for (const line of report.explanation) {
      lines.push(`- ${line}`);
    }
    lines.push('');

    // ── Recommendations ───────────────────────────────────────────────────
    lines.push('## Recommendations');
    lines.push('');
    for (const rec of report.recommendations) {
      lines.push(`${rec}`);
      lines.push('');
    }

    return lines.join('\n');
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private riskEmoji(level: RiskLevel): string {
    const map: Record<RiskLevel, string> = {
      critical: '🔴',
      high: '🟠',
      medium: '🟡',
      low: '🟢',
      minimal: '✅',
    };
    return map[level] ?? '⚪';
  }

  private severityEmoji(severity: string): string {
    const map: Record<string, string> = {
      critical: '🔴',
      high: '🟠',
      medium: '🟡',
      low: '🔵',
      info: '⚪',
    };
    return map[severity.toLowerCase()] ?? '⚪';
  }
}

// ─── Utility ─────────────────────────────────────────────────────────────

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
