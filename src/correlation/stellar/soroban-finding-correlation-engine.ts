import { Finding, Severity } from "@engine/core";
import {
  SorobanCorrelatedFinding,
  SorobanFindingCorrelationGroup,
  SorobanFindingCorrelationOptions,
  SorobanFindingCorrelationReport,
} from "./types";

const SEVERITY_WEIGHT: Record<Severity, number> = {
  [Severity.CRITICAL]: 5,
  [Severity.HIGH]: 4,
  [Severity.MEDIUM]: 3,
  [Severity.LOW]: 2,
  [Severity.INFO]: 1,
};

export class SorobanFindingCorrelationEngine {
  public createReport(
    findings: Finding[],
    options: SorobanFindingCorrelationOptions = {},
  ): SorobanFindingCorrelationReport {
    const minimumGroupSize = options.minimumGroupSize ?? 2;
    const buckets = new Map<string, SorobanCorrelatedFinding[]>();
    const standalone: Finding[] = [];

    for (const finding of findings) {
      const signals = this.buildSignals(finding);
      const key = this.selectBucketKey(signals);

      if (!key) {
        standalone.push(finding);
        continue;
      }

      const current = buckets.get(key) ?? [];
      current.push({ finding, signals });
      buckets.set(key, current);
    }

    const groups: SorobanFindingCorrelationGroup[] = [];

    for (const [key, correlatedFindings] of buckets.entries()) {
      if (correlatedFindings.length < minimumGroupSize) {
        standalone.push(...correlatedFindings.map((entry) => entry.finding));
        continue;
      }

      groups.push(this.createGroup(key, correlatedFindings));
    }

    groups.sort((a, b) => {
      const severityDelta =
        SEVERITY_WEIGHT[b.highestSeverity] - SEVERITY_WEIGHT[a.highestSeverity];
      if (severityDelta !== 0) return severityDelta;
      return b.findingCount - a.findingCount;
    });

    return {
      generatedAt: (options.generatedAt ?? new Date()).toISOString(),
      summary: {
        totalFindings: findings.length,
        correlatedGroups: groups.length,
        standaloneFindings: standalone.length,
        affectedFiles: this.uniqueSorted(findings.map((finding) => finding.location.file)),
        highestSeverity: this.highestSeverity(findings),
      },
      groups,
      standaloneFindings: standalone,
    };
  }

  public renderMarkdown(report: SorobanFindingCorrelationReport): string {
    const lines = [
      "# Soroban Finding Correlation Report",
      "",
      `- Total findings: ${report.summary.totalFindings}`,
      `- Correlated groups: ${report.summary.correlatedGroups}`,
      `- Standalone findings: ${report.summary.standaloneFindings}`,
      `- Highest severity: ${report.summary.highestSeverity ?? "none"}`,
      "",
    ];

    if (report.groups.length === 0) {
      lines.push("No related finding groups were detected.");
      return lines.join("\n");
    }

    lines.push("## Correlated groups", "");

    for (const group of report.groups) {
      lines.push(`### ${group.title}`);
      lines.push(`- Findings: ${group.findingCount}`);
      lines.push(`- Highest severity: ${group.highestSeverity}`);
      lines.push(`- Files: ${group.affectedFiles.join(", ")}`);
      if (group.affectedFunctions.length > 0) {
        lines.push(`- Functions: ${group.affectedFunctions.join(", ")}`);
      }
      lines.push(`- Rules: ${group.ruleIds.join(", ")}`);
      lines.push(`- Shared signals: ${group.sharedSignals.join(", ")}`);
      lines.push(`- Recommendation: ${group.recommendation}`);
      lines.push("");
    }

    return lines.join("\n").trimEnd();
  }

