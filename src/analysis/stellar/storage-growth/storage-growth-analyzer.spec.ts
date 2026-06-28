import { describe, expect, it } from '@jest/globals';
import { StellarStorageGrowthAnalyzer } from './storage-growth-analyzer';

describe('StellarStorageGrowthAnalyzer', () => {
  it('detects growth-prone storage operations and emits warnings', () => {
    const source = `
use soroban_sdk::{contract, contractimpl, Env, Symbol, Vec};

#[contract]
pub struct GrowthContract;

#[contractimpl]
impl GrowthContract {
    pub fn add_item(env: Env, item: Symbol) {
        let mut items: Vec<Symbol> = env.storage().instance().get(&Symbol::new(&env, "items")).unwrap_or_default();
        items.push_back(item);
        env.storage().instance().set(&Symbol::new(&env, "items"), &items);
    }

    pub fn store_many(env: Env, values: Vec<Symbol>) {
        env.storage().instance().set(&Symbol::new(&env, "values"), &values);
    }
}
`;

    const analyzer = new StellarStorageGrowthAnalyzer(source, 'growth.rs');
    const report = analyzer.analyze();

    expect(report.contractName).toBe('GrowthContract');
    expect(report.growthPatterns.length).toBeGreaterThan(0);
    expect(report.warnings.length).toBeGreaterThan(0);
    expect(report.summary).toContain('growth');
  });

  it('returns no warnings for bounded storage patterns', () => {
    const source = `
use soroban_sdk::{contract, contractimpl, Env, Symbol};

#[contract]
pub struct BoundedContract;

#[contractimpl]
impl BoundedContract {
    pub fn set_limit(env: Env) {
        env.storage().instance().set(&Symbol::new(&env, "limit"), &10u32);
    }
}
`;

    const analyzer = new StellarStorageGrowthAnalyzer(source, 'bounded.rs');
    const report = analyzer.analyze();

    expect(report.growthPatterns).toHaveLength(0);
    expect(report.warnings).toHaveLength(0);
  });
});
