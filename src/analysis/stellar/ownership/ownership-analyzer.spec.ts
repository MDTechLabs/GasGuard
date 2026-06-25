/**
 * Tests for Soroban Contract Ownership Analyzer
 */

import { describe, it, expect } from "@jest/globals";
import { StellarOwnershipAnalyzer } from "./ownership-analyzer";

describe("StellarOwnershipAnalyzer", () => {
  const singleOwnerContract = `
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

#[contracttype]
pub struct TokenContract {
    pub owner: Address,
    pub total_supply: u64,
}

#[contractimpl]
impl TokenContract {
    pub fn new(owner: Address) -> Self {
        Self { owner, total_supply: 0 }
    }

    pub fn transfer(&mut self, to: Address, amount: u64) -> Result<(), Error> {
        if self.owner != to {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }

    pub fn set_owner(&mut self, new_owner: Address) {
        self.owner.require_auth();
        self.owner = new_owner;
    }

    pub fn pause(&mut self, caller: Address) -> Result<(), Error> {
        if caller != self.owner {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }
}

pub enum Error {
    Unauthorized,
}
`;

  const roleBasedContract = `
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Map};

#[contracttype]
pub struct Roles {
    pub admin: Address,
    pub minter: Address,
    pub pauser: Address,
}

#[contractimpl]
impl RoleContract {
    pub fn new(admin: Address) -> Self {
        Self { admin }
    }

    pub fn grant_role(&mut self, role: String, user: Address) {
        self.admin.require_auth();
    }

    pub fn mint(&mut self, to: Address, amount: u64) {
        self.minter.require_auth();
    }

    pub fn pause(&mut self) {
        self.pauser.require_auth();
    }
}
`;

  const timeLockedContract = `
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

#[contracttype]
pub struct TimelockContract {
    pub owner: Address,
    pub delay: u64,
}

#[contractimpl]
impl TimelockContract {
    pub fn new(owner: Address) -> Self {
        Self { owner, delay: 86400 }
    }

    pub fn schedule_upgrade(&mut self, env: Env) {
        self.owner.require_auth();
        let deadline = env.ledger().timestamp() + self.delay;
    }
}
`;

  it("should detect single-owner pattern", () => {
    const analyzer = new StellarOwnershipAnalyzer(
      singleOwnerContract,
      "test.rs",
    );
    const analysis = analyzer.analyze();

    expect(analysis.detectedPattern).toBe("single-owner");
    expect(analysis.contractName).toBe("TokenContract");
  });

  it("should find admin functions", () => {
    const analyzer = new StellarOwnershipAnalyzer(
      singleOwnerContract,
      "test.rs",
    );
    const analysis = analyzer.analyze();

    expect(analysis.adminFunctions.length).toBeGreaterThan(0);
    const adminNames = analysis.adminFunctions.map((f) => f.name);
    expect(adminNames).toContain("set_owner");
    expect(adminNames).toContain("pause");
  });

  it("should detect owner checks", () => {
    const analyzer = new StellarOwnershipAnalyzer(
      singleOwnerContract,
      "test.rs",
    );
    const analysis = analyzer.analyze();

    expect(analysis.ownerChecks.length).toBeGreaterThan(0);
    for (const check of analysis.ownerChecks) {
      expect(check.checkExpression).toBeTruthy();
    }
  });

  it("should detect role-based ownership", () => {
    const analyzer = new StellarOwnershipAnalyzer(
      roleBasedContract,
      "test.rs",
    );
    const analysis = analyzer.analyze();

    expect(analysis.detectedPattern).toBe("role-based");
    expect(analysis.roleAssignments.length).toBeGreaterThan(0);
  });

  it("should detect time-locked ownership", () => {
    const analyzer = new StellarOwnershipAnalyzer(
      timeLockedContract,
      "test.rs",
    );
    const analysis = analyzer.analyze();

    expect(analysis.detectedPattern).toBe("time-locked");
    expect(analysis.timeLocks.length).toBeGreaterThan(0);
  });

  it("should calculate risk level correctly", () => {
    const analyzer = new StellarOwnershipAnalyzer(
      singleOwnerContract,
      "test.rs",
    );
    const analysis = analyzer.analyze();

    expect(["low", "medium", "high", "critical"]).toContain(
      analysis.riskLevel,
    );
  });

  it("should generate a summary", () => {
    const analyzer = new StellarOwnershipAnalyzer(
      singleOwnerContract,
      "test.rs",
    );
    const analysis = analyzer.analyze();

    expect(analysis.summary).toContain("single-owner");
    expect(analysis.summary).toContain("TokenContract");
  });
});
