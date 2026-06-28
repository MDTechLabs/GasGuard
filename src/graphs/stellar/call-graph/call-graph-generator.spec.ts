import { describe, expect, it } from '@jest/globals';
import { StellarCallGraphGenerator } from './call-graph-generator';

describe('StellarCallGraphGenerator', () => {
  it('generates call graph from a simple Soroban contract', () => {
    const source = `
use soroban_sdk::{contract, contractimpl, Env, Address};

#[contract]
pub struct TokenContract;

#[contractimpl]
impl TokenContract {
    pub fn initialize(env: Env, owner: Address) {
        env.storage().instance().set(&"owner", &owner);
    }

    pub fn transfer(env: Env, to: Address, amount: u64) {
        let owner: Address = env.storage().instance().get(&"owner").unwrap();
        require_auth(owner);
        deduct_balance(env, owner, amount);
        add_balance(env, to, amount);
    }

    pub fn balance_of(env: Env, address: Address) -> u64 {
        env.storage().instance().get(&address).unwrap_or(0)
    }
}
`;

    const generator = new StellarCallGraphGenerator(source, 'token.rs');
    const report = generator.generate();

    expect(report.contractName).toBe('TokenContract');
    expect(report.totalFunctions).toBeGreaterThanOrEqual(3);
    expect(report.graph.nodes.length).toBeGreaterThan(0);
    expect(report.graph.edges.length).toBeGreaterThanOrEqual(0);
    expect(report.entryPoints.length).toBeGreaterThanOrEqual(1);
  });

  it('detects orphan functions with no callers', () => {
    const source = `
fn used_function() {
    helper_function();
}

fn helper_function() {}

fn orphan_function() {}
`;

    const generator = new StellarCallGraphGenerator(source, 'test.rs');
    const report = generator.generate();

    expect(report.orphanFunctions).toContain('orphan_function');
    expect(report.orphanFunctions).not.toContain('used_function');
  });

  it('respects max depth configuration', () => {
    const source = `
fn a() { b(); }
fn b() { c(); }
fn c() { d(); }
fn d() {}
`;

    const generator = new StellarCallGraphGenerator(source, 'depth.rs', {
      includeExternalCalls: false,
      maxDepth: 2,
      detectCycles: true,
    });
    const report = generator.generate();

    expect(report.maxCallDepth).toBeLessThanOrEqual(2);
  });

  it('handles contracts with no functions gracefully', () => {
    const source = 'pub struct EmptyContract;';
    const generator = new StellarCallGraphGenerator(source, 'empty.rs');
    const report = generator.generate();

    expect(report.totalFunctions).toBe(0);
    expect(report.totalEdges).toBe(0);
  });
});
