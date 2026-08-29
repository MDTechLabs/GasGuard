import { ConstantPropagationAnalyzer, OptimizationFinding } from '../../../../packages/analyzers/soroban/optimization/constant-propagation.analyzer';

export class OptimizationEngineService {
  private analyzer = new ConstantPropagationAnalyzer();

  analyze(content: string): OptimizationFinding[] {
    return this.analyzer.analyze(content);
  }

  analyzeContract(filePath: string, content: string): { filePath: string; findings: OptimizationFinding[] } {
    return {
      filePath,
      findings: this.analyze(content),
    };
  }
}
