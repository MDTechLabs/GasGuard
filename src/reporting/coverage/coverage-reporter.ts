/**
 * Analyzer Coverage Reporter
 *
 * Generates reports on analyzer coverage metrics, identifying uncovered patterns
 * and providing actionable insights for improving rule coverage.
 */

import { CoverageMetrics } from "../../analysis/coverage/coverage-analyzer";
import {
  CoverageReportData,
  CoverageReportOptions,
  CoverageReportResult,
  CoverageThreshold,
} from "./types";
import * as fs from "fs";
import * as path from "path";

export class CoverageReporter {
  private readonly defaultOptions: CoverageReportOptions = {
    format: "text",
    includeUncoveredDetails: true,
    includeRuleBreakdown: false,
    thresholdPercent: 80,
  };

  /**
   * Generate a coverage report in the specified format
   */
  generate(
    data: CoverageReportData,
    options: CoverageReportOptions = {},
  ): string {
    const opts = { ...this.defaultOptions, ...options };

    switch (opts.format) {
      case "json":
        return this.generateJson(data);
      case "html":
        return this.generateHtml(data, opts);
      case "markdown":
        return this.generateMarkdown(data, opts);
      case "text":
      default:
        return this.generateText(data, opts);
    }
  }

  /**
   * Generate a text-based coverage report
   */
  private generateText(
    data: CoverageReportData,
    options: CoverageReportOptions,
  ): string {
    const { coverage, projectName, version, timestamp, analysisTimeMs } = data;
    let output = "";

    output += "=".repeat(60) + "\n";
    output += `  Analyzer Coverage Report\n`;
    output += "=".repeat(60) + "\n\n";

    output += `Project:        ${projectName}\n`;
    output += `Version:        ${version}\n`;
    output += `Generated:      ${timestamp.toISOString()}\n`;
    output += `Analysis Time:  ${analysisTimeMs}ms\n\n`;

    output += `--- Coverage Summary ---\n`;
    output += `Total Nodes:    ${coverage.totalNodes}\n`;
    output += `Analyzed Nodes: ${coverage.analyzedNodes}\n`;
    output += `Coverage:       ${coverage.coveragePercent}%\n\n`;

    const threshold = options.thresholdPercent || 80;
    const meetsThreshold = coverage.coveragePercent >= threshold;
    output += `Threshold:      ${threshold}%\n`;
    output += `Status:         ${meetsThreshold ? "✓ PASS" : "✗ FAIL"}\n\n`;

    if (
      options.includeUncoveredDetails &&
      coverage.uncoveredPatterns.length > 0
    ) {
      output += `--- Uncovered Patterns (${coverage.uncoveredPatterns.length}) ---\n`;
      coverage.uncoveredPatterns.forEach((pattern, idx) => {
        output += `  ${idx + 1}. ${pattern}\n`;
      });
      output += "\n";
    }

    if (options.includeRuleBreakdown && data.rulesCoverage) {
      output += `--- Rule Coverage Breakdown ---\n`;
      data.rulesCoverage.forEach((rule) => {
        output += `\n${rule.ruleId} (${rule.ruleName})\n`;
        output += `  Nodes Analyzed: ${rule.nodesAnalyzed}\n`;
        output += `  Node Types:     ${rule.nodeTypes.join(", ")}\n`;
        output += `  Files Affected: ${rule.filesAffected.length}\n`;
      });
      output += "\n";
    }

    output += "=".repeat(60) + "\n";
    return output;
  }

  /**
   * Generate a JSON coverage report
   */
  private generateJson(data: CoverageReportData): string {
    return JSON.stringify(data, null, 2);
  }

