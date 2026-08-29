/**
 * Issue #932 — Soroban Deployment Risk Score Reporter
 *
 * Generates explainable, actionable reports for Soroban contract deployment risk.
 * Produces GitHub-flavored Markdown, PR comments, CLI text summaries, and JSON.
 */

import {
  CategoryRiskSummary,
  DeploymentRiskFinding,
  DeploymentRiskScore,
  RiskCategory,
  RiskLevel,
  RiskSeverity,
} from '../../../analyzers/soroban/risk/types';
import { FormattedRiskReport, ReportFormat, RiskReportOptions } from './types';

export const DEFAULT_REPORT_OPTIONS: RiskReportOptions = {
  format: 'markdown',
  includeRemediation: true,
  includeChecklist: true,
  maxFindingsPerCategory: 5,
  collapseDetailsThreshold: 8,
  targetNetwork: 'mainnet',
};

export class SorobanDeploymentRiskReporter {
  private readonly options: RiskReportOptions;

  constructor(customOptions: RiskReportOptions = {}) {
    this.options = { ...DEFAULT_REPORT_OPTIONS, ...customOptions };
  }

  /**
   * Format the risk score into the requested output format.
   */
  public report(
    riskScore: DeploymentRiskScore,
    overrideOptions?: RiskReportOptions,
  ): FormattedRiskReport {
    const opts = { ...this.options, ...(overrideOptions ?? {}) };
    const format: ReportFormat = opts.format ?? 'markdown';

    let content: string;
    switch (format) {
      case 'json':
        content = this.generateJsonReport(riskScore, opts);
        break;
      case 'pr-comment':
        content = this.formatPrRiskComment(riskScore, opts);
        break;
      case 'cli-summary':
        content = this.generateCliSummary(riskScore, opts);
        break;
      case 'markdown':
      default:
        content = this.generateMarkdownReport(riskScore, opts);
        break;
    }

    return {
      format,
      content,
      summary: riskScore.rationale,
      riskLevel: riskScore.riskLevel,
      compositeScore: riskScore.compositeScore,
      readyForDeployment: riskScore.readyForDeployment,
      blockers: riskScore.blockers,
    };
  }

