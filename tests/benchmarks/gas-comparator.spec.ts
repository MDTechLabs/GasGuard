import { GasComparator, GasBenchmarkFixture, GasExecutionTrace, GasExecutionExecutor } from './gas-comparator';

class FakeExecutor implements GasExecutionExecutor {
  async execute(contract: string): Promise<GasExecutionTrace> {
    const baseCost = contract.includes('storage') ? 12000 : 8000;
    const extraCost = (contract.match(/set\(|get\(/g) || []).length * 2000;
    return {
      gasUsed: baseCost + extraCost,
      resourceUnits: baseCost + extraCost,
      status: 'success',
    };
  }
}

describe('GasComparator', () => {
  it('compares before and after fixtures against an estimated delta', async () => {
    const fixture: GasBenchmarkFixture = {
      name: 'storage-optimization',
      description: 'Optimizes storage writes in a Soroban contract',
      originalContract: 'fn transfer() { storage.set("admin"); storage.set("value"); }',
      refactoredContract: 'fn transfer() { storage.set("value"); }',
      method: 'transfer',
      estimatedGasDelta: 4000,
    };

    const comparator = new GasComparator({ executor: new FakeExecutor() });
    const report = await comparator.benchmarkFixture(fixture);

    expect(report.fixtureName).toBe('storage-optimization');
    expect(report.original.gasUsed).toBeGreaterThan(0);
    expect(report.refactored.gasUsed).toBeGreaterThan(0);
    expect(report.actualDelta).toBeGreaterThan(0);
    expect(report.estimatedDelta).toBe(4000);
    expect(report.deltaDifference).toBeGreaterThanOrEqual(0);
    expect(report.accuracy).toBeGreaterThan(0);
  });

  it('exports a stable benchmark report', async () => {
    const comparator = new GasComparator({ executor: new FakeExecutor() });
    const fixture: GasBenchmarkFixture = {
      name: 'simple',
      originalContract: 'fn foo() { storage.set("x"); }',
      refactoredContract: 'fn foo() { }',
      method: 'foo',
      estimatedGasDelta: 1000,
    };

    const report = await comparator.benchmarkFixture(fixture);
    const exported = comparator.exportReport([report]);

    expect(exported).toContain('simple');
    expect(exported).toContain('actualDelta');
  });

  it('loads benchmark fixtures from a directory', () => {
    const comparator = new GasComparator({ executor: new FakeExecutor() });
    const fixtures = comparator.loadFixturesFromDirectory('./tests/benchmarks/fixtures');

    expect(fixtures).toHaveLength(1);
    expect(fixtures[0].name).toBe('storage-optimization');
  });
});
