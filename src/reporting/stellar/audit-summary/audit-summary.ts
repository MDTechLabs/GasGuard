/**
 * Soroban Audit Summary Generator (#472)
 *
 * Groups scan findings by severity and generates audit-ready reports.
 */

import { Finding, Severity } from "../../../../libs/engine/core/analyzer-interface";

export interface AuditSummaryReport {
  projectName: string;
  contractName: string;
  totalFindings: number;
  severityCounts: Record<Severity, number>;
  totalEstimatedGasSavings: number;
  groupedFindings: Record<Severity, Finding[]>;
  generatedAt: Date;
}

export class SorobanAuditSummaryGenerator {
  /**
   * Generate an audit summary report from findings.
   */
  generateSummary(
    findings: Finding[],
    projectName: string,
    contractName: string,
  ): AuditSummaryReport {
    const severityCounts: Record<Severity, number> = {
      [Severity.CRITICAL]: 0,
      [Severity.HIGH]: 0,
      [Severity.MEDIUM]: 0,
      [Severity.LOW]: 0,
      [Severity.INFO]: 0,
    };

    const groupedFindings: Record<Severity, Finding[]> = {
      [Severity.CRITICAL]: [],
      [Severity.HIGH]: [],
      [Severity.MEDIUM]: [],
      [Severity.LOW]: [],
      [Severity.INFO]: [],
    };

    let totalEstimatedGasSavings = 0;

    for (const finding of findings) {
      const sev = finding.severity;
      if (severityCounts[sev] !== undefined) {
        severityCounts[sev]++;
        groupedFindings[sev].push(finding);
      }
      if (finding.estimatedGasSavings) {
        totalEstimatedGasSavings += finding.estimatedGasSavings;
      }
    }

    return {
      projectName,
      contractName,
      totalFindings: findings.length,
      severityCounts,
      totalEstimatedGasSavings,
      groupedFindings,
      generatedAt: new Date(),
    };
  }

  /**
   * Format the audit summary into a clean markdown report.
   */
  formatMarkdown(summary: AuditSummaryReport): string {
    let md = `# Soroban Security Audit Summary: ${summary.contractName}\n\n`;
    md += `**Project:** ${summary.projectName}\n`;
    md += `**Date:** ${summary.generatedAt.toISOString()}\n`;
    md += `**Total Findings:** ${summary.totalFindings}\n`;
    md += `**Estimated Fee/Gas Savings:** ${summary.totalEstimatedGasSavings} units\n\n`;

    md += `## 📊 Severity Breakdown\n\n`;
    md += `| Severity | Count |\n`;
    md += `| --- | --- |\n`;
    md += `| 🔴 Critical | ${summary.severityCounts[Severity.CRITICAL]} |\n`;
    md += `| 🟠 High | ${summary.severityCounts[Severity.HIGH]} |\n`;
    md += `| 🟡 Medium | ${summary.severityCounts[Severity.MEDIUM]} |\n`;
    md += `| 🟢 Low | ${summary.severityCounts[Severity.LOW]} |\n`;
    md += `| 🔵 Info | ${summary.severityCounts[Severity.INFO]} |\n\n`;

    md += `## 🔍 Detailed Findings\n\n`;

    const severities = [
      Severity.CRITICAL,
      Severity.HIGH,
      Severity.MEDIUM,
      Severity.LOW,
      Severity.INFO,
    ];

    for (const sev of severities) {
      const list = summary.groupedFindings[sev];
      if (list.length === 0) continue;

      const emoji =
        sev === Severity.CRITICAL
          ? "🔴"
          : sev === Severity.HIGH
            ? "🟠"
            : sev === Severity.MEDIUM
              ? "🟡"
              : sev === Severity.LOW
                ? "🟢"
                : "🔵";

      md += `### ${emoji} ${sev.toUpperCase()} (${list.length})\n\n`;

      for (const finding of list) {
        md += `#### [${finding.ruleId}] Line ${finding.location.startLine}\n`;
        md += `* **Message:** ${finding.message}\n`;
        if (finding.estimatedGasSavings) {
          md += `* **Estimated Savings:** ${finding.estimatedGasSavings} units\n`;
        }
        if (finding.suggestedFix) {
          md += `* **Suggested Fix:** ${finding.suggestedFix.description}\n`;
          if (finding.suggestedFix.codeSnippet) {
            md += `  \`\`\`rust\n  ${finding.suggestedFix.codeSnippet.split("\n").join("\n  ")}\n  \`\`\`\n`;
          }
        }
        md += `\n`;
      }
    }

    return md;
  }
}
