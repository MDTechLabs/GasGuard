use gasguard_rules::soroban::{SorobanContract, SorobanParser, SorobanRule};
use gasguard_rules::best_practices::{
    UseSafeIntTypesRule,
    UseImmutableStorageRule,
    UseCheckedArithmeticRule,
    UseResultTypesRule,
    UseInitializationFunctionsRule,
};

fn parse_contract(source: &str) -> SorobanContract {
    SorobanParser::parse_contract(source, "test.rs").expect("Failed to parse contract")
}

#[test]
fn test_use_safe_int_types_rule() {
    let source = r#"
use soroban_sdk::{contract, contractimpl, contracttype, Address};

#[contracttype]
pub struct Config {
    pub admin: Address,
    pub counter: u128,
    pub large_id: i128,
}

#[contractimpl]
impl Config {
    pub fn get_counter(&self) -> u128 {
        self.counter
    }

    pub fn transfer(amount: i128) {}
}
"#;
    let contract = parse_contract(source);
    let rule = UseSafeIntTypesRule::default();
    let violations = rule.apply(&contract);

    let counter_found = violations.iter().any(|v| v.variable_name == "counter");
    let large_id_found = violations.iter().any(|v| v.variable_name == "large_id");
    let amount_skipped = violations.iter().any(|v| v.variable_name == "amount");

    assert!(counter_found, "Should flag 'counter: u128'");
    assert!(large_id_found, "Should flag 'large_id: i128'");
    assert!(!amount_skipped, "Should NOT flag 'amount: i128'");
}

#[test]
fn test_use_immutable_storage_rule() {
    let source = r#"
use soroban_sdk::{contract, contractimpl, Env};

#[contract]
pub struct Data;

#[contractimpl]
impl Data {
    pub fn get_value(env: Env) -> u64 {
        env.storage().instance().set(&"key", &42u64);
        42
    }
}
"#;
    let contract = parse_contract(source);
    let rule = UseImmutableStorageRule::default();
    let violations = rule.apply(&contract);

    assert!(!violations.is_empty());
    assert!(violations.iter().any(|v| v.variable_name == "get_value"));
}

#[test]
fn test_use_immutable_storage_passes_pure_get() {
    let source = r#"
use soroban_sdk::{contract, contractimpl, Env};

#[contract]
pub struct Data;

#[contractimpl]
impl Data {
    pub fn get_value(env: Env) -> u64 {
        env.storage().instance().get(&"key").unwrap_or(0)
    }
}
"#;
    let contract = parse_contract(source);
    let rule = UseImmutableStorageRule::default();
    let violations = rule.apply(&contract);

    assert!(violations.is_empty(), "Pure get function should not have violations");
}

#[test]
fn test_use_checked_arithmetic_rule() {
    let source = r#"
use soroban_sdk::{contract, contractimpl};

#[contract]
pub struct Math;

#[contractimpl]
impl Math {
    pub fn add(a: u64, b: u64) -> u64 {
        a + b
    }

    pub fn safe_add(a: u64, b: u64) -> u64 {
        a.checked_add(b).unwrap_or(0)
    }
}
"#;
    let contract = parse_contract(source);
    let rule = UseCheckedArithmeticRule::default();
    let violations = rule.apply(&contract);

    assert!(violations.iter().any(|v| v.variable_name == "add"), "Should flag 'add' function");
    assert!(!violations.iter().any(|v| v.variable_name == "safe_add"), "Should NOT flag 'safe_add'");
}

#[test]
fn test_use_result_types_rule() {
    let source = r#"
use soroban_sdk::{contract, contractimpl, Env};

#[contract]
pub struct Storage;

#[contractimpl]
impl Storage {
    pub fn get_val(env: Env) -> u64 {
        env.storage().instance().get(&"key").unwrap()
    }

    pub fn safe_get(env: Env) -> Result<u64, ()> {
        Ok(env.storage().instance().get(&"key").unwrap_or(0))
    }
}
"#;
    let contract = parse_contract(source);
    let rule = UseResultTypesRule::default();
    let violations = rule.apply(&contract);

    assert!(violations.iter().any(|v| v.variable_name == "get_val"), "Should flag 'get_val'");
    assert!(!violations.iter().any(|v| v.variable_name == "safe_get"), "Should NOT flag 'safe_get'");
}

#[test]
fn test_use_initialization_functions_rule() {
    let source = r#"
use soroban_sdk::{contract, contractimpl, Env};

#[contract]
pub struct MyContract;

#[contractimpl]
impl MyContract {
    pub fn set_admin(env: Env) {
        env.storage().instance().set(&"admin", &"alice");
    }
}
"#;
    let contract = parse_contract(source);
    let rule = UseInitializationFunctionsRule::default();
    let violations = rule.apply(&contract);

    assert!(!violations.is_empty(), "Should detect missing constructor with storage writes");
    assert!(violations.iter().any(|v| v.variable_name == "MyContract"));
}

#[test]
fn test_use_initialization_functions_with_constructor() {
    let source = r#"
use soroban_sdk::{contract, contractimpl, Env};

#[contract]
pub struct MyContract;

#[contractimpl]
impl MyContract {
    pub fn __constructor(env: Env) {
        env.storage().instance().set(&"admin", &"alice");
    }
}
"#;
    let contract = parse_contract(source);
    let rule = UseInitializationFunctionsRule::default();
    let violations = rule.apply(&contract);

    assert!(violations.is_empty(), "Should not flag contract with constructor");
}

#[test]
fn test_default_best_practice_rules() {
    let rules = gasguard_rules::default_best_practice_rules();
    assert_eq!(rules.len(), 5);

    let ids: Vec<&str> = rules.iter().map(|r| r.id()).collect();
    assert!(ids.contains(&"use-safe-int-types"));
    assert!(ids.contains(&"use-immutable-storage"));
    assert!(ids.contains(&"use-checked-arithmetic"));
    assert!(ids.contains(&"use-result-types"));
    assert!(ids.contains(&"use-initialization-functions"));
}

#[test]
fn test_best_practices_config_default() {
    let config = gasguard_rules::default_best_practices_config();
    assert_eq!(config.rules.len(), 5);

    let ids: Vec<&str> = config.rules.iter().map(|r| r.id.as_str()).collect();
    assert!(ids.contains(&"use-safe-int-types"));
    assert!(ids.contains(&"use-immutable-storage"));
    assert!(ids.contains(&"use-checked-arithmetic"));
    assert!(ids.contains(&"use-result-types"));
    assert!(ids.contains(&"use-initialization-functions"));
}