  /**
   * Generates a comprehensive GitHub-flavored Markdown report.
   */
  public generateMarkdownReport(
    riskScore: DeploymentRiskScore,
    options: RiskReportOptions = {},
  ): string {
    const opts = { ...this.options, ...options };
    const lines: string[] = [];

    const title = opts.contractName
      ? `## 🛡️ Soroban Deployment Risk Assessment: \`${opts.contractName}\``
      : '## 🛡️ Soroban Deployment Risk Assessment';

    lines.push(title);
    lines.push('');

    // Status Banner / Badge
    const badge = this.getRiskBadge(riskScore.riskLevel, riskScore.compositeScore);
    const clearance = riskScore.readyForDeployment
      ? '✅ **READY FOR DEPLOYMENT**'
      : '❌ **DEPLOYMENT BLOCKED**';

    lines.push(`| Status | Risk Score | Risk Level | Target Network |`);
    lines.push(`| :--- | :---: | :---: | :---: |`);
    lines.push(
      `| ${clearance} | **${riskScore.compositeScore} / 100** | ${badge} | \`${opts.targetNetwork ?? 'mainnet'}\` |`,
    );
    lines.push('');

    // Executive Summary & Rationale
    lines.push('### 📋 Executive Summary');
    lines.push(riskScore.rationale);
    lines.push('');

    // Blockers Section if any
    if (riskScore.blockers.length > 0) {
      lines.push('### 🚨 Deployment Blockers');
      for (const blocker of riskScore.blockers) {
        lines.push(`- ⚠️ **BLOCKER**: ${blocker}`);
      }
      lines.push('');
    }

    // Category Breakdown Table
    lines.push('### 📊 Risk Breakdown by Category');
    lines.push('');
    lines.push(
      '| Category | Score | Weight | Weighted Contrib | Findings | Highest Severity | Summary |',
    );
    lines.push(
      '| :--- | :---: | :---: | :---: | :---: | :---: | :--- |',
    );

    for (const cat of ['security', 'resource', 'deployment'] as RiskCategory[]) {
      const summary: CategoryRiskSummary = riskScore.categoryBreakdown[cat];
      const catIcon = this.getCategoryIcon(cat);
      const sevBadge = summary.highestSeverity
        ? `\`${summary.highestSeverity.toUpperCase()}\``
        : '_None_';

      lines.push(
        `| ${catIcon} **${cat.toUpperCase()}** | **${summary.score} / 100** | ${(summary.weight * 100).toFixed(0)}% | ${summary.weightedScore.toFixed(1)} pts | ${summary.findingCount} | ${sevBadge} | ${summary.summary} |`,
      );
    }
    lines.push('');

    // Primary Risk Drivers
    if (riskScore.primaryRiskDrivers.length > 0) {
      lines.push('### 🔍 Primary Risk Drivers');
      for (const driver of riskScore.primaryRiskDrivers) {
        lines.push(`- ${driver}`);
      }
      lines.push('');
    }

    // Findings Details
    if (riskScore.findings.length > 0) {
      lines.push('### 🔎 Detailed Findings');
      lines.push('');

      for (const cat of ['security', 'resource', 'deployment'] as RiskCategory[]) {
        const catFindings = riskScore.findings.filter((f) => f.category === cat);
        if (catFindings.length === 0) continue;

        lines.push(`#### ${this.getCategoryIcon(cat)} ${cat.toUpperCase()} Findings (${catFindings.length})`);
        lines.push('');
        lines.push('| Severity | Rule ID | Line | Message | Suggested Fix |');
        lines.push('| :---: | :--- | :---: | :--- | :--- |');

        for (const finding of catFindings) {
          const sevTag = `**${finding.severity.toUpperCase()}**`;
          const lineStr = finding.line !== undefined ? `${finding.line}` : '-';
          const msg = this.escapeCell(finding.message);
          const suggestion = this.escapeCell(finding.suggestion ?? 'Review implementation');

          lines.push(
            `| ${sevTag} | \`${finding.ruleId}\` | ${lineStr} | ${msg} | ${suggestion} |`,
          );
        }
        lines.push('');
      }
    }

    // Remediation Suggestions
    if (opts.includeRemediation !== false && riskScore.remediationSuggestions.length > 0) {
      lines.push('### 🛠️ Recommended Action Items');
      for (let i = 0; i < riskScore.remediationSuggestions.length; i++) {
        lines.push(`${i + 1}. ${riskScore.remediationSuggestions[i]}`);
      }
      lines.push('');
    }

    // Deployment Checklist
    if (opts.includeChecklist !== false) {
      lines.push('### ✅ Pre-Flight Deployment Checklist');
      const checklist = this.generateChecklist(riskScore);
      for (const item of checklist) {
        lines.push(item);
      }
      lines.push('');
    }

    lines.push(`_Generated by GasGuard Soroban Risk Engine at ${riskScore.analyzedAt}_`);

    return lines.join('\n');
  }

