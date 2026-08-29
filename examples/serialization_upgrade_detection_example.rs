//! Example: Using Serialization Upgrade Detection
//!
//! This file demonstrates how to use the serialization upgrade detection
//! system in a real contract upgrade scenario.

#[cfg(test)]
mod example_usage {
    use super::*;

    // Example 1: Simple Contract Upgrade Check
    #[test]
    fn example_check_simple_upgrade() {
        let old_contract = r#"
#[derive(Serialize, Deserialize, Debug)]
#[contracttype]
pub struct BankState {
    pub admin: Address,
    pub balance: i128,
}
        "#;

        let new_contract = r#"
#[derive(Serialize, Deserialize, Debug)]
#[contracttype]
pub struct BankState {
    pub admin: Address,
    pub balance: i128,
    pub total_supply: i128,  // New required field - UNSAFE!
}
        "#;

        // This is what your integration would look like:
        // 
        // use gasguard_rules::stellar::upgradeability::SerializationUpgradeCompatibilityRule;
        //
        // let rule = SerializationUpgradeCompatibilityRule::new(old_contract.to_string());
        // let violations = rule.check_upgrade(new_contract, "contract.rs");
        //
        // if !violations.is_empty() {
        //     println!("⚠️  Upgrade compatibility issues:");
        //     for v in violations {
        //         println!("  - {}: {}", v.rule_name, v.description);
        //         println!("    Fix: {}", v.suggestion);
        //     }
        // }

        println!("Example: Simple contract upgrade check");
    }

    // Example 2: Safe Upgrade with Optional Fields
    #[test]
    fn example_safe_upgrade() {
        let old_contract = r#"
#[derive(Serialize, Deserialize, Debug)]
#[contracttype]
pub struct TokenState {
    pub owner: Address,
    pub total_supply: i128,
    pub paused: bool,
}
        "#;

        let new_contract = r#"
#[derive(Serialize, Deserialize, Debug)]
#[contracttype]
pub struct TokenState {
    pub owner: Address,
    pub total_supply: i128,
    pub paused: bool,
    pub upgraded_at: Option<u64>,  // New optional field - SAFE!
    pub version: Option<u32>,      // New optional field - SAFE!
}
        "#;

        // This upgrade is safe because:
        // 1. No fields were removed
        // 2. No field types changed
        // 3. All new fields are optional
        // 4. Serde derives are preserved

        println!("Example: Safe upgrade with optional fields");
    }

    // Example 3: Unsafe Upgrade - Field Removal
    #[test]
    fn example_unsafe_field_removal() {
        let old_contract = r#"
#[derive(Serialize, Deserialize, Debug)]
#[contracttype]
pub struct Config {
    pub name: String,
    pub symbol: String,
    pub decimals: u8,
    pub deprecated_field: bool,  // This will be removed
}
        "#;

        let new_contract = r#"
#[derive(Serialize, Deserialize, Debug)]
#[contracttype]
pub struct Config {
    pub name: String,
    pub symbol: String,
    pub decimals: u8,
    // deprecated_field removed - UNSAFE!
}
        "#;

        // This would be caught by the detection system as a Critical issue
        // Suggestion: Mark field as deprecated and keep it, or:
        // - Use #[serde(skip)]
        // - Use #[serde(skip_serializing)]
        // - Implement custom deserialization

        println!("Example: Unsafe field removal");
    }

    // Example 4: Safe Migration with Version Field
    #[test]
    fn example_versioned_upgrade() {
        let old_contract = r#"
#[derive(Serialize, Deserialize, Debug)]
#[contracttype]
pub struct ContractState {
    pub version: u32,  // Version tracking
    pub owner: Address,
    pub balance: i128,
}

impl ContractState {
    pub fn current_version() -> u32 {
        1
    }
}
        "#;

        let new_contract = r#"
#[derive(Serialize, Deserialize, Debug)]
#[contracttype]
pub struct ContractState {
    pub version: u32,  // Version tracking
    pub owner: Address,
    pub balance: i128,
    pub last_updated: u64,  // New field
}

impl ContractState {
    pub fn current_version() -> u32 {
        2
    }
    
    pub fn migrate_from_v1(old: ContractStateV1) -> Self {
        ContractState {
            version: 2,
            owner: old.owner,
            balance: old.balance,
            last_updated: current_timestamp(),
        }
    }
}
        "#;

        // This is a SAFE upgrade because:
        // 1. Version field allows tracking schema version
        // 2. Migration function is available
        // 3. New field can be populated during migration

        println!("Example: Versioned upgrade with migration");
    }

