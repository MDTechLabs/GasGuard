import {
  LedgerAccessFinding,
  LedgerAnalysisResult,
  SorobanLedgerAccessAnalyzer,
} from '../../../analyzers/soroban/ledger';

export interface LedgerRuleWarning {
  line: number;
  column?: number;
  ruleId: string;
  severity: 'high' | 'medium' | 'low';
  key?: string;
  message: string;
  suggestion: string;
  estimatedSavings?: string;
}

export class SorobanLedgerAccessRule {
  public static readonly RULE_ID = 'soroban-ledger-access';

  private readonly analyzer: SorobanLedgerAccessAnalyzer;

  constructor() {
    this.analyzer = new SorobanLedgerAccessAnalyzer();
  }

  public analyze(sourceCode: string, contractPath: string = 'contract.rs'): LedgerRuleWarning[] {
    const analysis: LedgerAnalysisResult = this.analyzer.analyze(sourceCode, contractPath);

    return analysis.findings.map((f: LedgerAccessFinding) => ({
      line: f.line,
      ruleId: f.ruleId,
      severity: f.severity,
      key: f.key,
      message: f.message,
      suggestion: f.recommendation,
      estimatedSavings: f.estimatedSavings,
    }));
  }

  public getFullAnalysis(sourceCode: string, contractPath: string = 'contract.rs'): LedgerAnalysisResult {
    return this.analyzer.analyze(sourceCode, contractPath);
  }
}
