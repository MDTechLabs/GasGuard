/**
 * Soroban Upgrade Readiness Scanner - Usage Example
 *
 * This example demonstrates how to use the upgrade readiness scanner
 * and integrate its findings into reports.
 */

import { StellarUpgradeReadinessAnalyzer } from "./upgrade-readiness-analyzer";

// Example 1: Contract with excellent upgrade readiness
const wellDesignedContract = `
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
        self.restore_state(snapshot);
    }

    pub fn pause(&mut self) {
        self.admin.require_auth();
        self.paused = true;
    }

    pub fn rollback(&mut self) {
        self.admin.require_auth();
    }
}
`;

// Example 2: Contract lacking upgrade considerations
const basicContract = `
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

function runAnalysis() {
  console.log("=== Soroban Upgrade Readiness Scanner ===\n");

  // Analyze well-designed contract
  console.log("Example 1: Well-Designed Contract");
  console.log("-----------------------------------");
  const analyzer1 = new StellarUpgradeReadinessAnalyzer(
    wellDesignedContract,
    "token_contract.rs",
  );
  const result1 = analyzer1.analyze();

  console.log(`Contract: ${result1.contractName}`);
  console.log(`Readiness Level: ${result1.overallReadiness}`);
  console.log(`Readiness Score: ${result1.readinessScore}/100`);
  console.log(`\nKey Features:`);
  console.log(
    `  ✓ Versioned Storage: ${result1.storageAnalysis.hasVersionedStorage}`,
  );
  console.log(
    `  ✓ Upgrade Mechanism: ${result1.upgradePatternAnalysis.hasUpgradeFunction}`,
  );
  console.log(
    `  ✓ Access Control: ${result1.upgradePatternAnalysis.hasAccessControl}`,
  );
  console.log(
    `  ✓ Emergency Stop: ${result1.upgradePatternAnalysis.hasEmergencyStop}`,
  );
  console.log(`  ✓ Version Info: ${result1.versioningAnalysis.hasVersionInfo}`);
  console.log(
    `  ✓ Migration Path: ${result1.migrationReadiness.hasMigrationPath}`,
  );
  console.log(`\nFindings: ${result1.findings.length}`);
  console.log(`Recommendations: ${result1.recommendations.length}`);
  console.log(`\nSummary:`);
  console.log(result1.summary);

  console.log("\n\n");

  // Analyze basic contract
  console.log("Example 2: Basic Contract (Needs Improvement)");
  console.log("-----------------------------------------------");
  const analyzer2 = new StellarUpgradeReadinessAnalyzer(
    basicContract,
    "simple_token.rs",
  );
  const result2 = analyzer2.analyze();

  console.log(`Contract: ${result2.contractName}`);
  console.log(`Readiness Level: ${result2.overallReadiness}`);
  console.log(`Readiness Score: ${result2.readinessScore}/100`);
  console.log(`\nKey Features:`);
  console.log(
    `  ✗ Versioned Storage: ${result2.storageAnalysis.hasVersionedStorage}`,
  );
  console.log(
    `  ✗ Upgrade Mechanism: ${result2.upgradePatternAnalysis.hasUpgradeFunction}`,
  );
  console.log(`  ✗ Version Info: ${result2.versioningAnalysis.hasVersionInfo}`);
  console.log(
    `  ✗ Migration Path: ${result2.migrationReadiness.hasMigrationPath}`,
  );
  console.log(`\nFindings: ${result2.findings.length}`);

  console.log("\nCritical Findings:");
  result2.findings
    .filter((f) => f.severity === "critical" || f.severity === "high")
    .forEach((f) => {
      console.log(`  [${f.severity.toUpperCase()}] ${f.message}`);
      console.log(`    → ${f.recommendation}`);
    });

  console.log(`\nRecommendations:`);
  result2.recommendations.forEach((rec, i) => {
    console.log(`  ${i + 1}. ${rec}`);
  });

  console.log(`\nSummary:`);
  console.log(result2.summary);
}

// Run the analysis
runAnalysis();
