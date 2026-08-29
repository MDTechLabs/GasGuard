import { CoverageConfig, CoverageReport, RuleCoverageEntry } from './types';

export class SorobanCoverageReporter {
  private config: CoverageConfig;

  constructor(
    config: CoverageConfig = { minCoverageThreshold: 80, failOnLowCoverage: false, categories: ['security', 'gas', 'quality', 'best-practices'] },
  ) {
    this.config = config;
  }

  generateReport(rules: RuleCoverageEntry[]): CoverageReport {
    const totalRules = rules.length;
    const executedRules = rules.filter(r => r.executed).length;
    const coveragePercentage = totalRules > 0 ? Math.round((executedRules / totalRules) * 100) : 0;

    const byCategory: Record<string, { total: number; executed: number; percentage: number }> = {};
    for (const entry of rules) {
      if (!byCategory[entry.category]) {
        byCategory[entry.category] = { total: 0, executed: 0, percentage: 0 };
      }
      byCategory[entry.category].total++;
      if (entry.executed) byCategory[entry.category].executed++;
    }
    for (const cat of Object.keys(byCategory)) {
      byCategory[cat].percentage = Math.round((byCategory[cat].executed / byCategory[cat].total) * 100);
    }

    return {
      totalRules,
      executedRules,
      coveragePercentage,
      entries: rules,
      byCategory,
      summary: this.generateSummary(totalRules, executedRules, coveragePercentage, byCategory),
    };
  }

  private generateSummary(
    total: number,
    executed: number,
    percentage: number,
    byCategory: Record<string, { total: number; executed: number; percentage: number }>,
  ): string {
    const categories = Object.entries(byCategory)
      .map(([cat, data]) => `${cat}: ${data.percentage}% (${data.executed}/${data.total})`)
      .join(', ');

    const threshold = this.config.minCoverageThreshold;
    const status = percentage >= threshold ? 'PASS' : 'FAIL';

    return `Rule coverage: ${percentage}% (${executed}/${total}) — ${status}. Categories: ${categories}.`;
  }

  formatMarkdown(report: CoverageReport): string {
    const lines: string[] = [];
    lines.push('# Soroban Rule Coverage Report');
    lines.push('');
    lines.push(`**Overall Coverage:** ${report.coveragePercentage}% (${report.executedRules}/${report.totalRules} rules)`);
    lines.push('');

    lines.push('## By Category');
    lines.push('| Category | Coverage | Executed/Total |');
    lines.push('|----------|----------|----------------|');
    for (const [cat, data] of Object.entries(report.byCategory)) {
      lines.push(`| ${cat} | ${data.percentage}% | ${data.executed}/${data.total} |`);
    }
    lines.push('');

    lines.push('## Rule Details');
    lines.push('| Rule ID | Name | Category | Executed | Findings |');
    lines.push('|---------|------|----------|----------|----------|');
    for (const entry of report.entries) {
      lines.push(`| ${entry.ruleId} | ${entry.ruleName} | ${entry.category} | ${entry.executed ? 'Yes' : 'No'} | ${entry.findingsCount} |`);
    }
    lines.push('');
    lines.push('---');
    lines.push(report.summary);

    return lines.join('\n');
  }
}
