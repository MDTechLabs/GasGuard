import { SorobanLedgerCostAnalyzer } from '../ledger-cost-analyzer';

describe('SorobanLedgerCostAnalyzer', () => {
  let analyzer: SorobanLedgerCostAnalyzer;

  beforeEach(() => {
    analyzer = new SorobanLedgerCostAnalyzer();
  });

  it('should perform combined read and write cost analysis', () => {
    const code = `
      #[contractimpl]
      impl SampleContract {
        pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
          let from_bal: i128 = env.storage().persistent().get(&from).unwrap_or(0);
          let to_bal: i128 = env.storage().persistent().get(&to).unwrap_or(0);
          
          env.storage().persistent().set(&from, &(from_bal - amount));
          env.storage().persistent().set(&to, &(to_bal + amount));
        }
      }
    `;

    const report = analyzer.analyze(code);
    expect(report.readAnalysis.reads.length).toBe(2);
    expect(report.writeAnalysis.writes.length).toBe(2);
    expect(report.totalEstimatedStroops).toBe(30000); // 2 * 5000 + 2 * 10000
    expect(report.summary.totalOperations).toBe(4);
  });
});
