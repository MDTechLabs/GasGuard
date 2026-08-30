import { SorobanLedgerReadCostAnalyzer } from '../read-cost-analyzer';

describe('SorobanLedgerReadCostAnalyzer', () => {
  let analyzer: SorobanLedgerReadCostAnalyzer;

  beforeEach(() => {
    analyzer = new SorobanLedgerReadCostAnalyzer();
  });

  it('should detect ledger reads across instance, persistent, and temporary tiers', () => {
    const code = `
      #[contractimpl]
      impl SampleContract {
        pub fn query_all(env: Env, user: Address) {
          let a = env.storage().instance().get(&DataKey::Admin);
          let b = env.storage().persistent().get(&user);
          let c = env.storage().temporary().has(&DataKey::Nonce);
        }
      }
    `;

    const result = analyzer.analyze(code);
    expect(result.reads.length).toBe(3);
    expect(result.reads[0].storageTier).toBe('instance');
    expect(result.reads[0].opType).toBe('get');
    expect(result.reads[1].storageTier).toBe('persistent');
    expect(result.reads[2].storageTier).toBe('temporary');
    expect(result.reads[2].opType).toBe('has');
  });

  it('should detect and track repeated reads to the same key', () => {
    const code = `
      #[contractimpl]
      impl SampleContract {
        pub fn calc(env: Env, user: Address) -> i128 {
          let x = env.storage().instance().get(&user).unwrap_or(0);
          // logic
          let y = env.storage().instance().get(&user).unwrap_or(0);
          x + y
        }
      }
    `;

    const result = analyzer.analyze(code);
    expect(result.metrics.repeatedReadCount).toBe(1);
    expect(result.suggestions.some((s) => s.category === 'caching' && s.affectedKey === 'user')).toBe(true);
  });

  it('should detect ledger reads inside loop bodies and flag high severity', () => {
    const code = `
      #[contractimpl]
      impl SampleContract {
        pub fn process_users(env: Env, users: Vec<Address>) -> i128 {
          let mut total = 0;
          for user in users.iter() {
            let balance = env.storage().persistent().get(&user).unwrap_or(0);
            total += balance;
          }
          total
        }
      }
    `;

    const result = analyzer.analyze(code);
    expect(result.metrics.loopReadCount).toBe(1);
    const loopSuggestion = result.suggestions.find((s) => s.category === 'loop_hoisting');
    expect(loopSuggestion).toBeDefined();
    expect(loopSuggestion?.severity).toBe('high');
  });

  it('should calculate estimated read stroop fees and CPU metrics', () => {
    const code = `
      #[contractimpl]
      impl SampleContract {
        pub fn check(env: Env, k1: Symbol, k2: Symbol) {
          let v1 = env.storage().instance().get(&k1);
          let v2 = env.storage().instance().get(&k2);
        }
      }
    `;

    const result = analyzer.analyze(code);
    expect(result.metrics.totalReads).toBe(2);
    expect(result.metrics.estimatedReadEntryFeeStroops).toBe(10000);
    expect(result.metrics.estimatedCpuInstructions).toBeGreaterThan(0);
  });
});
