import { describe, expect, it } from '@jest/globals';
import { SorobanLedgerAccessAnalyzer } from '../ledger-access-analyzer';

describe('SorobanLedgerAccessAnalyzer', () => {
  const analyzer = new SorobanLedgerAccessAnalyzer();

  it('correctly tracks and classifies ledger reads and writes across storage tiers', () => {
    const sampleContract = `
      pub fn deposit(env: Env, user: Address, amount: i128) {
        let admin = Symbol::new(&env, "admin");
        let is_admin: bool = env.storage().instance().has(&admin);
        let balance: i128 = env.storage().persistent().get(&user).unwrap_or(0);
        
        env.storage().persistent().set(&user, &(balance + amount));
        env.storage().temporary().set(&Symbol::new(&env, "nonce"), &1);
      }
    `;

    const result = analyzer.analyze(sampleContract, 'deposit_contract.rs');

    expect(result.contractPath).toBe('deposit_contract.rs');
    expect(result.accesses.length).toBe(4);

    // Classifications
    const instanceHas = result.accesses.find((a) => a.storageTier === 'instance');
    expect(instanceHas?.accessType).toBe('has');
    expect(instanceHas?.key).toBe('admin');

    const persistentGet = result.accesses.find((a) => a.storageTier === 'persistent' && a.accessType === 'read');
    expect(persistentGet).toBeDefined();

    const persistentSet = result.accesses.find((a) => a.storageTier === 'persistent' && a.accessType === 'write');
    expect(persistentSet).toBeDefined();

    const tempSet = result.accesses.find((a) => a.storageTier === 'temporary');
    expect(tempSet?.key).toBe('nonce');

    // Metrics
    expect(result.metrics.totalReads).toBe(2);
    expect(result.metrics.totalWrites).toBe(2);
    expect(result.metrics.instanceAccesses).toBe(1);
    expect(result.metrics.persistentAccesses).toBe(2);
    expect(result.metrics.temporaryAccesses).toBe(1);
    expect(result.metrics.uniqueKeysAccessed).toBe(3);
  });

  it('detects repeated reads to the same key and generates optimization findings', () => {
    const sampleContract = `
      pub fn calculate_rewards(env: Env, user: Address) -> i128 {
        let count = Symbol::new(&env, "count");
        let v1 = env.storage().persistent().get(&count).unwrap_or(0);
        let v2 = env.storage().persistent().get(&count).unwrap_or(0);
        let v3 = env.storage().persistent().get(&count).unwrap_or(0);
        v1 + v2 + v3
      }
    `;

    const result = analyzer.analyze(sampleContract);

    expect(result.repeatedAccesses.length).toBe(1);
    expect(result.repeatedAccesses[0].key).toBe('count');
    expect(result.repeatedAccesses[0].redundantReadsCount).toBe(2);
    expect(result.metrics.repeatedReads).toBe(2);

    const finding = result.findings.find((f) => f.ruleId === 'SOROBAN-LEDGER-01');
    expect(finding).toBeDefined();
    expect(finding?.message).toContain("Repeated ledger read detected for key 'count'");
  });

  it('detects ledger accesses inside loops', () => {
    const loopContract = `
      pub fn batch_process(env: Env, users: Vec<Address>) {
        for user in users.iter() {
          let bal = env.storage().persistent().get(&user).unwrap_or(0);
          env.storage().persistent().set(&user, &(bal + 10));
        }
      }
    `;

    const result = analyzer.analyze(loopContract);

    expect(result.metrics.loopAccesses).toBe(2);
    const loopFindings = result.findings.filter((f) => f.ruleId === 'SOROBAN-LEDGER-03');
    expect(loopFindings.length).toBeGreaterThan(0);
    expect(loopFindings[0].message).toContain('inside a loop structure');
  });

  it('detects multiple writes to the same key in a single execution flow', () => {
    const multiWriteContract = `
      pub fn update_totals(env: Env) {
        let total_key = Symbol::new(&env, "total");
        env.storage().instance().set(&total_key, &100);
        env.storage().instance().set(&total_key, &200);
      }
    `;

    const result = analyzer.analyze(multiWriteContract);

    expect(result.metrics.repeatedWrites).toBe(1);
    const writeFinding = result.findings.find((f) => f.ruleId === 'SOROBAN-LEDGER-02');
    expect(writeFinding).toBeDefined();
    expect(writeFinding?.severity).toBe('high');
  });
});
