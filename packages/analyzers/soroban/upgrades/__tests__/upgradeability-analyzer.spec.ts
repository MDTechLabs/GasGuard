import {
  analyzeUpgradeability,
  detectUpgradeMechanisms,
  UpgradeabilityAnalyzer,
} from '../upgradeability-analyzer';

const CONTRACT_WITH_UNPROTECTED_UPGRADE = `
#![no_std]

use soroban_sdk::{contract, contractimpl, token, Address, Env, Symbol, Vec};

#[contract]
pub struct Upgradeable;

#[contractimpl]
impl Upgradeable {
    pub fn upgrade(env: Env, new_wasm: Bytes) {
        env.update_current_contract_wasm(&new_wasm);
    }

    pub fn guarded_upgrade(env: Env, admin: Address, new_wasm: Bytes) {
        admin.require_auth();
        env.update_current_contract_wasm(&new_wasm);
    }

    pub fn read_version(env: Env) -> u32 {
        1
    }
}
`;

const CONTRACT_WITH_DEPLOYER = `
#![no_std]

use soroban_sdk::{contract, contractimpl, env, Address, Env, BytesN};

#[contract]
pub struct Factory;

#[contractimpl]
impl Factory {
    pub fn spawn(env: Env, deployer: Address) -> BytesN<32> {
        deployer.require_auth();
        let salt = BytesN::from_array(&env, &[0u8; 32]);
        env.deployer().deploy_contract(&salt, &env.current_contract_address())
    }

    pub fn plain_spawn(env: Env) -> BytesN<32> {
        let salt = BytesN::from_array(&env, &[0u8; 32]);
        env.deployer().deploy_contract(&salt, &env.current_contract_address())
    }
}
`;

describe('SorobanUpgradeabilityAnalyzer (#924)', () => {
  it('detects wasm-replacement upgrade entry points', () => {
    const entryPoints = detectUpgradeMechanisms(CONTRACT_WITH_UNPROTECTED_UPGRADE);
    const wasm = entryPoints.filter((ep) => ep.mechanism === 'wasm-replacement');
    expect(wasm.length).toBeGreaterThanOrEqual(2);
    expect(wasm.some((ep) => ep.functionName === 'upgrade')).toBe(true);
    expect(wasm.some((ep) => ep.functionName === 'guarded_upgrade')).toBe(true);
  });

  it('reports uncontrolled upgrade entry points as critical findings', () => {
    const report = analyzeUpgradeability(CONTRACT_WITH_UNPROTECTED_UPGRADE);
    const uncontrolled = report.findings.filter((f) => f.title === 'Uncontrolled upgrade entry point');
    expect(uncontrolled.length).toBeGreaterThanOrEqual(1);
    const upgrade = uncontrolled.find((f) => f.functionName === 'upgrade');
    expect(upgrade).toBeDefined();
    expect(upgrade?.severity).toBe('critical');
    expect(upgrade?.ruleId).toBe('soroban-upgradeability');
    expect(upgrade?.message).toContain('without an authorization check');
  });

  it('recognizes admin.require_auth() as protecting an upgrade entry point', () => {
    const report = analyzeUpgradeability(CONTRACT_WITH_UNPROTECTED_UPGRADE);
    const guarded = report.entryPoints.find((ep) => ep.functionName === 'guarded_upgrade');
    expect(guarded).toBeDefined();
    expect(guarded?.hasAuthorization).toBe(true);
    expect(guarded?.authorizedBy).toContain('require_auth');
  });

  it('flags deployment via env.deployer() and distinguishes authorization', () => {
    const report = analyzeUpgradeability(CONTRACT_WITH_DEPLOYER);
    expect(report.upgradeMechanisms).toContain('deployer');
    const protectedSpawn = report.entryPoints.find((ep) => ep.functionName === 'spawn');
    const plainSpawn = report.entryPoints.find((ep) => ep.functionName === 'plain_spawn');
    expect(protectedSpawn?.hasAuthorization).toBe(true);
    expect(plainSpawn?.hasAuthorization).toBe(false);
    expect(report.hasUpgradeablePaths).toBe(true);
  });

  it('reports no upgradeable paths for a plain contract', () => {
    const plain = `
      #[contractimpl]
      impl Counter {
          pub fn increment(env: Env, key: Symbol) -> u32 {
              let n: u32 = env.storage().instance().get(&key).unwrap_or(0);
              env.storage().instance().set(&key, &(n + 1));
              n + 1
          }
      }
    `;
    const report = analyzeUpgradeability(plain);
    expect(report.entryPoints).toHaveLength(0);
    expect(report.hasUpgradeablePaths).toBe(false);
    expect(report.findings).toHaveLength(0);
  });

  it('exposes the analyzer class with a stable rule id', () => {
    expect(UpgradeabilityAnalyzer.RULE_ID).toBe('soroban-upgradeability');
    const analyzer = new UpgradeabilityAnalyzer();
    const report = analyzer.analyze(CONTRACT_WITH_UNPROTECTED_UPGRADE);
    expect(report.hasUpgradeablePaths).toBe(true);
  });
});