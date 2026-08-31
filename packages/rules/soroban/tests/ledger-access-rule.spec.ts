import { describe, expect, it } from '@jest/globals';
import { SorobanLedgerAccessRule } from '../ledger/ledger-access-rule';

describe('SorobanLedgerAccessRule', () => {
  const rule = new SorobanLedgerAccessRule();

  it('flags repeated reads and writes as diagnostic rule warnings', () => {
    const contractCode = `
      pub fn execute_swap(env: Env, token: Address) {
        let key = Symbol::new(&env, "reserves");
        let r1: i128 = env.storage().instance().get(&key).unwrap();
        let r2: i128 = env.storage().instance().get(&key).unwrap();
        
        env.storage().instance().set(&key, &(r1 + 100));
        env.storage().instance().set(&key, &(r2 + 200));
      }
    `;

    const warnings = rule.analyze(contractCode, 'swap.rs');
    expect(warnings.length).toBeGreaterThanOrEqual(2);

    const readWarning = warnings.find((w) => w.ruleId === 'SOROBAN-LEDGER-01');
    expect(readWarning).toBeDefined();
    expect(readWarning?.key).toBe('reserves');
    expect(readWarning?.suggestion).toContain('Cache the ledger entry in a local variable');

    const writeWarning = warnings.find((w) => w.ruleId === 'SOROBAN-LEDGER-02');
    expect(writeWarning).toBeDefined();
    expect(writeWarning?.severity).toBe('high');
  });

  it('provides complete analysis result with metrics via getFullAnalysis', () => {
    const code = `
      pub fn init(env: Env, admin: Address) {
        env.storage().instance().set(&Symbol::new(&env, "admin"), &admin);
      }
    `;

    const fullResult = rule.getFullAnalysis(code);
    expect(fullResult.metrics.totalWrites).toBe(1);
    expect(fullResult.metrics.instanceAccesses).toBe(1);
    expect(fullResult.findings.length).toBe(0);
  });
});
