import * as fs from "fs";
import * as path from "path";
import { AnalysisResult } from "../../../analysis/filter/analysis-filter";
import {
  ComplianceStatus,
  EnterpriseExportFormat,
  EnterpriseSeverity,
  StellarComplianceControl,
  StellarComplianceSummary,
  StellarEnterpriseFinding,
  StellarEnterpriseMetadata,
  StellarEnterpriseReport,
  StellarEnterpriseReportOptions,
  StellarEnterpriseSummary,
} from "./types";
import { calculateFunctionRiskScores } from "../../../scoring/functions/stellar";

const DEFAULT_VERSION = "1.0.0";
const DEFAULT_GENERATOR = "GasGuard Enterprise Reporter";
const DEFAULT_FRAMEWORKS = [
  "Stellar Security Baseline",
  "Audit Readiness Summary",
];

export class StellarEnterpriseReporter {
  createReport(
    findings: AnalysisResult[],
    options: StellarEnterpriseReportOptions,
  ): StellarEnterpriseReport {
    const metadata = this.createMetadata(options);
    const normalizedFindings = findings.map((finding) =>
      this.normalizeFinding(finding),
    );
    const summary = this.createSummary(normalizedFindings);
    const compliance = this.createComplianceSummary(normalizedFindings);
    const functionRiskSummary = calculateFunctionRiskScores(
      normalizedFindings,
    ).map((risk) => ({
      functionName: risk.functionName,
      overallScore: risk.overallScore,
      riskLevel: risk.riskLevel,
    }));

    return {
      metadata,
      summary,
      compliance,
      findings: normalizedFindings,
      functionRiskSummary,
      exportFormats: ["json", "csv", "markdown"],
    };
  }

  render(
    report: StellarEnterpriseReport,
    format: EnterpriseExportFormat,
  ): string {
    switch (format) {
      case "json":
        return JSON.stringify(report, null, 2);
      case "csv":
        return this.renderCsv(report);
      case "markdown":
        return this.renderMarkdown(report);
      default:
        return this.assertNever(format);
    }
  }

  exportReport(
    report: StellarEnterpriseReport,
    outputPath: string,
    format?: EnterpriseExportFormat,
  ): string {
    const resolvedFormat = format ?? this.inferFormat(outputPath);
    const content = this.render(report, resolvedFormat);
    const dir = path.dirname(outputPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, content, "utf8");
    return outputPath;
  }

  generateAndExport(
    findings: AnalysisResult[],
    options: StellarEnterpriseReportOptions,
    outputPath: string,
    format?: EnterpriseExportFormat,
  ): StellarEnterpriseReport {
    const report = this.createReport(findings, options);
    this.exportReport(report, outputPath, format);
    return report;
  }

  inferFormat(outputPath: string): EnterpriseExportFormat {
    const ext = path.extname(outputPath).toLowerCase();

    if (ext === ".csv") {
      return "csv";
    }

    if (ext === ".md" || ext === ".markdown") {
      return "markdown";
    }

    return "json";
  }

  private createMetadata(
    options: StellarEnterpriseReportOptions,
  ): StellarEnterpriseMetadata {
    return {
      projectName: options.projectName,
      version: options.version ?? DEFAULT_VERSION,
      scanPath: options.scanPath,
      generatedBy: options.generatedBy ?? DEFAULT_GENERATOR,
      generatedAt: (options.generatedAt ?? new Date()).toISOString(),
      frameworks: options.frameworks ?? DEFAULT_FRAMEWORKS,
    };
  }

