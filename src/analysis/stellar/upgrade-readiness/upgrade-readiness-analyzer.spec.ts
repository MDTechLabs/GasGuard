import { describe, expect, it } from "@jest/globals";
import { StellarUpgradeReadinessAnalyzer } from "./upgrade-readiness-analyzer";

describe("StellarUpgradeReadinessAnalyzer", () => {
  it("analyzes a contract with excellent upgrade readiness", () => {
    const source = `
pub const VERSION: &str = "1.0.0";

#[contracttype]
pub struct TokenContract {
    pub version: u32,
    pub balances: Map<Address, i128>,
    pub admin: Address,
    pub paused: bool,
}

#[contractimpl]
impl TokenContract {
    pub fn version() -> String {
        String::from_str("1.0.0")
    }

    pub fn upgrade(env: Env, new_code: Bytes) {
        let admin = self.admin;
        admin.require_auth();
        
        if self.paused {
            panic!("Cannot upgrade while paused");
        }
        
        // Version check
        let current_version = 1;
        require!(current_version >= 1, "Invalid version");
        
        // Migration with state preservation
        self.migrate_state(env);
    }

    pub fn migrate_state(&self, env: Env) {
        // Preserve state during migration
        let snapshot = self.snapshot_state();
        // Transform data
        self.restore_state(snapshot);
    }

    pub fn pause(&mut self) {
        self.admin.require_auth();
        self.paused = true;
    }

    pub fn rollback(&mut self) {
        self.admin.require_auth();
        // Revert to previous version
    }
}
`;

    const analyzer = new StellarUpgradeReadinessAnalyzer(source, "test.rs");
    const result = analyzer.analyze();

    expect(result.contractName).toBe("TokenContract");
    expect(result.readinessScore).toBeGreaterThanOrEqual(70);
    expect(["excellent", "good"]).toContain(result.overallReadiness);
    expect(result.storageAnalysis.hasVersionedStorage).toBe(true);
    expect(result.storageAnalysis.hasExtensibleStorage).toBe(true);
    expect(result.upgradePatternAnalysis.hasUpgradeFunction).toBe(true);
    expect(result.upgradePatternAnalysis.hasAccessControl).toBe(true);
    expect(result.upgradePatternAnalysis.hasEmergencyStop).toBe(true);
    expect(result.versioningAnalysis.hasVersionInfo).toBe(true);
    expect(result.migrationReadiness.hasMigrationPath).toBe(true);
    expect(result.migrationReadiness.hasStatePreservation).toBe(true);
    expect(result.migrationReadiness.hasRollbackCapability).toBe(true);
  });

  it("detects poor upgrade readiness in basic contract", () => {
    const source = `
#[contracttype]
pub struct SimpleToken {
    pub total_supply: i128,
    pub balances: Map<Address, i128>,
}

#[contractimpl]
impl SimpleToken {
    pub fn mint(&mut self, amount: i128) {
        self.total_supply += amount;
    }

    pub fn transfer(&mut self, to: Address, amount: i128) {
        self.balances.set(to, amount);
    }
}
`;

    const analyzer = new StellarUpgradeReadinessAnalyzer(source, "simple.rs");
    const result = analyzer.analyze();

    expect(result.contractName).toBe("SimpleToken");
    expect(result.readinessScore).toBeLessThan(50);
    expect(["poor", "critical"]).toContain(result.overallReadiness);
    expect(result.storageAnalysis.hasVersionedStorage).toBe(false);
    expect(result.upgradePatternAnalysis.hasUpgradeFunction).toBe(false);
    expect(result.versioningAnalysis.hasVersionInfo).toBe(false);
    expect(result.migrationReadiness.hasMigrationPath).toBe(false);
    expect(result.findings.length).toBeGreaterThan(0);
  });

  it("detects missing access control on upgrade function", () => {
    const source = `
#[contracttype]
pub struct UpgradeableContract {
    pub owner: Address,
    pub data: u64,
}

#[contractimpl]
impl UpgradeableContract {
    pub fn upgrade(&mut self, new_code: Bytes) {
        // No access control - anyone can upgrade!
        self.data = 0;
    }
}
`;

    const analyzer = new StellarUpgradeReadinessAnalyzer(source, "insecure.rs");
    const result = analyzer.analyze();

    expect(result.upgradePatternAnalysis.hasUpgradeFunction).toBe(true);
    // Note: hasAccessControl detects 'owner' keyword, but the function doesn't use require_auth
    expect(
      result.findings.some((f) => f.ruleId === "stellar-upgrade-auth-missing"),
    ).toBe(true);
    expect(result.findings.some((f) => f.severity === "critical")).toBe(true);
  });

  it("detects version information", () => {
    const source = `
pub const VERSION: &str = "2.1.0";

#[contracttype]
pub struct VersionedContract {
    pub version: u32,
}

#[contractimpl]
impl VersionedContract {
    pub fn version() -> String {
        String::from_str("2.1.0")
    }

    pub fn upgrade(&mut self) {
        self.owner.require_auth();
        let current = 2;
        require!(current >= 2, "Version mismatch");
    }
}
`;

    const analyzer = new StellarUpgradeReadinessAnalyzer(
      source,
      "versioned.rs",
    );
    const result = analyzer.analyze();

    expect(result.versioningAnalysis.hasVersionInfo).toBe(true);
    expect(result.versioningAnalysis.currentVersion).toBe("2.1.0");
    expect(result.versioningAnalysis.hasVersionCheck).toBe(true);
  });

  it("detects timelock mechanism", () => {
    const source = `
#[contracttype]
pub struct TimelockContract {
    pub admin: Address,
    pub upgrade_delay: u64,
}

#[contractimpl]
impl TimelockContract {
    pub fn upgrade_with_delay(&mut self, delay: u64) {
        self.admin.require_auth();
        let execute_time = env.ledger().timestamp() + delay;
        // Timelock logic
    }
}
`;

    const analyzer = new StellarUpgradeReadinessAnalyzer(source, "timelock.rs");
    const result = analyzer.analyze();

    expect(result.upgradePatternAnalysis.hasTimelock).toBe(true);
  });

  it("analyzes storage layout correctly", () => {
    const source = `
#[contracttype]
pub struct StorageContract {
    pub version: u32,
    pub users: Map<Address, UserInfo>,
    pub configs: Map<String, Config>,
}

#[contracttype]
pub struct UserInfo {
    pub balance: i128,
    pub nonce: u64,
}

#[contracttype]
pub struct Config {
    pub value: u64,
}
`;

    const analyzer = new StellarUpgradeReadinessAnalyzer(source, "storage.rs");
    const result = analyzer.analyze();

    expect(result.storageAnalysis.storageEntries.length).toBeGreaterThan(0);
    expect(result.storageAnalysis.hasVersionedStorage).toBe(true);
    expect(result.storageAnalysis.hasExtensibleStorage).toBe(true);
    // Storage layout is 'mixed' because not all fields are versioned
    expect(["versioned", "mixed"]).toContain(
      result.storageAnalysis.storageLayout,
    );
  });

  it("generates appropriate findings", () => {
    const source = `
#[contracttype]
pub struct BasicContract {
    pub value: u64,
}

#[contractimpl]
impl BasicContract {
    pub fn set_value(&mut self, val: u64) {
        self.value = val;
    }
}
`;

    const analyzer = new StellarUpgradeReadinessAnalyzer(source, "basic.rs");
    const result = analyzer.analyze();

    expect(result.findings.length).toBeGreaterThan(0);

    const findingCategories = result.findings.map((f) => f.category);
    expect(findingCategories).toContain("storage-versioning");
    expect(findingCategories).toContain("upgrade-mechanism");
    expect(findingCategories).toContain("version-management");
    expect(findingCategories).toContain("data-migration");
  });

  it("calculates readiness score correctly", () => {
    const excellentContract = `
pub const VERSION: &str = "1.0.0";

#[contracttype]
pub struct ExcellentContract {
    pub version: u32,
    pub data: Map<String, u64>,
    pub admin: Address,
    pub paused: bool,
}

#[contractimpl]
impl ExcellentContract {
    pub fn version() -> String { String::from_str("1.0.0") }
    pub fn upgrade(&mut self) {
        self.admin.require_auth();
        self.migrate_state();
    }
    pub fn migrate_state(&self) { /* state preservation */ }
    pub fn pause(&mut self) { self.paused = true; }
    pub fn rollback(&mut self) { /* rollback */ }
}
`;

    const poorContract = `
#[contracttype]
pub struct PoorContract {
    pub value: u64,
}

#[contractimpl]
impl PoorContract {
    pub fn set(&mut self, v: u64) { self.value = v; }
}
`;

    const excellentAnalyzer = new StellarUpgradeReadinessAnalyzer(
      excellentContract,
      "excellent.rs",
    );
    const excellentResult = excellentAnalyzer.analyze();

    const poorAnalyzer = new StellarUpgradeReadinessAnalyzer(
      poorContract,
      "poor.rs",
    );
    const poorResult = poorAnalyzer.analyze();

    expect(excellentResult.readinessScore).toBeGreaterThan(
      poorResult.readinessScore,
    );
    expect(excellentResult.overallReadiness).not.toBe("critical");
    expect(poorResult.overallReadiness).toBe("critical");
  });

  it("detects emergency stop capability", () => {
    const source = `
#[contracttype]
pub struct SafeContract {
    pub admin: Address,
    pub is_paused: bool,
}

#[contractimpl]
impl SafeContract {
    pub fn emergency_pause(&mut self) {
        self.admin.require_auth();
        self.is_paused = true;
    }

    pub fn unpause(&mut self) {
        self.admin.require_auth();
        self.is_paused = false;
    }
}
`;

    const analyzer = new StellarUpgradeReadinessAnalyzer(source, "safe.rs");
    const result = analyzer.analyze();

    expect(result.upgradePatternAnalysis.hasEmergencyStop).toBe(true);
  });

  it("detects migration patterns", () => {
    const source = `
#[contracttype]
pub struct MigratableContract {
    pub admin: Address,
    pub balances: Map<Address, i128>,
}

#[contractimpl]
impl MigratableContract {
    pub fn migrate_to_v2(&mut self) {
        self.admin.require_auth();
        // Transform data from v1 to v2
        self.convert_storage_format();
    }

    pub fn convert_storage_format(&self) {
        // Data migration logic
    }
}
`;

    const analyzer = new StellarUpgradeReadinessAnalyzer(
      source,
      "migratable.rs",
    );
    const result = analyzer.analyze();

    expect(result.migrationReadiness.hasMigrationPath).toBe(true);
    expect(result.migrationReadiness.hasDataMigration).toBe(true);
  });

  it("provides actionable recommendations", () => {
    const source = `
#[contracttype]
pub struct NeedsWorkContract {
    pub data: u64,
}
`;

    const analyzer = new StellarUpgradeReadinessAnalyzer(
      source,
      "needswork.rs",
    );
    const result = analyzer.analyze();

    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(
      result.recommendations.some((r) => r.toLowerCase().includes("version")),
    ).toBe(true);
    expect(
      result.recommendations.some((r) => r.toLowerCase().includes("upgrade")),
    ).toBe(true);
    expect(
      result.recommendations.some((r) => r.toLowerCase().includes("storage")),
    ).toBe(true);
  });

  it("generates comprehensive summary", () => {
    const source = `
#[contracttype]
pub struct SummaryContract {
    pub value: u64,
}
`;

    const analyzer = new StellarUpgradeReadinessAnalyzer(source, "summary.rs");
    const result = analyzer.analyze();

    expect(result.summary).toContain("SummaryContract");
    expect(result.summary).toContain("readiness");
    expect(result.summary.length).toBeGreaterThan(20);
  });

  it("handles custom configuration", () => {
    const source = `
#[contracttype]
pub struct ConfigContract {
    pub value: u64,
}

#[contractimpl]
impl ConfigContract {
    pub fn set(&mut self, v: u64) { self.value = v; }
}
`;

    const analyzer = new StellarUpgradeReadinessAnalyzer(source, "config.rs", {
      requireVersioning: false,
      requireUpgradeAuth: false,
      requireTimelock: false,
      requireEmergencyStop: false,
    });

    const result = analyzer.analyze();

    // With relaxed config, should have fewer findings
    expect(result.findings.length).toBeLessThan(
      new StellarUpgradeReadinessAnalyzer(source, "config.rs").analyze()
        .findings.length,
    );
  });

  it("detects proxy pattern", () => {
    const source = `
#[contracttype]
pub struct ProxyContract {
    pub admin: Address,
    pub implementation: Address,
}

#[contractimpl]
impl ProxyContract {
    pub fn upgrade_proxy(&mut self, new_impl: Address) {
        self.admin.require_auth();
        self.implementation = new_impl;
    }

    pub fn delegate_call(&self) {
        // Proxy delegation logic
    }
}
`;

    const analyzer = new StellarUpgradeReadinessAnalyzer(source, "proxy.rs");
    const result = analyzer.analyze();

    expect(result.upgradePatternAnalysis.upgradeMechanism).toBe("proxy");
    expect(
      result.upgradePatternAnalysis.upgradePatterns.length,
    ).toBeGreaterThan(0);
  });
});
