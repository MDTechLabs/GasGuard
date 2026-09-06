import {
  detectUnprotectedUpgradeFunctions,
  UnprotectedUpgradeAnalyzer,
} from '../src/upgrades/unprotected-upgrade-rule';

describe('Unprotected Soroban Upgrade Function Rules (#925)', () => {
  const SAMPLE = `
    #[contractimpl]
    impl UpgradeableImpl {
        pub fn upgrade(env: Env, new_wasm: Bytes) {
            env.update_current_contract_wasm(&new_wasm);
        }

        pub fn guarded_upgrade(env: Env, admin: Address, new_wasm: Bytes) {
            admin.require_auth();
            env.update_current_contract_wasm(&new_wasm);
        }
    }
  `;

  test('detectUnprotectedUpgradeFunctions reports the unguarded upgrade only', () => {
    const findings = detectUnprotectedUpgradeFunctions(SAMPLE);
    expect(findings).toHaveLength(1);
    expect(findings[0].functionName).toBe('upgrade');
    expect(findings[0].severity).toBe('critical');
    expect(findings[0].ruleId).toBe('soroban-unprotected-upgrade');
  });

  test('the analyzer class is exposed through the rule namespace', () => {
    expect(UnprotectedUpgradeAnalyzer.RULE_ID).toBe('soroban-unprotected-upgrade');
    const findings = new UnprotectedUpgradeAnalyzer().analyze(SAMPLE);
    expect(findings.some((f) => f.functionName === 'guarded_upgrade')).toBe(false);
  });
});