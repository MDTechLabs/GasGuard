/**
 * Tests for Soroban Contract Lifecycle Analyzer
 */

import { describe, it, expect } from '@jest/globals';
import { StellarLifecycleAnalyzer } from './lifecycle-analyzer';

const guardedInitContract = `
use soroban_sdk::{contract, contractimpl, Address, Env};

pub struct TokenContract {
    pub owner: Address,
}

impl TokenContract {
    pub fn initialize(env: Env, owner: Address) {
        if env.storage().has(&"initialized") {
            panic!("already initialized");
        }
        env.storage().set(&"initialized", &true);
        env.storage().set(&"owner", &owner);
    }
}
`;

const ungardedInitContract = `
pub struct SimpleContract;

impl SimpleContract {
    pub fn init(owner: Address) {
        storage().set("owner", owner);
    }
}
`;

const upgradeContract = `
pub struct UpgradeableContract {
    pub admin: Address,
}

impl UpgradeableContract {
    pub fn upgrade(env: Env, wasm_hash: BytesN<32>) {
        self.admin.require_auth();
        env.deployer().update_current_contract_wasm(wasm_hash);
    }
}
`;

const unsafeUpgradeContract = `
pub struct UnsafeContract;

impl UnsafeContract {
    pub fn upgrade(env: Env, wasm_hash: BytesN<32>) {
        env.deployer().update_current_contract_wasm(wasm_hash);
    }
}
`;

describe('StellarLifecycleAnalyzer', () => {
  describe('initialization flows', () => {
    it('detects guarded init flow', () => {
      const a = new StellarLifecycleAnalyzer(guardedInitContract, 'test.rs');
      const r = a.analyze();
      expect(r.initFlows).toHaveLength(1);
      expect(r.initFlows[0].functionName).toBe('initialize');
      expect(r.initFlows[0].hasGuard).toBe(true);
    });

    it('detects unguarded init and raises high-severity issue', () => {
      const a = new StellarLifecycleAnalyzer(ungardedInitContract, 'test.rs');
      const r = a.analyze();
      expect(r.initFlows[0].hasGuard).toBe(false);
      const high = r.issues.filter(i => i.severity === 'high' && i.message.includes('init'));
      expect(high.length).toBeGreaterThan(0);
    });
  });

  describe('upgrade flows', () => {
    it('detects access-controlled upgrade', () => {
      const a = new StellarLifecycleAnalyzer(upgradeContract, 'test.rs');
      const r = a.analyze();
      expect(r.upgradeFlows).toHaveLength(1);
      expect(r.upgradeFlows[0].hasAccessControl).toBe(true);
      expect(r.upgradeFlows[0].isWasm).toBe(true);
    });

    it('flags upgrade without access control', () => {
      const a = new StellarLifecycleAnalyzer(unsafeUpgradeContract, 'test.rs');
      const r = a.analyze();
      expect(r.upgradeFlows[0].hasAccessControl).toBe(false);
      const issue = r.issues.find(i => i.message.includes('upgrade'));
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe('high');
    });
  });

  describe('report generation', () => {
    it('generates a lifecycle report with summary', () => {
      const a = new StellarLifecycleAnalyzer(guardedInitContract, 'test.rs');
      const r = a.analyze();
      expect(r.contractName).toBeTruthy();
      expect(r.summary).toContain(r.contractName);
      expect(r.summary).toContain('init flow');
    });

    it('raises medium issue when no init flow present', () => {
      const noInit = `pub struct Empty; impl Empty {}`;
      const a = new StellarLifecycleAnalyzer(noInit, 'test.rs');
      const r = a.analyze();
      const medium = r.issues.find(i => i.severity === 'medium');
      expect(medium).toBeDefined();
    });
  });
});