    // Example 5: Pre-Deploy Check Script
    #[test]
    fn example_predeployment_check() {
        // Pseudocode for pre-deployment check:
        
        let check_upgrade_safety = |old_code: &str, new_code: &str| {
            // use gasguard_rules::stellar::upgradeability::{
            //     SerializationUpgradeCompatibilityRule,
            //     UnsafeSerializationPatternRule,
            //     ViolationSeverity
            // };
            
            // Check compatibility
            // let compat_rule = SerializationUpgradeCompatibilityRule::new(old_code.to_string());
            // let compat_violations = compat_rule.check_upgrade(new_code, "contract.rs");
            
            // Check for unsafe patterns
            // let pattern_violations = UnsafeSerializationPatternRule::check(new_code, "contract.rs");
            
            // Determine if deployment should proceed
            // let critical_issues = compat_violations.iter()
            //     .chain(pattern_violations.iter())
            //     .filter(|v| matches!(v.severity, ViolationSeverity::Critical))
            //     .count();
            
            // if critical_issues > 0 {
            //     println!("❌ DEPLOYMENT BLOCKED: {} critical issues found", critical_issues);
            //     return false;
            // }
            
            // let high_issues = compat_violations.iter()
            //     .chain(pattern_violations.iter())
            //     .filter(|v| matches!(v.severity, ViolationSeverity::High))
            //     .count();
            
            // if high_issues > 0 {
            //     println!("⚠️  WARNING: {} high-severity issues found - review needed", high_issues);
            // }
            
            // println!("✅ Safe to proceed with deployment");
            // true
        };

        println!("Example: Pre-deployment check");
    }

    // Example 6: CI/CD Integration
    #[test]
    fn example_ci_cd_integration() {
        // This example shows how to integrate into a CI/CD pipeline:
        
        // 1. Get old contract code from git
        // let old_code = git_show("origin/main:src/contract.rs");
        
        // 2. Get new contract code from workspace
        // let new_code = std::fs::read_to_string("src/contract.rs").unwrap();
        
        // 3. Run compatibility check
        // let rule = SerializationUpgradeCompatibilityRule::new(old_code);
        // let violations = rule.check_upgrade(&new_code, "contract.rs");
        
        // 4. Report results
        // for violation in violations {
        //     match violation.severity {
        //         ViolationSeverity::Critical => {
        //             eprintln!("🔴 {}", violation.description);
        //             std::process::exit(1);
        //         }
        //         ViolationSeverity::High => {
        //             eprintln!("🟠 {}", violation.description);
        //         }
        //         _ => println!("ℹ️  {}", violation.description),
        //     }
        // }

        println!("Example: CI/CD integration");
    }

    // Example 7: What Makes an Upgrade Safe vs Unsafe
    #[test]
    fn example_safety_guidelines() {
        // ✅ SAFE CHANGES:
        
        // 1. Adding optional fields
        //    pub new_field: Option<T>
        
        // 2. Making existing fields optional
        //    pub field: T -> pub field: Option<T>
        
        // 3. Adding fields with defaults
        //    #[serde(default)]
        //    pub field: T
        
        // 4. Reordering fields (in some serialization formats)
        
        // 5. Adding internal utility fields that aren't persisted
        //    #[serde(skip)]
        //    pub temp_field: T
        
        // ❌ UNSAFE CHANGES:
        
        // 1. Removing required fields
        //    pub field: T is deleted
        
        // 2. Changing field types
        //    pub balance: i128 -> pub balance: u64
        
        // 3. Making optional fields required
        //    pub field: Option<T> -> pub field: T
        
        // 4. Adding required fields without defaults
        //    pub new_field: T (no default)
        
        // 5. Removing Serde derives
        //    #[derive(Serialize, Deserialize)] removed
        
        // 6. Changing Serde attributes
        //    #[serde(rename = "...")] modifications

        println!("Example: Safety guidelines");
    }
}

// Example Contract That Will Be Checked
#[derive(Debug)]
pub struct ExampleBankContract;

impl ExampleBankContract {
    // Version 1 - Original contract
    const ORIGINAL: &'static str = r#"
#[derive(Serialize, Deserialize, Debug)]
#[contracttype]
pub struct BankState {
    pub owner: Address,
    pub total_balance: i128,
    pub paused: bool,
}
    "#;

    // Version 2 - Safe upgrade
    const SAFE_UPGRADE: &'static str = r#"
#[derive(Serialize, Deserialize, Debug)]
#[contracttype]
pub struct BankState {
    pub owner: Address,
    pub total_balance: i128,
    pub paused: bool,
    pub upgraded_at: Option<u64>,
    pub version: Option<u32>,
}
    "#;

    // Version 3 - Unsafe upgrade
    const UNSAFE_UPGRADE: &'static str = r#"
#[derive(Serialize, Deserialize, Debug)]
#[contracttype]
pub struct BankState {
    pub owner: Address,
    // total_balance removed - UNSAFE!
    pub paused: bool,
}
    "#;

    // Version 4 - Properly versioned upgrade
    const VERSIONED_UPGRADE: &'static str = r#"
#[derive(Serialize, Deserialize, Debug)]
#[contracttype]
pub struct BankState {
    pub version: u32,
    pub owner: Address,
    pub total_balance: i128,
    pub paused: bool,
    pub migration_date: Option<u64>,
}

pub fn migrate_from_v1(old: BankStateV1) -> BankState {
    BankState {
        version: 2,
        owner: old.owner,
        total_balance: old.total_balance,
        paused: old.paused,
        migration_date: Some(current_timestamp()),
    }
}
    "#;
}