  private createSummary(
    findings: StellarEnterpriseFinding[],
  ): StellarEnterpriseSummary {
    const affectedFiles = Array.from(
      new Set(findings.map((finding) => finding.filePath)),
    ).sort();
    const uniqueRules = new Set(findings.map((finding) => finding.ruleId)).size;
    const averageConfidence = findings.length
      ? findings.reduce((sum, finding) => sum + finding.confidence, 0) /
        findings.length
      : 0;
    const criticalFindings = findings.filter(
      (finding) => finding.severity === "critical",
    ).length;
    const highFindings = findings.filter(
      (finding) => finding.severity === "high",
    ).length;
    const mediumFindings = findings.filter(
      (finding) => finding.severity === "medium",
    ).length;
    const lowFindings = findings.filter(
      (finding) => finding.severity === "low",
    ).length;
    const infoFindings = findings.filter(
      (finding) => finding.severity === "info",
    ).length;

    return {
      totalFindings: findings.length,
      totalFiles: affectedFiles.length,
      uniqueRules,
      averageConfidence: Number(averageConfidence.toFixed(3)),
      criticalFindings,
      highFindings,
      mediumFindings,
      lowFindings,
      infoFindings,
      affectedFiles,
      estimatedRemediationMinutes: this.estimateRemediationMinutes(findings),
    };
  }

  private createComplianceSummary(
    findings: StellarEnterpriseFinding[],
  ): StellarComplianceSummary {
    const controls = this.buildControls(findings);
    const score = this.calculateComplianceScore(controls);
    const status = this.scoreToStatus(score, findings);
    const readyForAudit = status === "pass" && findings.length === 0;

    return {
      status,
      score,
      readyForAudit,
      controls,
      summary: this.buildComplianceSummaryText(
        status,
        score,
        controls,
        findings.length,
      ),
    };
  }

  private buildControls(
    findings: StellarEnterpriseFinding[],
  ): StellarComplianceControl[] {
    const controls = [
      this.createControl(
        "STELLAR-NETWORK-VALIDATION",
        "Network validation",
        findings,
        ["network"],
        "Ensures deployments validate the expected Stellar network environment.",
      ),
      this.createControl(
        "STELLAR-ACCESS-CONTROL",
        "Access control",
        findings,
        ["access", "role", "permission"],
        "Checks for role and permission weaknesses that can undermine privileged operations.",
      ),
      this.createControl(
        "STELLAR-EVENT-TRACEABILITY",
        "Event traceability",
        findings,
        ["event", "logging", "trace"],
        "Verifies event emission is sufficient for investigation and audit trails.",
      ),
      this.createControl(
        "STELLAR-SDK-USAGE",
        "SDK usage",
        findings,
        ["sdk", "address", "contract"],
        "Confirms Stellar-specific primitives are used consistently and safely.",
      ),
      this.createControl(
        "STELLAR-RESOURCE-EFFICIENCY",
        "Resource efficiency",
        findings,
        ["gas", "cost", "storage", "performance"],
        "Highlights expensive execution paths that should be optimized before release.",
      ),
    ];

    return controls;
  }

  private createControl(
    id: string,
    title: string,
    findings: StellarEnterpriseFinding[],
    keywords: string[],
    rationale: string,
  ): StellarComplianceControl {
    const matchingFindings = findings.filter((finding) =>
      keywords.some((keyword) => this.findingMatches(finding, keyword)),
    );

    const score =
      matchingFindings.length === 0
        ? 100
        : Math.max(0, 100 - matchingFindings.length * 20);
    const status = this.scoreToStatus(score, matchingFindings);

    return {
      id,
      title,
      status,
      score,
      findingsCount: matchingFindings.length,
      rationale,
    };
  }

  private calculateComplianceScore(
    controls: StellarComplianceControl[],
  ): number {
    if (controls.length === 0) {
      return 100;
    }

    const total = controls.reduce((sum, control) => sum + control.score, 0);
    return Number((total / controls.length).toFixed(2));
  }

  private scoreToStatus(
    score: number,
    findings: StellarEnterpriseFinding[],
  ): ComplianceStatus {
    if (findings.some((finding) => finding.severity === "critical")) {
      return "fail";
    }

    if (score >= 90) {
      return "pass";
    }

    if (score >= 70) {
      return "review";
    }

    return "fail";
  }

