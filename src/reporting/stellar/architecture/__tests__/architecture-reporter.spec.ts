/**
 * Tests for Soroban Architecture Reporter
 */

import { describe, it, expect } from "@jest/globals";
import { SorobanArchitectureAnalyzer } from "../architecture-analyzer";
import { SorobanArchitectureReporter } from "../architecture-reporter";

describe("SorobanArchitectureAnalyzer", () => {
  const sampleContract = `
//! Example Soroban contract
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

#[contracttype]
pub struct TokenContract {
    pub owner: Address,
    pub total_supply: u64,
    pub version: u32,
    pub paused: bool,
}

#[contractimpl]
impl TokenContract {
    pub fn new(owner: Address, initial_supply: u64) -> Result<Self, Error> {
        Ok(Self {
            owner,
            total_supply: initial_supply,
            version: 1,
            paused: false,
        })
    }
    
    pub fn transfer(&mut self, env: Env, to: Address, amount: u64) -> Result<(), Error> {
        if self.paused {
            return Err(Error::ContractPaused);
        }
        
        to.require_auth();
        
        let balance = self.get_balance(env.clone());
        if balance < amount {
            return Err(Error::InsufficientBalance);
        }
        
        self.total_supply -= amount;
        Ok(())
    }
    
    pub fn get_balance(&self, env: Env) -> u64 {
        self.total_supply
    }
    
    pub fn pause(&mut self, caller: Address) -> Result<(), Error> {
        if caller != self.owner {
            return Err(Error::Unauthorized);
        }
        self.paused = true;
        Ok(())
    }
}

pub enum Error {
    Unauthorized,
    InsufficientBalance,
    ContractPaused,
}
`;

  it("should analyze contract info correctly", () => {
    const analyzer = new SorobanArchitectureAnalyzer(sampleContract, "test.rs");
    const summary = analyzer.analyze();

    expect(summary.contractInfo.name).toBe("TokenContract");
    expect(summary.contractInfo.contractType).toBe("single");
    expect(summary.contractInfo.hasTests).toBe(false);
    expect(summary.contractInfo.hasDocumentation).toBe(true);
  });

  it("should extract contract types", () => {
    const analyzer = new SorobanArchitectureAnalyzer(sampleContract, "test.rs");
    const summary = analyzer.analyze();

    expect(summary.moduleStructure.contractTypes.length).toBeGreaterThan(0);
    const tokenContract = summary.moduleStructure.contractTypes[0];
    expect(tokenContract.name).toBe("TokenContract");
    expect(tokenContract.hasVersioning).toBe(true);
    expect(tokenContract.hasPauseState).toBe(true);
    expect(tokenContract.hasAccessControl).toBe(true);
  });

  it("should categorize functions correctly", () => {
    const analyzer = new SorobanArchitectureAnalyzer(sampleContract, "test.rs");
    const summary = analyzer.analyze();

    expect(summary.functionInventory.totalFunctions).toBeGreaterThan(0);
    expect(
      summary.functionInventory.categorization.constructors,
    ).toBeGreaterThan(0);
    expect(summary.functionInventory.categorization.transfers).toBeGreaterThan(
      0,
    );
    expect(summary.functionInventory.categorization.queries).toBeGreaterThan(0);
  });

  it("should detect security features", () => {
    const analyzer = new SorobanArchitectureAnalyzer(sampleContract, "test.rs");
    const summary = analyzer.analyze();

    expect(summary.securityBoundaries.hasAccessControl).toBe(true);
    expect(summary.securityBoundaries.hasPauseCircuit).toBe(true);
    expect(
      summary.securityBoundaries.authenticationPatterns.length,
    ).toBeGreaterThan(0);
  });

  it("should analyze storage patterns", () => {
    const analyzer = new SorobanArchitectureAnalyzer(sampleContract, "test.rs");
    const summary = analyzer.analyze();

    expect(summary.storagePatterns.storageOperations).toBeDefined();
    expect(
      summary.storagePatterns.storageOperations.totalReads,
    ).toBeGreaterThanOrEqual(0);
    expect(
      summary.storagePatterns.storageOperations.totalWrites,
    ).toBeGreaterThanOrEqual(0);
  });

  it("should calculate resource profile", () => {
    const analyzer = new SorobanArchitectureAnalyzer(sampleContract, "test.rs");
    const summary = analyzer.analyze();

    expect(summary.resourceProfile.cpuProfile).toBeDefined();
    expect(summary.resourceProfile.memoryProfile).toBeDefined();
    expect(summary.resourceProfile.ledgerProfile).toBeDefined();
    expect(["excellent", "good", "moderate", "poor"]).toContain(
      summary.resourceProfile.overallEfficiency,
    );
  });
});

