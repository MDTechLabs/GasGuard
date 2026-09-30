import { PolicyCommandReport, PolicyIssue } from "./types";

export function formatPolicyReportText(report: PolicyCommandReport): string {
  const status = report.valid
    ? report.warnings.length > 0
      ? "passed with warnings"
      : "passed"
    : "failed";
  const lines = [
    `Policy validation ${status}`,
    `file: ${report.file}`,
    `correlationId: ${report.correlationId}`,
    `errors: ${report.errors.length}`,
    `warnings: ${report.warnings.length}`,
    `defaultsApplied: ${
      report.defaultsApplied.length > 0
        ? report.defaultsApplied.join(", ")
        : "(none)"
    }`,
    `durationMs: ${report.metrics.durationMs}`,
    `strict: ${report.metrics.strict}`,
  ];

  for (const entry of report.errors) {
    lines.push(formatIssue("error", entry));
  }
  for (const entry of report.warnings) {
    lines.push(formatIssue("warning", entry));
  }

  return `${lines.join("\n")}\n`;
}

export function formatPolicyReportJson(report: PolicyCommandReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function formatIssue(kind: "error" | "warning", entry: PolicyIssue): string {
  return `[${kind}] [${entry.code}] ${entry.path}: ${entry.message}`;
}
