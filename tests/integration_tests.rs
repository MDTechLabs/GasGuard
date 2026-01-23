use gasguard_engine::{ContractScanner, ScanAnalyzer};
use gasguard_rules::{SorobanParser, SorobanContract, SorobanAnalyzer, SorobanRuleEngine};
use std::path::Path;

#[test]
fn test_unused_state_variables_detection() {
    let scanner = ContractScanner::new();
    let contract_code = r#"
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

#[contracttype]
pub struct TestContract {
    pub used_var: u64,
    pub unused_var: String,
    pub another_used: bool,
}

#[contractimpl]
impl TestContract {
    pub fn new() -> Self {
        Self {
            used_var: 42,
            another_used: true,
            unused_var: "never_used".to_string(),
        }
    }
    
    pub fn get_used_var(&self) -> u64 {
        self.used_var
    }
    
    pub fn set_another_used(&mut self, value: bool) {
        self.another_used = value;
    }
}
"#;

    let result = scanner.scan_content(contract_code, "test_contract.rs".to_string()).unwrap();
    
    // Should detect one unused variable
    assert_eq!(result.violations.len(), 1);
    assert_eq!(result.violations[0].variable_name, "unused_var");
    assert_eq!(result.violations[0].rule_name, "unused-state-variables");
}

#[test]
fn test_optimized_contract_no_violations() {
    let scanner = ContractScanner::new();
    let contract_code = r#"
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

#[contracttype]
pub struct OptimizedContract {
    pub counter: u64,
    pub owner: Address,
}

#[contractimpl]
impl OptimizedContract {
    pub fn new(owner: Address) -> Self {
        Self {
            counter: 0,
            owner,
        }
    }
    
    pub fn increment(&mut self) {
        self.counter += 1;
    }
    
    pub fn get_owner(&self) -> &Address {
        &self.owner
    }
}
"#;

    let result = scanner.scan_content(contract_code, "optimized_contract.rs".to_string()).unwrap();
    
    // Should detect no violations
    assert_eq!(result.violations.len(), 0);
}

#[test]
fn test_multiple_unused_variables() {
    let scanner = ContractScanner::new();
    let contract_code = r#"
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

#[contracttype]
pub struct WastefulContract {
    pub used_var: u64,
    pub unused1: String,
    pub unused2: bool,
    pub unused3: Address,
    pub also_used: u32,
}

#[contractimpl]
impl WastefulContract {
    pub fn new() -> Self {
        Self {
            used_var: 42,
            also_used: 100,
            unused1: "unused".to_string(),
            unused2: false,
            unused3: Address::generate(&Env::default()),
        }
    }
    
    pub fn get_used_var(&self) -> u64 {
        self.used_var
    }
    
    pub fn get_also_used(&self) -> u32 {
        self.also_used
    }
}
"#;

    let result = scanner.scan_content(contract_code, "wasteful_contract.rs".to_string()).unwrap();
    
    // Should detect three unused variables
    assert_eq!(result.violations.len(), 3);
    
    let unused_vars: Vec<String> = result.violations.iter()
        .map(|v| v.variable_name.clone())
        .collect();
    
    assert!(unused_vars.contains(&"unused1".to_string()));
    assert!(unused_vars.contains(&"unused2".to_string()));
    assert!(unused_vars.contains(&"unused3".to_string()));
}

#[test]
fn test_storage_savings_calculation() {
    let violations = vec![
        gasguard_rules::RuleViolation {
            rule_name: "unused-state-variables".to_string(),
            description: "Test violation 1".to_string(),
            severity: gasguard_rules::ViolationSeverity::Warning,
            line_number: 10,
            column_number: 4,
            variable_name: "unused_var1".to_string(),
            suggestion: "Remove it".to_string(),
        },
        gasguard_rules::RuleViolation {
            rule_name: "unused-state-variables".to_string(),
            description: "Test violation 2".to_string(),
            severity: gasguard_rules::ViolationSeverity::Warning,
            line_number: 11,
            column_number: 4,
            variable_name: "unused_var2".to_string(),
            suggestion: "Remove it".to_string(),
        },
    ];
    
    let savings = ScanAnalyzer::calculate_storage_savings(&violations);
    
    assert_eq!(savings.unused_variables, 2);
    assert_eq!(savings.estimated_savings_kb, 5.0); // 2 * 2.5 KB per variable
    assert!(savings.monthly_ledger_rent_savings > 0.0);
}

// New Soroban-specific tests

#[test]
fn test_soroban_parser_basic_contract() {
    let contract_code = r#"
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol};

#[contracttype]
pub struct TokenContract {
    pub admin: Address,
    pub total_supply: u64,
    pub balances: Map<Address, u64>,
}

#[contractimpl]
impl TokenContract {
    pub fn new(admin: Address, initial_supply: u64) -> Self {
        let mut balances = Map::new();
        balances.set(admin, initial_supply);
        
        Self {
            admin,
            total_supply: initial_supply,
            balances,
        }
    }
    
