import { SorobanLedgerReadCostAnalyzer } from './read-cost-analyzer';
import { SorobanLedgerWriteCostAnalyzer } from './write-cost-analyzer';
import { LedgerCostAnalysisReport } from './types';

export class SorobanLedgerCostAnalyzer {
  private readAnalyzer: SorobanLedgerReadCostAnalyzer;
  private writeAnalyzer: SorobanLedgerWriteCostAnalyzer;

  constructor() {
    this.readAnalyzer = new SorobanLedgerReadCostAnalyzer();
    this.writeAnalyzer = new SorobanLedgerWriteCostAnalyzer();
  }

  /**
   * Run comprehensive ledger read and write cost analysis on Soroban smart contract source code.
   */
  public analyze(sourceCode: string, fileName: string = 'contract.rs'): LedgerCostAnalysisReport {
    const readAnalysis = this.readAnalyzer.analyze(sourceCode, fileName);
    const writeAnalysis = this.writeAnalyzer.analyze(sourceCode, fileName);

    const totalEstimatedStroops =
      readAnalysis.metrics.estimatedReadEntryFeeStroops +
      writeAnalysis.metrics.estimatedWriteEntryFeeStroops;

    const allSuggestions = [...readAnalysis.suggestions, ...writeAnalysis.suggestions];
    const highSeverityIssues = allSuggestions.filter(
      (s) => s.severity === 'high' || s.severity === 'critical'
    ).length;

    const potentialSavings =
      readAnalysis.metrics.repeatedReadCount * 5000 +
      readAnalysis.metrics.loopReadCount * 15000 +
      writeAnalysis.metrics.repeatedWriteCount * 10000 +
      writeAnalysis.metrics.loopWriteCount * 30000;

    return {
      readAnalysis,
      writeAnalysis,
      totalEstimatedStroops,
      summary: {
        totalOperations: readAnalysis.reads.length + writeAnalysis.writes.length,
        highSeverityIssues,
        totalSavingsPotential: `~${potentialSavings} stroops per typical execution`,
      },
    };
  }
}