  /**
   * Generates a GitHub Pull Request comment with collapsible tables for large finding sets.
   */
  public formatPrRiskComment(
    riskScore: DeploymentRiskScore,
    options: RiskReportOptions = {},
  ): string {
    const opts = { ...this.options, ...options };
    const collapseThreshold = opts.collapseDetailsThreshold ?? DEFAULT_REPORT_OPTIONS.collapseDetailsThreshold!;
    const lines: string[] = [];

    const badge = this.getRiskBadge(riskScore.riskLevel, riskScore.compositeScore);
    const statusText = riskScore.readyForDeployment ? '✅ PASS' : '❌ BLOCKED';

    lines.push('## ⛽ GasGuard Soroban Deployment Risk Report');
    lines.push('');
    lines.push(
      `> **Deployment Status**: ${statusText} | **Risk Score**: **${riskScore.compositeScore}/100** (${badge})`,
    );
    lines.push('');
    lines.push(riskScore.rationale);
    lines.push('');

    // Category Breakdown Table
    lines.push('| Category | Score | Weight | Findings | Highest Severity |');
    lines.push('| :--- | :---: | :---: | :---: | :---: |');
    for (const cat of ['security', 'resource', 'deployment'] as RiskCategory[]) {
      const summary = riskScore.categoryBreakdown[cat];
      const highest = summary.highestSeverity ? `\`${summary.highestSeverity}\`` : 'none';
      lines.push(
        `| ${this.getCategoryIcon(cat)} ${cat} | ${summary.score}/100 | ${(summary.weight * 100).toFixed(0)}% | ${summary.findingCount} | ${highest} |`,
      );
    }
    lines.push('');

    // Findings section
    if (riskScore.findings.length > 0) {
      if (riskScore.findings.length > collapseThreshold) {
        lines.push('<details>');
        lines.push(`<summary><b>View all ${riskScore.findings.length} findings</b></summary>`);
        lines.push('');
      }

      lines.push('| Severity | Rule | Message | Suggestion |');
      lines.push('| :---: | :--- | :--- | :--- |');
      for (const f of riskScore.findings) {
        lines.push(
          `| **${f.severity.toUpperCase()}** | \`${f.ruleId}\` | ${this.escapeCell(f.message)} | ${this.escapeCell(f.suggestion ?? '')} |`,
        );
      }
      lines.push('');

      if (riskScore.findings.length > collapseThreshold) {
        lines.push('</details>');
        lines.push('');
      }
    }

    if (riskScore.remediationSuggestions.length > 0) {
      lines.push('**Top Action Items:**');
      for (const item of riskScore.remediationSuggestions.slice(0, 3)) {
        lines.push(`- ${item}`);
      }
      lines.push('');
    }

    return lines.join('\n').trimEnd();
  }

  /**
   * Generates a clean JSON representation of the assessment.
   */
  public generateJsonReport(
    riskScore: DeploymentRiskScore,
    options: RiskReportOptions = {},
  ): string {
    const opts = { ...this.options, ...options };
    const payload = {
      assessment: 'GasGuard Soroban Deployment Risk',
      contractName: opts.contractName,
      targetNetwork: opts.targetNetwork,
      analyzedAt: riskScore.analyzedAt,
      compositeScore: riskScore.compositeScore,
      riskLevel: riskScore.riskLevel,
      readyForDeployment: riskScore.readyForDeployment,
      blockers: riskScore.blockers,
      rationale: riskScore.rationale,
      categoryBreakdown: riskScore.categoryBreakdown,
      primaryRiskDrivers: riskScore.primaryRiskDrivers,
      remediationSuggestions: riskScore.remediationSuggestions,
      findings: riskScore.findings,
      weights: riskScore.weights,
    };

    return JSON.stringify(payload, null, 2);
  }

  /**
   * Generates terminal / CLI friendly text output.
   */
  public generateCliSummary(
    riskScore: DeploymentRiskScore,
    options: RiskReportOptions = {},
  ): string {
    const divider = '═'.repeat(60);
    const subDivider = '─'.repeat(60);
    const lines: string[] = [];

    lines.push(divider);
    lines.push('              SOROBAN DEPLOYMENT RISK ASSESSMENT');
    lines.push(divider);
    lines.push(`Composite Score : ${riskScore.compositeScore}/100 [${riskScore.riskLevel.toUpperCase()}]`);
    lines.push(`Deployment Gate : ${riskScore.readyForDeployment ? 'PASSED (Ready)' : 'BLOCKED'}`);
    lines.push(subDivider);
    lines.push('Category Breakdown:');
    for (const cat of ['security', 'resource', 'deployment'] as RiskCategory[]) {
      const b = riskScore.categoryBreakdown[cat];
      lines.push(
        `  • ${cat.toUpperCase().padEnd(11)} : ${b.score}/100 (Weight ${(b.weight * 100).toFixed(0)}%, ${b.findingCount} findings, peak: ${b.highestSeverity ?? 'none'})`,
      );
    }

    if (riskScore.blockers.length > 0) {
      lines.push(subDivider);
      lines.push('Blockers:');
      for (const blocker of riskScore.blockers) {
        lines.push(`  [!] ${blocker}`);
      }
    }

    if (riskScore.primaryRiskDrivers.length > 0) {
      lines.push(subDivider);
      lines.push('Primary Drivers:');
      for (const d of riskScore.primaryRiskDrivers) {
        lines.push(`  - ${d}`);
      }
    }

    if (riskScore.remediationSuggestions.length > 0) {
      lines.push(subDivider);
      lines.push('Remediation:');
      for (const s of riskScore.remediationSuggestions) {
        lines.push(`  * ${s}`);
      }
    }

    lines.push(divider);

    return lines.join('\n');
  }

