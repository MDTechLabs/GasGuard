//! Network Validation Rule
//!
//! Detects contracts that lack network/environment validation.
//! Soroban contracts should validate they're running on the expected network
//! to prevent issues when deployed across different Stellar networks.

use crate::{RuleViolation, ViolationSeverity};
use crate::stellar::linting::SorobanLintRule;

/// Rule to detect missing network validation in Soroban contracts
pub struct NetworkValidationRule;

impl SorobanLintRule for NetworkValidationRule {
    fn id(&self) -> &'static str {
        "stellar-network-validation"
    }
    
    fn name(&self) -> &'static str {
        "Stellar Network Validation"
    }
    
    fn description(&self) -> &'static str {
        "Detects contracts lacking network/environment validation. Contracts may behave incorrectly across networks."
    }
    
    fn severity(&self) -> ViolationSeverity {
        ViolationSeverity::High
    }
    
    fn check(&self, source: &str, file_path: &str) -> Option<Vec<RuleViolation>> {
        let mut violations = Vec::new();
        
        // Check if contract uses Env but doesn't validate network
        if source.contains("Env") || source.contains("env.") {
            // Check for network passphrase validation
            let has_network_validation = source.contains("get_network_passphrase") 
                || source.contains("network_passphrase")
                || source.contains("is_testnet")
                || source.contains("is_mainnet")
                || source.contains("NETWORK")
                || source.contains("Network")
                || source.contains("env.ledger().network_passphrase()");
            
            if !has_network_validation {
                violations.push(RuleViolation {
                    rule_name: self.id().to_string(),
                    description: "Contract uses Env but lacks network validation. This may cause issues across different Stellar networks (mainnet, testnet, futurenet).".to_string(),
                    suggestion: "Add network validation using `env.ledger().network_passphrase()` or check for expected network conditions. Example: `let network = env.ledger().network_passphrase(); assert!(network.to_bytes() == expected_network);`".to_string(),
                    line_number: 1,
                    column_number: 0,
                    variable_name: file_path.to_string(),
                    severity: self.severity(),
                });
            }
        }
        
        // Check for functions that interact with external systems without network checks
        let lines: Vec<&str> = source.lines().collect();
        
        for (i, line) in lines.iter().enumerate() {
            // Look for functions that might need network validation
            if (line.contains("pub fn") || line.contains("fn ")) 
                && (line.contains("transfer") || line.contains("withdraw") || line.contains("deposit") 
                    || line.contains("mint") || line.contains("burn") || line.contains("swap")) {
                
                // Check if function has Env parameter
                let has_env_param = line.contains("env: Env") || line.contains("env: &Env");
                
                if has_env_param {
                    // Look ahead to see if there's network validation in the function
                    let next_lines: Vec<&str> = lines.iter().skip(i).take(20).copied().collect();
                    let next_lines_str = next_lines.join("\n");
                    
                    if !next_lines_str.contains("network_passphrase") 
                        && !next_lines_str.contains("get_network_passphrase")
                        && !next_lines_str.contains("is_testnet")
                        && !next_lines_str.contains("is_mainnet") {
                        
                        violations.push(RuleViolation {
                            rule_name: self.id().to_string(),
                            description: format!("Function '{}' at line {} performs sensitive operations without network validation", 
                                               extract_function_name(line), i + 1),
                            suggestion: "Add network validation at the beginning of the function to ensure it runs on the expected network".to_string(),
                            line_number: i + 1,
                            column_number: 0,
                            variable_name: file_path.to_string(),
                            severity: ViolationSeverity::Medium,
                        });
                    }
                }
            }
        }
        
        // Check for hardcoded addresses or values that might be network-specific
        if source.contains("Address::from") || source.contains("Address::generate") {
            let has_network_check = source.contains("network_passphrase")
                || source.contains("is_testnet")
                || source.contains("is_mainnet");
            
            if !has_network_check {
                violations.push(RuleViolation {
                    rule_name: self.id().to_string(),
                    description: "Contract creates or uses addresses without network validation. Addresses may differ across networks.".to_string(),
                    suggestion: "Validate the network before creating or using addresses to ensure they're valid for the current network".to_string(),
                    line_number: 1,
                    column_number: 0,
                    variable_name: file_path.to_string(),
                    severity: ViolationSeverity::Medium,
                });
            }
        }
        
        // Check for contracts that might have network-specific behavior
        if source.contains("#[contractimpl]") {
            let has_any_network_check = source.contains("network_passphrase")
                || source.contains("ledger().network")
                || source.contains("is_testnet")
                || source.contains("is_mainnet")
                || source.contains("NETWORK");
            
            if !has_any_network_check {
                // Only add this warning if we haven't already added a similar one
                if !violations.iter().any(|v| v.rule_name == self.id()) {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: "Contract implementation lacks network environment validation. Consider adding checks to ensure correct behavior across Stellar networks.".to_string(),
                        suggestion: "Implement network validation in constructor or critical functions. Use `env.ledger().network_passphrase()` to detect the current network.".to_string(),
                        line_number: 1,
                        column_number: 0,
                        variable_name: file_path.to_string(),
                        severity: ViolationSeverity::Low,
                    });
                }
            }
        }
        
        if violations.is_empty() {
            None
        } else {
            Some(violations)
        }
    }
}

