import {
  analyzeMutableUpgradeConfig,
  detectMutableUpgradeConfigWrites,
  MutableUpgradeConfigAnalyzer,
} from '../mutable-upgrade-config-analyzer';

const MUTABLE_UPGRADE_CONFIG = `
#[contractimpl]
impl UpgradeableImpl {
    pub fn set_wasm_hash(env: Env, wasm_hash: BytesN<32>) {
        env.storage().persistent().set(&Symbol::new(&env, "wasm_hash"), &wasm_hash);
    }

    pub fn set_impl(env: Env, admin: Address, impl: Address) {
        admin.require_auth();
        env.storage().instance().set(&Symbol::new(&env, "implementation"), &impl);
    }

    pub fn set_owner(env: Env, owner: Address) {
        env.storage().instance().set(&Symbol::new(&env, "owner"), &owner);
    }
}
`;

describe('MutableUpgradeConfigAnalyzer (#926)', () => {
  it('tracks writes to upgrade-configuration storage keys', () => {
    const writes = detectMutableUpgradeConfigWrites(MUTABLE_UPGRADE_CONFIG);
    const keys = writes.map((w) => w.key);
    expect(keys).toContainEqual(expect.stringContaining('wasm_hash'));
    expect(keys).toContainEqual(expect.stringContaining('implementation'));
    // 'owner' is not an upgrade-configuration key by this heuristic.
    expect(keys.some((k) => k.includes('owner'))).toBe(false);
  });

  it('reports unauthenticated writes to upgrade configuration as findings', () => {
    const report = analyzeMutableUpgradeConfig(MUTABLE_UPGRADE_CONFIG);
    expect(report.totalWriteCount).toBe(2);
    expect(report.unsafeWriteCount).toBe(1);

    const unsafe = report.findings.find((f) => f.functionName === 'set_wasm_hash');
    expect(unsafe).toBeDefined();
    expect(unsafe?.severity).toBe('high');
    expect(unsafe?.ruleId).toBe('soroban-mutable-upgrade-config');
    expect(unsafe?.message).toContain('without an authorization check');
  });

  it('does not flag authorized writes to upgrade configuration', () => {
    const report = analyzeMutableUpgradeConfig(MUTABLE_UPGRADE_CONFIG);
    const writes = report.writes.filter((w) => w.fn === 'set_impl');
    expect(writes).toHaveLength(1);
    expect(writes[0].hasAuthorization).toBe(true);
    expect(report.findings.some((f) => f.functionName === 'set_impl')).toBe(false);
  });

  it('returns recommendations when unsafe mutation paths exist', () => {
    const report = analyzeMutableUpgradeConfig(MUTABLE_UPGRADE_CONFIG);
    expect(report.recommendations.some((r) => r.includes('unauthenticated'))).toBe(true);
  });

  it('reports clean contracts without findings', () => {
    const clean = `
      #[contractimpl]
      impl CounterImpl {
          pub fn increment(env: Env, key: Symbol) -> u32 {
              let n: u32 = env.storage().instance().get(&key).unwrap_or(0);
              env.storage().instance().set(&key, &(n + 1));
              n + 1
          }
      }
    `;
    const report = analyzeMutableUpgradeConfig(clean);
    expect(report.totalWriteCount).toBe(0);
    expect(report.findings).toHaveLength(0);
  });

  it('exposes the analyzer class with a stable rule id', () => {
    expect(MutableUpgradeConfigAnalyzer.RULE_ID).toBe('soroban-mutable-upgrade-config');
    const report = new MutableUpgradeConfigAnalyzer().analyze(MUTABLE_UPGRADE_CONFIG);
    expect(report.unsafeWriteCount).toBe(1);
  });
});