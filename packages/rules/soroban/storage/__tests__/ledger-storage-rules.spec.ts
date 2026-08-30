import { SorobanLedgerReadCostRule } from '../ledger-read-cost.rule';
import { SorobanLedgerWriteCostRule } from '../ledger-write-cost.rule';

describe('Soroban Storage Rules', () => {
  describe('SorobanLedgerReadCostRule', () => {
    const rule = new SorobanLedgerReadCostRule();

    it('should detect repeated storage reads in same function', () => {
      const code = `
        #[contractimpl]
        impl MyContract {
          pub fn get_data(env: Env, id: u32) -> u64 {
            let a = env.storage().instance().get(&id).unwrap_or(0);
            let b = env.storage().instance().get(&id).unwrap_or(0);
            a + b
          }
        }
      `;

      const violations = rule.evaluate(code);
      expect(violations.length).toBe(1);
      expect(violations[0].ruleId).toBe(SorobanLedgerReadCostRule.RULE_ID);
      expect(violations[0].severity).toBe('medium');
      expect(violations[0].key).toBe('id');
    });

    it('should detect loop reads with high severity', () => {
      const code = `
        #[contractimpl]
        impl MyContract {
          pub fn sum_all(env: Env, items: Vec<u32>) -> u64 {
            let mut sum = 0;
            for id in items.iter() {
              sum += env.storage().persistent().get(&id).unwrap_or(0);
            }
            sum
          }
        }
      `;

      const violations = rule.evaluate(code);
      expect(violations.some((v) => v.severity === 'high' && v.message.includes('inside loop'))).toBe(true);
    });
  });

  describe('SorobanLedgerWriteCostRule', () => {
    const rule = new SorobanLedgerWriteCostRule();

    it('should detect repeated storage writes to the same key', () => {
      const code = `
        #[contractimpl]
        impl MyContract {
          pub fn update(env: Env, key: Symbol, v1: i32, v2: i32) {
            env.storage().instance().set(&key, &v1);
            env.storage().instance().set(&key, &v2);
          }
        }
      `;

      const violations = rule.evaluate(code);
      expect(violations.length).toBe(1);
      expect(violations[0].ruleId).toBe(SorobanLedgerWriteCostRule.RULE_ID);
      expect(violations[0].severity).toBe('medium');
    });

    it('should detect loop writes with high severity', () => {
      const code = `
        #[contractimpl]
        impl MyContract {
          pub fn populate(env: Env, list: Vec<u32>) {
            for item in list.iter() {
              env.storage().persistent().set(&item, &1);
            }
          }
        }
      `;

      const violations = rule.evaluate(code);
      expect(violations.some((v) => v.severity === 'high' && v.message.includes('inside loop'))).toBe(true);
    });
  });
});
