import {
  detectUpgradeabilityFindings,
  analyzeSorobanUpgradeability,
  UpgradeabilityAnalyzer,
} from '../src/upgrades/upgradeability-rule';

describe('Soroban Upgradeability Rules (#924)', () => {
  const GUARDED = `
    #[contractimpl]
    impl UpgradeableImpl {
        pub fn upgrade(env: Env, admin: Address, new_wasm: Bytes) {
            admin.require_auth();
            env.update_current_contract_wasm(&new_wasm);
        }
    }
  `;

  const UNGUARDED = `
    #[contractimpl]
    impl UpgradeableImpl {
        pub fn upgrade(env: Env, new_wasm: Bytes) {
            env.update_current_contract_wasm(&new_wasm);
        }
    }
  `;

  test('detectUpgradeabilityFindings flags unguarded upgrade entry points', () => {
    const findings = detectUpgradeabilityFindings(UNGUARDED);
    const uncontrolled = findings.filter(
      (f) => f.ruleId === 'soroban-upgradeability' && f.title === 'Uncontrolled upgrade entry point',
    );
    expect(uncontrolled.length).toBe(1);
    expect(uncontrolled[0].severity).toBe('critical');
    expect(uncontrolled[0].functionName).toBe('upgrade');
  });

  test('guarded upgrade paths do not produce uncontrolled findings', () => {
    const findings = detectUpgradeabilityFindings(GUARDED);
    const uncontrolled = findings.filter((f) => f.title === 'Uncontrolled upgrade entry point');
    expect(uncontrolled).toHaveLength(0);
    // The "contract is upgradeable" informational finding is still emitted.
    expect(findings.some((f) => f.title === 'Contract is upgradeable')).toBe(true);
  });

  test('analyzeSorobanUpgradeability returns entry points and mechanisms', () => {
    const report = analyzeSorobanUpgradeability(GUARDED);
    expect(report.hasUpgradeablePaths).toBe(true);
    expect(report.upgradeMechanisms).toContain('wasm-replacement');
    expect(report.entryPoints[0].hasAuthorization).toBe(true);
    expect(report.entryPoints[0].authorizedBy).toContain('require_auth');
  });

  test('exposes the analyzer class through the rule namespace', () => {
    expect(UpgradeabilityAnalyzer.RULE_ID).toBe('soroban-upgradeability');
    const report = new UpgradeabilityAnalyzer().analyze(GUARDED);
    expect(report.hasUpgradeablePaths).toBe(true);
  });
});