  /**
   * Generate an HTML coverage report
   */
  private generateHtml(
    data: CoverageReportData,
    options: CoverageReportOptions,
  ): string {
    const { coverage, projectName, version, timestamp, analysisTimeMs } = data;
    const threshold = options.thresholdPercent || 80;
    const meetsThreshold = coverage.coveragePercent >= threshold;

    let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Analyzer Coverage Report - ${projectName}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      line-height: 1.6;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f5f5f5;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      border-radius: 8px;
      margin-bottom: 20px;
    }
    .header h1 {
      margin: 0 0 10px 0;
      font-size: 2em;
    }
    .header .subtitle {
      opacity: 0.9;
      font-size: 0.9em;
    }
    .card {
      background: white;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
      margin-bottom: 20px;
    }
    .metric {
      padding: 15px;
      background: #f8f9fa;
      border-radius: 6px;
      border-left: 4px solid #667eea;
    }
    .metric-label {
      font-size: 0.85em;
      color: #666;
      margin-bottom: 5px;
    }
    .metric-value {
      font-size: 1.8em;
      font-weight: bold;
      color: #333;
    }
    .coverage-bar {
      width: 100%;
      height: 40px;
      background: #e0e0e0;
      border-radius: 20px;
      overflow: hidden;
      margin: 20px 0;
    }
    .coverage-fill {
      height: 100%;
      background: linear-gradient(90deg, #4caf50 0%, #8bc34a 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: bold;
      transition: width 0.3s ease;
    }
    .status {
      padding: 10px 20px;
      border-radius: 6px;
      font-weight: bold;
      display: inline-block;
      margin: 10px 0;
    }
    .status.pass {
      background: #d4edda;
      color: #155724;
      border: 1px solid #c3e6cb;
    }
    .status.fail {
      background: #f8d7da;
      color: #721c24;
      border: 1px solid #f5c6cb;
    }
    .pattern-list {
      list-style: none;
      padding: 0;
    }
    .pattern-list li {
      padding: 10px;
      background: #f8f9fa;
      margin-bottom: 8px;
      border-radius: 4px;
      border-left: 3px solid #ffc107;
    }
    .rule-breakdown {
      margin-top: 20px;
    }
    .rule-item {
      padding: 15px;
      background: #f8f9fa;
      margin-bottom: 10px;
      border-radius: 6px;
    }
    .rule-header {
      font-weight: bold;
      color: #667eea;
      margin-bottom: 8px;
    }
    .rule-stats {
      font-size: 0.9em;
      color: #666;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>📊 Analyzer Coverage Report</h1>
    <div class="subtitle">${projectName} v${version}</div>
    <div class="subtitle">Generated: ${timestamp.toISOString()}</div>
  </div>

  <div class="card">
    <h2>Coverage Summary</h2>
    <div class="metrics">
      <div class="metric">
        <div class="metric-label">Total Nodes</div>
        <div class="metric-value">${coverage.totalNodes}</div>
      </div>
      <div class="metric">
        <div class="metric-label">Analyzed Nodes</div>
        <div class="metric-value">${coverage.analyzedNodes}</div>
      </div>
      <div class="metric">
        <div class="metric-label">Coverage</div>
        <div class="metric-value">${coverage.coveragePercent}%</div>
      </div>
      <div class="metric">
        <div class="metric-label">Analysis Time</div>
        <div class="metric-value">${analysisTimeMs}ms</div>
      </div>
    </div>

    <div class="coverage-bar">
      <div class="coverage-fill" style="width: ${coverage.coveragePercent}%">
        ${coverage.coveragePercent}%
      </div>
    </div>

    <div>
      <strong>Threshold:</strong> ${threshold}%
      <div class="status ${meetsThreshold ? "pass" : "fail"}">
        ${meetsThreshold ? "✓ PASS" : "✗ FAIL"}
      </div>
    </div>
  </div>
`;

    if (
      options.includeUncoveredDetails &&
      coverage.uncoveredPatterns.length > 0
    ) {
      html += `
  <div class="card">
    <h2>⚠️ Uncovered Patterns (${coverage.uncoveredPatterns.length})</h2>
    <ul class="pattern-list">
`;
      coverage.uncoveredPatterns.forEach((pattern) => {
        html += `      <li>${this.escapeHtml(pattern)}</li>\n`;
      });
      html += `    </ul>
  </div>
`;
    }

    if (options.includeRuleBreakdown && data.rulesCoverage) {
      html += `
  <div class="card">
    <h2>Rule Coverage Breakdown</h2>
    <div class="rule-breakdown">
`;
      data.rulesCoverage.forEach((rule) => {
        html += `
      <div class="rule-item">
        <div class="rule-header">${this.escapeHtml(rule.ruleId)} - ${this.escapeHtml(rule.ruleName)}</div>
        <div class="rule-stats">
          Nodes Analyzed: ${rule.nodesAnalyzed} | 
          Node Types: ${rule.nodeTypes.join(", ")} | 
          Files Affected: ${rule.filesAffected.length}
        </div>
      </div>
`;
      });
      html += `    </div>
  </div>
`;
    }

    html += `
</body>
</html>
`;
    return html;
  }

  /**
   * Generate a Markdown coverage report
   */
  private generateMarkdown(
    data: CoverageReportData,
    options: CoverageReportOptions,
  ): string {
    const { coverage, projectName, version, timestamp, analysisTimeMs } = data;
    const threshold = options.thresholdPercent || 80;
    const meetsThreshold = coverage.coveragePercent >= threshold;

    let md = `# 📊 Analyzer Coverage Report\n\n`;
    md += `**Project:** ${projectName}  \n`;
    md += `**Version:** ${version}  \n`;
    md += `**Generated:** ${timestamp.toISOString()}  \n`;
    md += `**Analysis Time:** ${analysisTimeMs}ms\n\n`;

    md += `## Coverage Summary\n\n`;
    md += `| Metric | Value |\n`;
    md += `|--------|-------|\n`;
    md += `| Total Nodes | ${coverage.totalNodes} |\n`;
    md += `| Analyzed Nodes | ${coverage.analyzedNodes} |\n`;
    md += `| Coverage | **${coverage.coveragePercent}%** |\n`;
    md += `| Threshold | ${threshold}% |\n`;
    md += `| Status | ${meetsThreshold ? "✅ PASS" : "❌ FAIL"} |\n\n`;

    if (
      options.includeUncoveredDetails &&
      coverage.uncoveredPatterns.length > 0
    ) {
      md += `## ⚠️ Uncovered Patterns (${coverage.uncoveredPatterns.length})\n\n`;
      coverage.uncoveredPatterns.forEach((pattern, idx) => {
        md += `${idx + 1}. \`${pattern}\`\n`;
      });
      md += `\n`;
    }

    if (options.includeRuleBreakdown && data.rulesCoverage) {
      md += `## Rule Coverage Breakdown\n\n`;
      data.rulesCoverage.forEach((rule) => {
        md += `### ${rule.ruleId} - ${rule.ruleName}\n\n`;
        md += `- **Nodes Analyzed:** ${rule.nodesAnalyzed}\n`;
        md += `- **Node Types:** ${rule.nodeTypes.join(", ")}\n`;
        md += `- **Files Affected:** ${rule.filesAffected.length}\n\n`;
      });
    }

    return md;
  }

  /**
   * Save a report to a file
   */
  async saveReport(
    data: CoverageReportData,
    outputPath: string,
    options: CoverageReportOptions = {},
  ): Promise<CoverageReportResult> {
    const content = this.generate(data, options);

    // Ensure directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, content, "utf8");

    const threshold = options.thresholdPercent || 80;
    const thresholdMet = data.coverage.coveragePercent >= threshold;

    return {
      success: true,
      coveragePercent: data.coverage.coveragePercent,
      thresholdMet,
      reportPath: outputPath,
      summary: this.generateSummary(data, thresholdMet),
    };
  }

  /**
   * Check if coverage meets the threshold
   */
  checkThreshold(
    metrics: CoverageMetrics,
    threshold: CoverageThreshold,
  ): boolean {
    return metrics.coveragePercent >= threshold.minCoveragePercent;
  }

  /**
   * Generate a brief summary string
   */
  private generateSummary(
    data: CoverageReportData,
    thresholdMet: boolean,
  ): string {
    const { coverage } = data;
    let summary = `Coverage: ${coverage.coveragePercent}% `;
    summary += `(${coverage.analyzedNodes}/${coverage.totalNodes} nodes)`;

    if (!thresholdMet) {
      summary += ` - Threshold not met`;
    }

    if (coverage.uncoveredPatterns.length > 0) {
      summary += ` - ${coverage.uncoveredPatterns.length} uncovered patterns`;
    }

    return summary;
  }

  /**
   * Create report data from coverage metrics
   */
  createReportData(
    projectName: string,
    version: string,
    coverage: CoverageMetrics,
    filesCovered: number,
    totalFiles: number,
    analysisTimeMs: number,
  ): CoverageReportData {
    return {
      projectName,
      version,
      timestamp: new Date(),
      coverage,
      filesCovered,
      totalFiles,
      analysisTimeMs,
    };
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(text: string): string {
    const htmlEscapeMap: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return text.replace(/[&<>"']/g, (char) => htmlEscapeMap[char]);
  }
}
