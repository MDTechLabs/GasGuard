import { ASTMutator, MutatedVariant } from './ast-mutator';

export interface MutantTestResult {
  mutantId: string;
  mutationType: string;
  status: 'KILLED' | 'SURVIVED';
  detectedByRules: string[];
  description: string;
}

export interface MutationReport {
  totalMutants: number;
  killedMutants: number;
  survivedMutants: number;
  killScorePercentage: number;
  results: MutantTestResult[];
}

export type RuleDetectorFn = (code: string) => string[];

export class MutationRunner {
  private readonly mutator: ASTMutator;
  private readonly ruleDetector: RuleDetectorFn;

  constructor(ruleDetector?: RuleDetectorFn) {
    this.mutator = new ASTMutator();
    this.ruleDetector = ruleDetector || this.defaultGasGuardRuleDetector;
  }

  /**
   * Runs mutation testing suite against target contract code to validate rule detection precision.
   * @param contractCode Original valid smart contract code
   */
  public runMutationTest(contractCode: string): MutationReport {
    const mutants: MutatedVariant[] = this.mutator.generateMutations(contractCode);
    const results: MutantTestResult[] = [];
    let killedCount = 0;

    for (const mutant of mutants) {
      const detectedRules = this.ruleDetector(mutant.mutatedCode);
      const isKilled = detectedRules.length > 0;

      if (isKilled) {
        killedCount++;
      }

      results.push({
        mutantId: mutant.id,
        mutationType: mutant.mutationType,
        status: isKilled ? 'KILLED' : 'SURVIVED',
        detectedByRules: detectedRules,
        description: mutant.description,
      });
    }

    const totalMutants = mutants.length;
    const killScorePercentage =
      totalMutants > 0 ? Math.round((killedCount / totalMutants) * 10000) / 100 : 100.0;

    return {
      totalMutants,
      killedMutants: killedCount,
      survivedMutants: totalMutants - killedCount,
      killScorePercentage,
      results,
    };
  }

  /**
   * Default fallback detector validating standard GasGuard gas anti-pattern rules.
   */
  private defaultGasGuardRuleDetector(code: string): string[] {
    const triggeredRules: string[] = [];

    if (/\buint8\b/.test(code) && !/uint8\s+\[/.test(code)) {
      triggeredRules.push('GAS-001: Suboptimal Type Sizing');
    }
    if (/< arr\.length/.test(code) || /arr\.length > 0/.test(code)) {
      triggeredRules.push('GAS-002: Un-cached Loop Array Length');
    }
    if (/\bmemory\b/.test(code) && /function\s+[a-zA-Z0-9_]+\s*\([^)]*memory/.test(code)) {
      triggeredRules.push('GAS-003: Memory Over Calldata');
    }
    if (/i\+\+/.test(code) || /j\+\+/.test(code)) {
      triggeredRules.push('GAS-004: Postfix Increment Overhead');
    }
    if (/balances\[msg\.sender\]/.test(code)) {
      triggeredRules.push('GAS-005: Redundant Storage Read');
    }

    return triggeredRules;
  }
}
