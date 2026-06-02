import { SolidityAnalyzer } from "../../../../libs/engine/analyzers/solidity-analyzer";

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

    return { issues };
  }
}
