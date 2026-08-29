import { detectStorageAccessInsideLoops } from '../src/storage/storage-in-loop-rule';
import { analyzeStorageInLoops } from '../../../analyzers/soroban/storage/storage-in-loop-analyzer';

describe('Detect Storage Access Inside Expensive Soroban Loops (#875)', () => {
  const CONTRACT_WITH_STORAGE_LOOPS = `
    pub fn update_user_balances(env: Env, users: Vec<Address>, delta: i128) {
      for user in users.iter() {
        let mut balance: i128 = env.storage().persistent().get(&user).unwrap_or(0);
        balance += delta;
        env.storage().persistent().set(&user, &balance);
      }
    }

    pub fn read_config_in_loop(env: Env, items: Vec<u32>) {
      for item in items.iter() {
        let config: u32 = env.storage().instance().get(&Symbol::new(&env, "cfg")).unwrap_or(0);
      }
    }

    pub fn clean_single_storage(env: Env, key: Symbol, value: u32) {
      env.storage().instance().set(&key, &value);
    }
  `;

  test('detects both storage reads and writes in loop bodies and distinguishes opTypes', () => {
    const findings = detectStorageAccessInsideLoops(CONTRACT_WITH_STORAGE_LOOPS);

    expect(findings.length).toBe(3); // 1 read + 1 write in update_user_balances, 1 read in read_config_in_loop

    const writes = findings.filter((f) => f.opType === 'write');
    const reads = findings.filter((f) => f.opType === 'read');

    expect(writes.length).toBe(1);
    expect(reads.length).toBe(2);

    expect(writes[0].scope).toBe('persistent');
    expect(writes[0].severity).toBe('high');
    expect(writes[0].estimatedCpuInstructions).toBeGreaterThan(0);
  });

  test('extracts loop bound type and storage key', () => {
    const findings = detectStorageAccessInsideLoops(CONTRACT_WITH_STORAGE_LOOPS);

    const configRead = findings.find((f) => f.scope === 'instance');
    expect(configRead).toBeDefined();
    expect(configRead?.boundType).toBe('collection_iterator');
  });

  test('analyzeStorageInLoops aggregates counts and generates recommendations', () => {
    const report = analyzeStorageInLoops(CONTRACT_WITH_STORAGE_LOOPS);

    expect(report.totalReadsInLoops).toBe(2);
    expect(report.totalWritesInLoops).toBe(1);
    expect(report.recommendations.some((r) => r.includes('Batch storage updates'))).toBe(true);
    expect(report.recommendations.some((r) => r.includes('Cache read values'))).toBe(true);
  });

  test('returns 0 findings for storage operations outside loops', () => {
    const clean = `
      pub fn set_data(env: Env, key: Symbol, val: u32) {
        env.storage().instance().set(&key, &val);
      }
    `;

    const findings = detectStorageAccessInsideLoops(clean);
    expect(findings.length).toBe(0);
  });
});
