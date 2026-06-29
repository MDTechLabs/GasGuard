import { describe, expect, it } from "@jest/globals";
import { SorobanStorageLayoutAnalyzer } from "./storage-layout-analyzer";

describe("SorobanStorageLayoutAnalyzer", () => {
  it("builds storage layout from set operations", () => {
    const source = `
use soroban_sdk::{contract, contractimpl, Env, Symbol};

#[contract]
pub struct Counter;

#[contractimpl]
impl Counter {
    pub fn init(env: Env) {
        env.storage().instance().set(&Symbol::new(&env, "count"), &0u32);
        env.storage().instance().set(&Symbol::new(&env, "owner"), &env.current_contract_address());
    }
}
`;

    const analyzer = new SorobanStorageLayoutAnalyzer(source, "counter.rs");
    const report = analyzer.analyze();

    expect(report.contractName).toBe("Counter");
    expect(report.entries.length).toBeGreaterThanOrEqual(2);
    expect(report.summary).toContain("storage layout");
  });

  it("warns on duplicate storage keys", () => {
    const source = `
use soroban_sdk::{contract, contractimpl, Env, Symbol};

#[contract]
pub struct Dup;

#[contractimpl]
impl Dup {
    pub fn set_a(env: Env) {
        env.storage().instance().set(&Symbol::new(&env, "key"), &1u32);
        env.storage().instance().set(&Symbol::new(&env, "key"), &2u32);
    }
}
`;

    const analyzer = new SorobanStorageLayoutAnalyzer(source, "dup.rs");
    const report = analyzer.analyze();

    expect(report.warnings.some((w) => w.severity === "high")).toBe(true);
  });

  it("returns warning when no storage entries found", () => {
    const source = `
use soroban_sdk::{contract, contractimpl, Env};

#[contract]
pub struct Empty;

#[contractimpl]
impl Empty {
    pub fn noop(env: Env) {}
}
`;

    const analyzer = new SorobanStorageLayoutAnalyzer(source, "empty.rs");
    const report = analyzer.analyze();

    expect(
      report.warnings.some((w) => w.message.includes("No storage entries")),
    ).toBe(true);
  });
});