  private buildComplianceSummaryText(
    status: ComplianceStatus,
    score: number,
    controls: StellarComplianceControl[],
    totalFindings: number,
  ): string {
    const openControls = controls.filter(
      (control) => control.status !== "pass",
    ).length;
    return [
      `Compliance status: ${status.toUpperCase()}.`,
      `Overall score: ${score.toFixed(2)}/100.`,
      `Open controls: ${openControls}.`,
      `Findings reviewed: ${totalFindings}.`,
    ].join(" ");
  }

  private normalizeFinding(finding: AnalysisResult): StellarEnterpriseFinding {
    const severity = this.classifySeverity(finding.confidence);
    const category = this.classifyCategory(finding.ruleId, finding.message);

    return {
      ...finding,
      severity,
      category,
      impact: this.describeImpact(severity, category),
      recommendation: this.recommendFix(finding.ruleId, category),
      complianceAreas: this.mapComplianceAreas(finding.ruleId, finding.message),
    };
  }

  private classifySeverity(confidence: number): EnterpriseSeverity {
    if (confidence >= 0.95) return "critical";
    if (confidence >= 0.85) return "high";
    if (confidence >= 0.7) return "medium";
    if (confidence >= 0.5) return "low";
    return "info";
  }

  private classifyCategory(ruleId: string, message: string): string {
    const text = `${ruleId} ${message}`.toLowerCase();

    if (text.includes("network")) return "networking";
    if (
      text.includes("role") ||
      text.includes("access") ||
      text.includes("permission")
    )
      return "access-control";
    if (text.includes("event") || text.includes("log")) return "observability";
    if (
      text.includes("gas") ||
      text.includes("storage") ||
      text.includes("cost") ||
      text.includes("performance")
    )
      return "efficiency";
    if (
      text.includes("sdk") ||
      text.includes("address") ||
      text.includes("contract")
    )
      return "stellar-integration";

    return "general";
  }

  private describeImpact(
    severity: EnterpriseSeverity,
    category: string,
  ): string {
    const impactMap: Record<string, string> = {
      networking: "Can break network-specific deployment guarantees.",
      "access-control":
        "Can expose privileged actions to unauthorised callers.",
      observability:
        "Can reduce auditability and incident investigation quality.",
      efficiency: "Can increase execution cost and operational overhead.",
      "stellar-integration":
        "Can introduce interoperability or contract interface mismatches.",
      general: "Should be reviewed before release.",
    };

    return `${severity.toUpperCase()} - ${impactMap[category] ?? impactMap.general}`;
  }

  private recommendFix(ruleId: string, category: string): string {
    const text = `${ruleId} ${category}`.toLowerCase();

    if (text.includes("network"))
      return "Validate the current Stellar network before executing sensitive logic.";
    if (text.includes("role") || text.includes("access"))
      return "Tighten role checks and document the authorization model.";
    if (text.includes("event"))
      return "Emit structured audit events for important state transitions.";
    if (
      text.includes("gas") ||
      text.includes("storage") ||
      text.includes("cost")
    )
      return "Reduce repeated work and cache expensive reads where possible.";
    if (text.includes("sdk") || text.includes("address"))
      return "Align contract interfaces and Stellar primitives with the expected SDK usage.";

    return "Review the finding and capture a documented remediation decision.";
  }

  private mapComplianceAreas(ruleId: string, message: string): string[] {
    const text = `${ruleId} ${message}`.toLowerCase();
    const areas = new Set<string>();

    if (text.includes("network")) areas.add("network-validation");
    if (
      text.includes("role") ||
      text.includes("access") ||
      text.includes("permission")
    )
      areas.add("access-control");
    if (text.includes("event") || text.includes("log"))
      areas.add("auditability");
    if (
      text.includes("gas") ||
      text.includes("storage") ||
      text.includes("cost")
    )
      areas.add("cost-control");
    if (text.includes("sdk") || text.includes("address"))
      areas.add("stellar-compatibility");

    if (areas.size === 0) {
      areas.add("general-review");
    }

    return Array.from(areas);
  }

