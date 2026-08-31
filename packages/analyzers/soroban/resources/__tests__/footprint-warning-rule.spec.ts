import { analyzeFootprintSize, DEFAULT_FOOTPRINT_CONFIG } from '../footprint-warning-rule';

describe('Soroban Footprint Size Warning Rule (Issue #894)', () => {
  test('calculates footprint size and detects excessive storage operations', () => {
    const source = `
use soroban_sdk::{contractimpl, Env, Symbol};

pub struct StateHeavy;

#[contractimpl]
impl StateHeavy {
    pub fn update_all(env: Env) {
        env.storage().persistent().set(&Symbol::new(&env, "k1"), &1);
        env.storage().persistent().set(&Symbol::new(&env, "k2"), &2);
        env.storage().persistent().set(&Symbol::new(&env, "k3"), &3);
        env.storage().persistent().set(&Symbol::new(&env, "k4"), &4);
        env.storage().persistent().set(&Symbol::new(&env, "k5"), &5);
        env.storage().persistent().set(&Symbol::new(&env, "k6"), &6); // exceeds writeKeys threshold (5)
    }
}
`;
    const report = analyzeFootprintSize(source, DEFAULT_FOOTPRINT_CONFIG);

    expect(report.metrics.excessiveFootprintFunctions).toBe(1);
    expect(report.findings.length).toBe(1);
    expect(report.findings[0].metrics.writes).toBe(6);
    expect(report.findings[0].severity).toBe('medium');
  });

  test('passes for functions within configured footprint limits', () => {
    const source = `
use soroban_sdk::{contractimpl, Env, Symbol};

pub struct SmallContract;

#[contractimpl]
impl SmallContract {
    pub fn get_counter(env: Env) -> u64 {
        env.storage().instance().get(&Symbol::new(&env, "counter")).unwrap_or(0)
    }
}
`;
    const report = analyzeFootprintSize(source, DEFAULT_FOOTPRINT_CONFIG);

    expect(report.metrics.excessiveFootprintFunctions).toBe(0);
    expect(report.findings.length).toBe(0);
  });
});
