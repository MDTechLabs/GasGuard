import {
  analyzeUnprotectedUpgrades,
  UnprotectedUpgradeAnalyzer,
} from '../unprotected-upgrade-analyzer';

const UNPROTECTED_WASM_UPGRADE = `
#[contractimpl]
impl UpgradeableImpl {
    pub fn upgrade(env: Env, new_wasm: Bytes) {
        env.update_current_contract_wasm(&new_wasm);
    }

    pub fn set_implementation(env: Env, impl: Bytes) {
        env.storage().instance().set(&Symbol::new(&env, "impl"), &impl);
    }

    pub fn name(env: Env) -> Symbol {
        Symbol::new(&env, "upgradeable")
    }
}
`;

const PROTECTED_UPGRADE = `
#[contractimpl]
impl UpgradeableImpl {
    pub fn upgrade(env: Env, admin: Address, new_wasm: Bytes) {
        admin.require_auth();
        env.update_current_contract_wasm(&new_wasm);
    }

    pub fn only_admin_upgrade(env: Env, new_wasm: Bytes) {
        only_admin();
        env.update_current_contract_wasm(&new_wasm);
    }
}
`;

describe('SorobanUnprotectedUpgradeAnalyzer (#925)', () => {
  it('flags upgrade functions invoked without access control as critical', () => {
    const findings = analyzeUnprotectedUpgrades(UNPROTECTED_WASM_UPGRADE);
    const upgrade = findings.find((f) => f.functionName === 'upgrade');
    expect(upgrade).toBeDefined();
    expect(upgrade?.severity).toBe('critical');
    expect(upgrade?.ruleId).toBe('soroban-unprotected-upgrade');
    expect(upgrade?.location.functionName).toBe('upgrade');
    expect(upgrade?.message).toContain('no access-control check');
  });

  it('flags implementation-swap storage writes as upgrade functions', () => {
    const findings = analyzeUnprotectedUpgrades(UNPROTECTED_WASM_UPGRADE);
    const setImpl = findings.find((f) => f.functionName === 'set_implementation');
    expect(setImpl).toBeDefined();
    // Storage-backed implementation swap is still an uncontrolled upgrade path.
    expect(setImpl?.severity).toBe('critical');
  });

  it('does not treat read-only functions as upgrade functions', () => {
    const findings = analyzeUnprotectedUpgrades(UNPROTECTED_WASM_UPGRADE);
    expect(findings.some((f) => f.functionName === 'name')).toBe(false);
  });

  it('does not flag upgrade functions that authorize first', () => {
    const findings = analyzeUnprotectedUpgrades(PROTECTED_UPGRADE);
    expect(findings).toHaveLength(0);
  });

  it('exposes the analyzer class with a stable rule id', () => {
    expect(UnprotectedUpgradeAnalyzer.RULE_ID).toBe('soroban-unprotected-upgrade');
    const findings = new UnprotectedUpgradeAnalyzer().analyze(UNPROTECTED_WASM_UPGRADE);
    expect(findings.length).toBeGreaterThan(0);
  });
});