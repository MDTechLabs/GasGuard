import { ASTMutator } from './ast-mutator';
import { MutationRunner } from './mutation-runner';

describe('ASTMutator', () => {
  let mutator: ASTMutator;

  beforeEach(() => {
    mutator = new ASTMutator();
  });

  it('should generate mutated code variants from a valid contract', () => {
    const validContract = `
      function batchTransfer(address[] calldata recipients, uint256 len) external {
        for (uint256 i = 0; i < len; ++i) {
          balances[recipients[i]] += 100;
        }
      }
    `;

    const mutants = mutator.generateMutations(validContract);
    expect(mutants.length).toBeGreaterThan(0);

    const mutationTypes = mutants.map((m) => m.mutationType);
    expect(mutationTypes).toContain('SUBOPTIMAL_TYPE_SIZING');
    expect(mutationTypes).toContain('UNCACHED_LOOP_LENGTH');
    expect(mutationTypes).toContain('MEMORY_OVER_CALLDATA');
    expect(mutationTypes).toContain('POSTFIX_INCREMENT');
  });
});

describe('MutationRunner', () => {
  let runner: MutationRunner;

  beforeEach(() => {
    runner = new MutationRunner();
  });

  it('should run mutation tests and report 100% mutant kill score when all rules detect mutations', () => {
    const validContract = `
      function processItems(address[] calldata items, uint256 len) external {
        for (uint256 i = 0; i < len; ++i) {
          balances[items[i]] += 1;
        }
      }
    `;

    const report = runner.runMutationTest(validContract);
    expect(report.totalMutants).toBeGreaterThan(0);
    expect(report.killedMutants).toBe(report.totalMutants);
    expect(report.survivedMutants).toBe(0);
    expect(report.killScorePercentage).toBe(100.0);

    for (const result of report.results) {
      expect(result.status).toBe('KILLED');
      expect(result.detectedByRules.length).toBeGreaterThan(0);
    }
  });

  it('should track survived mutants when a custom rule detector fails to flag a mutation', () => {
    // Rule detector that misses SUBOPTIMAL_TYPE_SIZING
    const incompleteDetector = (code: string) => {
      const rules: string[] = [];
      if (/< arr\.length/.test(code) || /arr\.length > 0/.test(code)) {
        rules.push('GAS-002: Un-cached Loop Array Length');
      }
      return rules;
    };

    const runnerWithIncompleteRules = new MutationRunner(incompleteDetector);
    const validContract = `
      function processItems(address[] calldata items, uint256 len) external {
        for (uint256 i = 0; i < len; ++i) {
          balances[items[i]] += 1;
        }
      }
    `;

    const report = runnerWithIncompleteRules.runMutationTest(validContract);
    expect(report.survivedMutants).toBeGreaterThan(0);
    expect(report.killScorePercentage).toBeLessThan(100.0);
  });
});
