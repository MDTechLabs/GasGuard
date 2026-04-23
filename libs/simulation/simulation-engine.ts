import { ChainAdapter, SimulationResult } from '@chains/base-adapter';

export interface ComparisonReport {
  before: SimulationResult;
  after: SimulationResult;
  gasSaved: number;
  percentageImprovement: number;
  opcodeDiff: Record<string, number>;
}

export class SimulationEngine {
  constructor(private adapter: ChainAdapter) {}

  async simulateExecution(code: string, method: string, params: any[]): Promise<SimulationResult> {
    return this.adapter.simulate(code, method, params);
  }

  async compareOptimizations(originalCode: string, optimizedCode: string, method: string, params: any[]): Promise<ComparisonReport> {
    const [before, after] = await Promise.all([
      this.simulateExecution(originalCode, method, params),
      this.simulateExecution(optimizedCode, method, params),
    ]);

    const gasSaved = before.gasUsed - after.gasUsed;
    const percentageImprovement = (gasSaved / before.gasUsed) * 100;

    const opcodeDiff: Record<string, number> = {};
    // Calculate opcode frequency diff if available
    const beforeOps = this.getOpcodeFrequencies(before.opcodes);
    const afterOps = this.getOpcodeFrequencies(after.opcodes);

    const allOps = new Set([...Object.keys(beforeOps), ...Object.keys(afterOps)]);
    for (const op of allOps) {
      opcodeDiff[op] = (afterOps[op] || 0) - (beforeOps[op] || 0);
    }

    return {
      before,
      after,
      gasSaved,
      percentageImprovement,
      opcodeDiff,
    };
  }

  private getOpcodeFrequencies(opcodes: any[]): Record<string, number> {
    const freqs: Record<string, number> = {};
    for (const op of opcodes) {
      freqs[op.opcode] = (freqs[op.opcode] || 0) + 1;
    }
    return freqs;
  }
}