  private findingMatches(
    finding: StellarEnterpriseFinding,
    keyword: string,
  ): boolean {
    const haystack =
      `${finding.ruleId} ${finding.message} ${finding.category} ${finding.complianceAreas.join(" ")}`.toLowerCase();
    return haystack.includes(keyword);
  }

  private estimateRemediationMinutes(
    findings: StellarEnterpriseFinding[],
  ): number {
    return findings.reduce((minutes, finding) => {
      const base =
        finding.severity === "critical"
          ? 240
          : finding.severity === "high"
            ? 120
            : finding.severity === "medium"
              ? 45
              : finding.severity === "low"
                ? 20
                : 10;
      return minutes + base;
    }, 0);
  }

  private renderCsv(report: StellarEnterpriseReport): string {
    const header = [
      "ruleId",
      "filePath",
      "line",
      "confidence",
      "severity",
      "category",
      "message",
      "recommendation",
      "complianceAreas",
    ];

    const rows = report.findings.map((finding) =>
      [
        finding.ruleId,
        finding.filePath,
        finding.line,
        finding.confidence.toFixed(2),
        finding.severity,
        finding.category,
        this.escapeCsv(finding.message),
        this.escapeCsv(finding.recommendation),
        this.escapeCsv(finding.complianceAreas.join("|")),
      ].join(","),
    );

    return [header.join(","), ...rows].join("\n");
  }

  private renderMarkdown(report: StellarEnterpriseReport): string {
    const lines: string[] = [];
    lines.push(`# ${report.metadata.projectName} Enterprise Stellar Report`);
    lines.push("");
    lines.push("## Executive Summary");
    lines.push(`- Scan path: \`${report.metadata.scanPath}\``);
    lines.push(`- Generated at: ${report.metadata.generatedAt}`);
    lines.push(
      `- Overall compliance: **${report.compliance.status.toUpperCase()}**`,
    );
    lines.push(
      `- Compliance score: **${report.compliance.score.toFixed(2)} / 100**`,
    );
    lines.push(`- Findings: **${report.summary.totalFindings}**`);
    lines.push(
      `- Ready for audit: **${report.compliance.readyForAudit ? "Yes" : "No"}**`,
    );
    lines.push("");
    lines.push("## Compliance Summary");
    lines.push(report.compliance.summary);
    lines.push("");
    lines.push("| Control | Status | Score | Findings |");
    lines.push("| --- | --- | ---: | ---: |");

    for (const control of report.compliance.controls) {
      lines.push(
        `| ${control.title} | ${control.status} | ${control.score} | ${control.findingsCount} |`,
      );
    }

    lines.push("");
    lines.push("## Findings");
    lines.push(
      "| Rule | File | Line | Severity | Confidence | Category | Recommendation |",
    );
    lines.push("| --- | --- | ---: | --- | ---: | --- | --- |");

    for (const finding of report.findings) {
      lines.push(
        `| ${finding.ruleId} | ${finding.filePath} | ${finding.line} | ${finding.severity} | ${finding.confidence.toFixed(
          2,
        )} | ${finding.category} | ${this.escapeMarkdown(finding.recommendation)} |`,
      );
    }

    return lines.join("\n");
  }

  private escapeCsv(value: string): string {
    if (value.includes(",") || value.includes('"') || value.includes("\n")) {
      return `"${value.replace(/"/g, '""')}"`;
    }

    return value;
  }

  private escapeMarkdown(value: string): string {
    return value.replace(/\|/g, "\\|");
  }

  private assertNever(value: never): never {
    throw new Error(`Unsupported export format: ${String(value)}`);
  }
}

export default StellarEnterpriseReporter;