describe("SorobanArchitectureReporter", () => {
  const sampleContract = `
use soroban_sdk::{contract, contractimpl, contracttype, Address};

#[contracttype]
pub struct TestContract {
    pub owner: Address,
}

#[contractimpl]
impl TestContract {
    pub fn new(owner: Address) -> Self {
        Self { owner }
    }
}
`;

  it("should generate markdown report", () => {
    const analyzer = new SorobanArchitectureAnalyzer(sampleContract, "test.rs");
    const summary = analyzer.analyze();

    const reporter = new SorobanArchitectureReporter();
    const markdown = reporter.generate(summary, { format: "markdown" });

    expect(markdown).toContain("# Soroban Contract Architecture Report");
    expect(markdown).toContain("Executive Summary");
    expect(markdown).toContain("Contract Information");
    expect(markdown).toContain("Module Structure");
    expect(markdown).toContain("Function Inventory");
    expect(markdown).toContain("Security Boundaries");
  });

  it("should generate JSON report", () => {
    const analyzer = new SorobanArchitectureAnalyzer(sampleContract, "test.rs");
    const summary = analyzer.analyze();

    const reporter = new SorobanArchitectureReporter();
    const json = reporter.generate(summary, { format: "json" });

    const parsed = JSON.parse(json);
    expect(parsed.contractInfo).toBeDefined();
    expect(parsed.moduleStructure).toBeDefined();
    expect(parsed.functionInventory).toBeDefined();
  });

  it("should generate HTML report", () => {
    const analyzer = new SorobanArchitectureAnalyzer(sampleContract, "test.rs");
    const summary = analyzer.analyze();

    const reporter = new SorobanArchitectureReporter();
    const html = reporter.generate(summary, { format: "html" });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html>");
    expect(html).toContain("Architecture Report");
  });

  it("should include project name in report when provided", () => {
    const analyzer = new SorobanArchitectureAnalyzer(sampleContract, "test.rs");
    const summary = analyzer.analyze();

    const reporter = new SorobanArchitectureReporter();
    const markdown = reporter.generate(summary, {
      format: "markdown",
      projectName: "MyDApp",
      contractVersion: "2.1.0",
    });

    expect(markdown).toContain("**Project:** MyDApp");
    expect(markdown).toContain("**Contract Version:** 2.1.0");
  });
});

describe("Integration: Complex Contract Analysis", () => {
  const complexContract = `
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Map};

#[contracttype]
pub struct ComplexContract {
    pub admin: Address,
    pub total_supply: u64,
    pub balances: Map<Address, u64>,
    pub unused_field: String,
}

#[contractimpl]
impl ComplexContract {
    pub fn transfer(&mut self, from: Address, to: Address, amount: u64) {
        // Issue: Multiple storage reads without caching
        let from_balance = self.balances.get(from).unwrap_or(0);
        let to_balance = self.balances.get(to).unwrap_or(0);
        
        self.balances.set(from, from_balance - amount);
        self.balances.set(to, to_balance + amount);
    }
    
    pub fn process_all(&self, accounts: Vec<Address>) {
        // Issue: Loop with storage access
        for account in accounts {
            let balance = self.balances.get(account).unwrap_or(0);
        }
    }
    
    pub fn claim_airdrop(&mut self, user: Address) {
        // Issue: No expiry check
        let balance = self.balances.get(user).unwrap_or(0);
        self.balances.set(user, balance + 100);
    }
    
    pub fn generate_random(&self, env: Env) -> u64 {
        // Issue: Weak randomness
        env.ledger().timestamp() % 1000
    }
}
`;

  it("should detect storage anti-patterns", () => {
    const analyzer = new SorobanArchitectureAnalyzer(
      complexContract,
      "complex.rs",
    );
    const summary = analyzer.analyze();

    expect(summary.storagePatterns.patterns.length).toBeGreaterThan(0);

    const hasLoopStorage = summary.storagePatterns.patterns.some(
      (p) => p.pattern === "loop-storage",
    );
    expect(hasLoopStorage).toBe(true);
  });

  it("should detect vulnerability indicators", () => {
    const analyzer = new SorobanArchitectureAnalyzer(
      complexContract,
      "complex.rs",
    );
    const summary = analyzer.analyze();

    expect(summary.securityBoundaries.vulnerabilities.length).toBeGreaterThan(
      0,
    );

    const vulnerabilityTypes = summary.securityBoundaries.vulnerabilities.map(
      (v) => v.type,
    );
    expect(vulnerabilityTypes).toContain("weak-randomness");
  });

  it("should provide optimization opportunities", () => {
    const analyzer = new SorobanArchitectureAnalyzer(
      complexContract,
      "complex.rs",
    );
    const summary = analyzer.analyze();

    expect(
      summary.storagePatterns.optimizationOpportunities.length,
    ).toBeGreaterThan(0);

    const hasStorageOptimization =
      summary.storagePatterns.optimizationOpportunities.some(
        (opp) => opp.type === "storage",
      );
    expect(hasStorageOptimization).toBe(true);
  });

  it("should identify resource bottlenecks", () => {
    const analyzer = new SorobanArchitectureAnalyzer(
      complexContract,
      "complex.rs",
    );
    const summary = analyzer.analyze();

    expect(summary.resourceProfile.bottlenecks).toBeDefined();
    expect(Array.isArray(summary.resourceProfile.bottlenecks)).toBe(true);
  });

  it("should generate comprehensive report for complex contract", () => {
    const analyzer = new SorobanArchitectureAnalyzer(
      complexContract,
      "complex.rs",
    );
    const summary = analyzer.analyze();

    const reporter = new SorobanArchitectureReporter();
    const markdown = reporter.generate(summary, {
      format: "markdown",
      projectName: "ComplexDApp",
    });

    expect(markdown).toContain("Storage Patterns");
    expect(markdown).toContain("Optimization Opportunities");
    expect(markdown).toContain("Vulnerability Indicators");
    expect(markdown).toContain("Resource Profile");
  });
});