  private createGroup(
    key: string,
    correlatedFindings: SorobanCorrelatedFinding[],
  ): SorobanFindingCorrelationGroup {
    const findings = correlatedFindings.map((entry) => entry.finding);
    const sharedSignals = this.intersectSignals(correlatedFindings);
    const affectedFiles = this.uniqueSorted(findings.map((finding) => finding.location.file));
    const affectedFunctions = this.uniqueSorted(
      correlatedFindings
        .map((entry) => entry.signals.find((signal) => signal.startsWith("function:")))
        .filter((signal): signal is string => Boolean(signal))
        .map((signal) => signal.slice("function:".length)),
    );
    const ruleIds = this.uniqueSorted(findings.map((finding) => finding.ruleId));
    const highestSeverity = this.highestSeverity(findings) ?? Severity.INFO;

    return {
      id: this.slugify(key),
      title: this.titleForGroup(key, affectedFunctions),
      findingCount: findings.length,
      highestSeverity,
      affectedFiles,
      affectedFunctions,
      ruleIds,
      sharedSignals,
      findings: correlatedFindings,
      recommendation: this.recommendationForGroup(sharedSignals, ruleIds),
    };
  }

  private buildSignals(finding: Finding): string[] {
    const metadata = finding.metadata ?? {};
    const rootCauseId = this.firstString(metadata.rootCauseId, metadata.rootCause, metadata.correlationId);
    const functionName = this.firstString(metadata.functionName, metadata.function, metadata.symbol);
    const contractName = this.firstString(metadata.contractName, metadata.contract);

    const signals = [`file:${finding.location.file}`];

    if (rootCauseId) {
      signals.push(`rootCauseId:${rootCauseId}`);
    }

    if (functionName) {
      signals.push(`function:${functionName}`);
    }

    if (contractName) {
      signals.push(`contract:${contractName}`);
    }

    return signals;
  }

  private selectBucketKey(signals: string[]): string | null {
    const explicitRoot = signals.find((signal) => signal.startsWith("rootCauseId:"));
    if (explicitRoot) return explicitRoot;

    const file = signals.find((signal) => signal.startsWith("file:"));
    const functionName = signals.find((signal) => signal.startsWith("function:"));
    if (file && functionName) {
      return `${file}|${functionName}`;
    }

    const contract = signals.find((signal) => signal.startsWith("contract:"));
    if (contract && functionName) {
      return `${contract}|${functionName}`;
    }

    return null;
  }

  private intersectSignals(entries: SorobanCorrelatedFinding[]): string[] {
    if (entries.length === 0) return [];

    const [first, ...rest] = entries;
    return first.signals
      .filter((signal) => rest.every((entry) => entry.signals.includes(signal)))
      .sort();
  }

  private highestSeverity(findings: Finding[]): Severity | null {
    if (findings.length === 0) return null;

    return findings.reduce((highest, finding) => {
      return SEVERITY_WEIGHT[finding.severity] > SEVERITY_WEIGHT[highest]
        ? finding.severity
        : highest;
    }, findings[0].severity);
  }

  private recommendationForGroup(sharedSignals: string[], ruleIds: string[]): string {
    const rootCause = sharedSignals.find((signal) => signal.startsWith("rootCauseId:"));
    const functionSignal = sharedSignals.find((signal) => signal.startsWith("function:"));

    if (rootCause) {
      return `Fix the shared root cause once, then rerun the affected rules: ${ruleIds.join(", ")}.`;
    }

    if (functionSignal) {
      return `Review the shared function once and address the related rule findings together: ${ruleIds.join(", ")}.`;
    }

    return `Review these findings together before patching so one change does not leave a related issue behind.`;
  }

  private titleForGroup(key: string, affectedFunctions: string[]): string {
    if (key.startsWith("rootCauseId:")) {
      return `Root cause ${key.slice("rootCauseId:".length)}`;
    }

    if (affectedFunctions.length > 0) {
      return `Related findings in ${affectedFunctions.join(", ")}`;
    }

    return "Related Soroban findings";
  }

  private firstString(...values: unknown[]): string | undefined {
    for (const value of values) {
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
      }
    }

    return undefined;
  }

  private uniqueSorted(values: string[]): string[] {
    return Array.from(new Set(values)).sort();
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }
}