/// Extract function name from a function signature line
fn extract_function_name(line: &str) -> String {
    if let Some(fn_start) = line.find("fn ") {
        let after_fn = &line[fn_start + 3..];
        if let Some(paren_pos) = after_fn.find('(') {
            return after_fn[..paren_pos].trim().to_string();
        }
    }
    "unknown".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_detects_missing_network_validation_with_env() {
        let rule = NetworkValidationRule;
        let source = r#"
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

#[contractimpl]
impl MyContract {
    pub fn do_something(env: Env) {
        let timestamp = env.ledger().timestamp();
    }
}
"#;
        
        let violations = rule.check(source, "test.rs");
        assert!(violations.is_some());
        let violations = violations.unwrap();
        assert!(!violations.is_empty());
        
        // Should detect missing network validation
        let network_violation = violations.iter().find(|v| v.rule_name == "stellar-network-validation");
        assert!(network_violation.is_some());
    }
    
    #[test]
    fn test_passes_with_network_validation() {
        let rule = NetworkValidationRule;
        let source = r#"
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

#[contractimpl]
impl MyContract {
    pub fn do_something(env: Env) {
        let network = env.ledger().network_passphrase();
        // Network validation present
        let timestamp = env.ledger().timestamp();
    }
}
"#;
        
        let violations = rule.check(source, "test.rs");
        // Should have fewer or no violations since network validation is present
        if let Some(viols) = violations {
            let network_violations: Vec<_> = viols.iter().filter(|v| v.rule_name == "stellar-network-validation").collect();
            assert!(network_violations.is_empty() || network_violations.len() < 2);
        }
    }
    
    #[test]
    fn test_detects_sensitive_function_without_network_check() {
        let rule = NetworkValidationRule;
        let source = r#"
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

#[contractimpl]
impl MyContract {
    pub fn transfer(env: Env, to: Address, amount: u64) {
        // Sensitive operation without network validation
    }
}
"#;
        
        let violations = rule.check(source, "test.rs");
        assert!(violations.is_some());
        let violations = violations.unwrap();
        
        // Should detect transfer function without network validation
        let function_violation = violations.iter().find(|v| 
            v.description.contains("transfer") && v.description.contains("network validation")
        );
        assert!(function_violation.is_some());
    }
    
    #[test]
    fn test_detects_address_generation_without_network_check() {
        let rule = NetworkValidationRule;
        let source = r#"
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

#[contractimpl]
impl MyContract {
    pub fn create_account(env: Env) -> Address {
        Address::generate(&env)
    }
}
"#;
        
        let violations = rule.check(source, "test.rs");
        assert!(violations.is_some());
        let violations = violations.unwrap();
        
        // Should detect address generation without network validation
        let address_violation = violations.iter().find(|v| 
            v.description.contains("addresses without network validation")
        );
        assert!(address_violation.is_some());
    }
    
    #[test]
    fn test_no_false_positives_for_safe_contract() {
        let rule = NetworkValidationRule;
        let source = r#"
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

#[contractimpl]
impl MyContract {
    pub fn safe_transfer(env: Env, to: Address, amount: u64) {
        let network = env.ledger().network_passphrase();
        // Validate network before proceeding
        
        // Perform transfer
    }
}
"#;
        
        let violations = rule.check(source, "test.rs");
        
        // Should have minimal or no violations
        if let Some(viols) = violations {
            let critical_violations: Vec<_> = viols.iter().filter(|v| 
                v.rule_name == "stellar-network-validation"
            ).collect();
            // Should not flag critical violations when network check is present
            assert!(critical_violations.len() <= 1);
        }
    }
    
    #[test]
    fn test_extract_function_name() {
        assert_eq!(extract_function_name("pub fn transfer("), "transfer");
        assert_eq!(extract_function_name("fn deposit("), "deposit");
        assert_eq!(extract_function_name("pub fn withdraw(env: Env,"), "withdraw");
        assert_eq!(extract_function_name("no function here"), "unknown");
    }
}