    pub fn transfer(env: Env, from: Address, to: Address, amount: u64) {
        let from_balance = env.storage().instance().get(&from).unwrap_or(0);
        let to_balance = env.storage().instance().get(&to).unwrap_or(0);
        
        env.storage().instance().set(&from, &(from_balance - amount));
        env.storage().instance().set(&to, &(to_balance + amount));
    }
}
"#;

    let contract = SorobanParser::parse_contract(contract_code, "token_contract.rs").unwrap();
    
    assert_eq!(contract.name, "TokenContract");
    assert_eq!(contract.contract_types.len(), 1);
    assert_eq!(contract.implementations.len(), 1);
    
    let contract_type = &contract.contract_types[0];
    assert_eq!(contract_type.name, "TokenContract");
    assert_eq!(contract_type.fields.len(), 3);
    
    let implementation = &contract.implementations[0];
    assert_eq!(implementation.functions.len(), 2);
    assert_eq!(implementation.functions[0].name, "new");
    assert_eq!(implementation.functions[1].name, "transfer");
}

#[test]
fn test_soroban_analyzer_unused_variables() {
    let contract_code = r#"
use soroban_sdk::{contract, contractimpl, contracttype, Address};

#[contracttype]
pub struct TestContract {
    pub admin: Address,
    pub unused_counter: u64,
    pub active_flag: bool,
}

#[contractimpl]
impl TestContract {
    pub fn new(admin: Address) -> Self {
        Self {
            admin,
            unused_counter: 0,
            active_flag: true,
        }
    }
    
    pub fn is_active(&self) -> bool {
        self.active_flag
    }
}
"#;

    let contract = SorobanParser::parse_contract(contract_code, "test.rs").unwrap();
    let violations = SorobanAnalyzer::analyze_contract(&contract);
    
    let unused_found = violations.iter().any(|v| 
        v.rule_name == "unused-state-variable" && v.variable_name == "unused_counter"
    );
    assert!(unused_found);
}

#[test]
fn test_soroban_rule_engine_integration() {
    let contract_code = r#"
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

#[contracttype]
pub struct BadContract {
    admin: Address,
    counter: u128,
    unused_data: String,
}

#[contractimpl]
impl BadContract {
    pub fn new(admin: Address) -> Self {
        Self {
            admin,
            counter: 0,
            unused_data: "never_used".to_string(),
        }
    }
    
    pub fn increment(&mut self) {
        self.counter += 1;
        let expensive_vec = Vec::new();
        expensive_vec.push(1);
    }
}
"#;

    let engine = SorobanRuleEngine::with_default_rules();
    let violations = engine.analyze(contract_code, "bad_contract.rs").unwrap();
    
    // Should detect multiple violations:
    // 1. Unused state variable
    // 2. Inefficient integer type (u128)
    // 3. Private contract field
    // 4. Expensive string operation
    // 5. Vec without capacity
    
    assert!(!violations.is_empty());
    assert!(violations.len() >= 4);
    
    let rule_names: Vec<String> = violations.iter().map(|v| v.rule_name.clone()).collect();
    assert!(rule_names.contains(&"soroban-unused-state-variables".to_string()));
    assert!(rule_names.contains(&"soroban-inefficient-integers".to_string()));
    assert!(rule_names.contains(&"soroban-expensive-strings".to_string()));
}

#[test]
fn test_soroban_scanner_direct_analysis() {
    let scanner = ContractScanner::new();
    let contract_code = r#"
use soroban_sdk::{contract, contractimpl, contracttype, Address, Symbol};

#[contracttype]
pub struct EfficientContract {
    pub owner: Address,
    pub balance: u64,
}

#[contractimpl]
impl EfficientContract {
    pub fn new(owner: Address, initial_balance: u64) -> Result<Self, Error> {
        if initial_balance == 0 {
            return Err(Error::InvalidAmount);
        }
        
        Ok(Self {
            owner,
            balance: initial_balance,
        })
    }
    
    pub fn deposit(&mut self, amount: u64) -> Result<(), Error> {
        if amount == 0 {
            return Err(Error::InvalidAmount);
        }
        self.balance += amount;
        Ok(())
    }
    
    pub fn withdraw(&mut self, amount: u64) -> Result<(), Error> {
        if amount == 0 {
            return Err(Error::InvalidAmount);
        }
        if self.balance < amount {
            return Err(Error::InsufficientBalance);
        }
        self.balance -= amount;
        Ok(())
    }
}
"#;

    // Test direct Soroban scanning
    let result = scanner.scan_soroban_content(contract_code, "efficient_contract.rs".to_string()).unwrap();
    
    // This well-structured contract should have minimal violations
    // Most issues should be informational rather than critical
    let critical_violations: Vec<_> = result.violations.iter()
        .filter(|v| matches!(v.severity, gasguard_rules::ViolationSeverity::Error | gasguard_rules::ViolationSeverity::Warning))
        .collect();
    
    // Should have very few or no critical violations
    assert!(critical_violations.len() <= 2);
}

#[test]
fn test_language_detection_heuristics() {
    use gasguard_engine::Language;
    
    // Test Soroban detection
    let soroban_code = r#"
use soroban_sdk::{contract, contractimpl, contracttype};
#[contracttype]
pub struct Test {}
#[contractimpl]
impl Test {}
"#;
    
    let detected = Language::from_content(soroban_code);
    assert_eq!(detected, Some(Language::Soroban));
    
    // Test Vyper detection
    let vyper_code = r#"
# @version ^0.3.0
interface Token:
    def transfer(_to: address, _value: uint256): nonpayable
"#;
    
    let detected = Language::from_content(vyper_code);
    assert_eq!(detected, Some(Language::Vyper));
    
    // Test Rust detection
    let rust_code = r#"
fn main() {
    println!("Hello, world!");
}
"#;
    
    let detected = Language::from_content(rust_code);
    assert_eq!(detected, Some(Language::Rust));
}
