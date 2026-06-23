import { SolidityAnalyzer } from "../../../../../libs/engine/analyzers/solidity-analyzer";
import { detectDuplicateEventEmissions } from "../../../../../rules/auditability/events/detect-duplicate-event-emissions";

export class SolidityAnalyzerWrapper {
  private analyzer: SolidityAnalyzer;

  constructor() {
    this.analyzer = new SolidityAnalyzer();
  }

  async analyze(source: string) {
    const result = await this.analyzer.analyze(source, "contract.sol");

    const issues = result.findings.map((finding) => ({
      ruleId: finding.ruleId,
      severity: finding.severity,
      message: finding.message,
      line: finding.location.startLine,
      suggestion: finding.suggestedFix?.description,
    }));

    const duplicateEvents = detectDuplicateEventEmissions(source);
    for (const violation of duplicateEvents.violations) {
      issues.push({
        ruleId: "detect-duplicate-event-emissions",
        severity: "medium",
        message: `Duplicate event emission detected at lines ${[
          violation.firstLine,
          ...violation.duplicateLines,
        ].join(", ")}`,
        line: violation.firstLine,
        suggestion: duplicateEvents.suggestion,
      });
    }

    return { issues };
  }
}