  /**
   * Generates a pre-flight checklist based on current risk profile.
   */
  public generateChecklist(riskScore: DeploymentRiskScore): string[] {
    const checklist: string[] = [];

    // Security items
    const sec = riskScore.categoryBreakdown.security;
    if (sec.findingCount === 0) {
      checklist.push('- [x] **Authentication & Access Control**: Verified (no security findings)');
    } else if (sec.severityCounts.critical > 0 || sec.severityCounts.high > 0) {
      checklist.push('- [ ] **Authentication & Access Control**: Resolve all critical/high security issues');
    } else {
      checklist.push('- [ ] **Authentication & Access Control**: Review moderate security recommendations');
    }

    // Resource items
    const res = riskScore.categoryBreakdown.resource;
    if (res.findingCount === 0) {
      checklist.push('- [x] **Resource Budget**: Clean (within optimal CPU & memory bounds)');
    } else if (res.score >= 50) {
      checklist.push('- [ ] **Resource Budget**: Optimize high-CPU loops and storage accesses');
    } else {
      checklist.push('- [ ] **Resource Budget**: Verify resource limits under peak testnet loads');
    }

    // Deployment items
    const dep = riskScore.categoryBreakdown.deployment;
    if (dep.findingCount === 0) {
      checklist.push('- [x] **Deployment Lifecycle**: TTL management and schema versioning verified');
    } else {
      checklist.push('- [ ] **Deployment Lifecycle**: Configure storage TTL extensions and upgrade guards');
    }

    // Final deployment approval
    if (riskScore.readyForDeployment) {
      checklist.push('- [x] **Deployment Gate Approval**: Clear for deployment');
    } else {
      checklist.push('- [ ] **Deployment Gate Approval**: Pending resolution of blockers');
    }

    return checklist;
  }

  private getRiskBadge(level: RiskLevel, score: number): string {
    switch (level) {
      case 'critical':
        return `🔴 **CRITICAL** (${score}/100)`;
      case 'high':
        return `🟠 **HIGH** (${score}/100)`;
      case 'medium':
        return `🟡 **MEDIUM** (${score}/100)`;
      case 'low':
        return `🟢 **LOW** (${score}/100)`;
      case 'safe':
      default:
        return `🟢 **SAFE** (${score}/100)`;
    }
  }

  private getCategoryIcon(cat: RiskCategory): string {
    switch (cat) {
      case 'security':
        return '🔒';
      case 'resource':
        return '⚡';
      case 'deployment':
        return '🚀';
    }
  }

  private escapeCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  }
}

// ── Standalone Formatting Functions ──────────────────────────────────────────

export function formatDeploymentRiskMarkdown(
  riskScore: DeploymentRiskScore,
  options?: RiskReportOptions,
): string {
  const reporter = new SorobanDeploymentRiskReporter(options);
  return reporter.generateMarkdownReport(riskScore, options);
}

export function formatDeploymentRiskPrComment(
  riskScore: DeploymentRiskScore,
  options?: RiskReportOptions,
): string {
  const reporter = new SorobanDeploymentRiskReporter(options);
  return reporter.formatPrRiskComment(riskScore, options);
}

export function formatDeploymentRiskJson(
  riskScore: DeploymentRiskScore,
  options?: RiskReportOptions,
): string {
  const reporter = new SorobanDeploymentRiskReporter(options);
  return reporter.generateJsonReport(riskScore, options);
}

export function formatDeploymentRiskCli(
  riskScore: DeploymentRiskScore,
  options?: RiskReportOptions,
): string {
  const reporter = new SorobanDeploymentRiskReporter(options);
  return reporter.generateCliSummary(riskScore, options);
}
