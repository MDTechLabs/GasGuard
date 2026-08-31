import {
  detectMutableUpgradeConfigFindings,
  detectUpgradeConfigWrites,
  MutableUpgradeConfigAnalyzer,
} from '../src/upgrades/mutable-upgrade-config-rule';

describe('Mutable Soroban Upgrade Configuration Rules (#926)', () => {
  const SAMPLE = `
    #[contractimpl]
    impl UpgradeableImpl {
        pub fn set_wasm_hash(env: Env, wasm_hash: BytesN<32>) {
            env.storage().persistent().set(&Symbol::new(&env, "wasm_hash"), &wasm_hash);
        }

        pub fn set_target(env: Env, admin: Address, target: BytesN<32>) {
            admin.require_auth();
            env.storage().instance().set(&Symbol::new(&env, "next_wasm"), &target);
        }
    }
  `;

  test('detectUpgradeConfigWrites tracks both config writes', () => {
    const writes = detectUpgradeConfigWrites(SAMPLE);
    expect(writes).toHaveLength(2);
    expect(writes.map((w) => w.key).sort()).toEqual(['next_wasm', 'wasm_hash']);
  });

  test('detectMutableUpgradeConfigFindings flags only the unauthored write', () => {
    const findings = detectMutableUpgradeConfigFindings(SAMPLE);
    expect(findings).toHaveLength(1);
    expect(findings[0].functionName).toBe('set_wasm_hash');
    expect(findings[0].severity).toBe('high');
    expect(findings[0].ruleId).toBe('soroban-mutable-upgrade-config');
  });

  test('the analyzer class is exposed through the rule namespace', () => {
    expect(MutableUpgradeConfigAnalyzer.RULE_ID).toBe('soroban-mutable-upgrade-config');
    const report = new MutableUpgradeConfigAnalyzer().analyze(SAMPLE);
    expect(report.totalWriteCount).toBe(2);
    expect(report.unsafeWriteCount).toBe(1);
  });
});