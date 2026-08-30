import { SorobanLedgerWriteCostAnalyzer } from '../write-cost-analyzer';

describe('SorobanLedgerWriteCostAnalyzer', () => {
  let analyzer: SorobanLedgerWriteCostAnalyzer;

  beforeEach(() => {
    analyzer = new SorobanLedgerWriteCostAnalyzer();
  });

  it('should detect ledger writes across instance, persistent, and temporary tiers', () => {
    const code = `
      #[contractimpl]
      impl SampleContract {
        pub fn update_all(env: Env, user: Address, val: i128) {
          env.storage().instance().set(&DataKey::Admin, &user);
          env.storage().persistent().set(&user, &val);
          env.storage().temporary().remove(&DataKey::TempNonce);
        }
      }
    `;

    const result = analyzer.analyze(code);
    expect(result.writes.length).toBe(3);
    expect(result.writes[0].storageTier).toBe('instance');
    expect(result.writes[0].opType).toBe('set');
    expect(result.writes[1].storageTier).toBe('persistent');
    expect(result.writes[2].storageTier).toBe('temporary');
    expect(result.writes[2].opType).toBe('remove');
  });

  it('should detect repeated writes to the same key and flag redundant mutation', () => {
    const code = `
      #[contractimpl]
      impl SampleContract {
        pub fn update_state(env: Env, key: Symbol, v1: i128, v2: i128) {
          env.storage().instance().set(&key, &v1);
          // additional logic
          env.storage().instance().set(&key, &v2);
        }
      }
    `;

    const result = analyzer.analyze(code);
    expect(result.metrics.repeatedWriteCount).toBe(1);
    expect(result.suggestions.some((s) => s.category === 'redundant_mutation' && s.affectedKey === 'key')).toBe(true);
  });

  it('should detect ledger writes in loops and flag high severity', () => {
    const code = `
      #[contractimpl]
      impl SampleContract {
        pub fn batch_insert(env: Env, items: Vec<(Address, i128)>) {
          for item in items.iter() {
            env.storage().persistent().set(&item.0, &item.1);
          }
        }
      }
    `;

    const result = analyzer.analyze(code);
    expect(result.metrics.loopWriteCount).toBe(1);
    const loopSuggestion = result.suggestions.find((s) => s.category === 'loop_hoisting');
    expect(loopSuggestion).toBeDefined();
    expect(loopSuggestion?.severity).toBe('high');
  });

  it('should identify unnecessary mutations in query / getter functions', () => {
    const code = `
      #[contractimpl]
      impl SampleContract {
        pub fn get_user_balance(env: Env, user: Address) -> i128 {
          env.storage().instance().set(&DataKey::LastAccessed, &123);
          0
        }
      }
    `;

    const result = analyzer.analyze(code);
    expect(result.unnecessaryMutations.length).toBeGreaterThan(0);
    expect(result.unnecessaryMutations[0].reason).toContain('view/query function');
  });
});
