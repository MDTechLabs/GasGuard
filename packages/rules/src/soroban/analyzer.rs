//! Soroban contract analysis module
//!
//! This module provides analysis capabilities for Soroban smart contracts,
//! detecting gas optimization opportunities, security issues, and best practices.

use super::*;
use crate::{RuleViolation, ViolationSeverity};

/// Analyzes Soroban contracts for various issues
pub struct SorobanAnalyzer;

impl SorobanAnalyzer {
    /// Analyze a parsed Soroban contract
    pub fn analyze_contract(contract: &SorobanContract) -> Vec<RuleViolation> {
        let mut violations = Vec::new();
        
        // Analyze contract types (structs)
        for contract_type in &contract.contract_types {
            violations.extend(Self::analyze_contract_type(contract_type, &contract.source));
        }
        
        // Analyze implementations
        for implementation in &contract.implementations {
            violations.extend(Self::analyze_implementation(implementation, &contract.source));
        }
        
        // Analyze overall contract structure
        violations.extend(Self::analyze_contract_structure(contract));
        
        violations
    }
    
    /// Analyze a contract type (struct) for issues
    fn analyze_contract_type(contract_type: &SorobanStruct, source: &str) -> Vec<RuleViolation> {
        let mut violations = Vec::new();
        
        // Check for unused state variables
        violations.extend(Self::check_unused_state_variables(contract_type, source));
        
        // Check for inefficient field types
        violations.extend(Self::check_inefficient_field_types(contract_type));
        
        // Check for missing pub fields in contract types
        violations.extend(Self::check_missing_pub_fields(contract_type));
        
        violations
    }
    
    /// Analyze an implementation block for issues
    fn analyze_implementation(implementation: &SorobanImpl, source: &str) -> Vec<RuleViolation> {
        let mut violations = Vec::new();
        
        for function in &implementation.functions {
            violations.extend(Self::analyze_function(function, source));
        }
        
        // Check for unbounded loops
        violations.extend(Self::check_unbounded_loops(implementation, source));
        
        // Check for inefficient storage patterns
        violations.extend(Self::check_storage_patterns(implementation, source));
        
        violations
    }
    
    /// Analyze a function for issues
    fn analyze_function(function: &SorobanFunction, source: &str) -> Vec<RuleViolation> {
        let mut violations = Vec::new();
        
        // Check for expensive operations
        violations.extend(Self::check_expensive_operations(function, source));
        
        // Check parameter validation
        violations.extend(Self::check_parameter_validation(function));
        
        // Check return value handling
        violations.extend(Self::check_return_values(function));
        
        violations
    }
    
    /// Analyze overall contract structure
    fn analyze_contract_structure(contract: &SorobanContract) -> Vec<RuleViolation> {
        let mut violations = Vec::new();
        
        // Check for missing constructor
        if !contract.implementations.iter().any(|imp| {
            imp.functions.iter().any(|f| f.is_constructor)
        }) {
            violations.push(RuleViolation {
                rule_name: "missing-constructor".to_string(),
                description: "Contract should have a constructor function for initialization".to_string(),
                suggestion: "Add a 'new' function that initializes the contract state".to_string(),
                line_number: 1,
                variable_name: contract.name.clone(),
                severity: ViolationSeverity::Warning,
            });
        }
        
        // Check for admin pattern
        let has_admin = contract.contract_types.iter().any(|ct| {
            ct.fields.iter().any(|f| 
                f.name.contains("admin") || 
                f.name.contains("owner") ||
                f.type_name.contains("Address")
            )
        });
        
        if !has_admin {
            violations.push(RuleViolation {
                rule_name: "missing-admin-pattern".to_string(),
                description: "Consider adding an admin/owner field for access control".to_string(),
                suggestion: "Add an 'admin: Address' field to your contract state".to_string(),
                line_number: 1,
                variable_name: contract.name.clone(),
                severity: ViolationSeverity::Info,
            });
        }
        
        violations
    }
    
    /// Check for unused state variables
    fn check_unused_state_variables(contract_type: &SorobanStruct, source: &str) -> Vec<RuleViolation> {
        let mut violations = Vec::new();
        
        for field in &contract_type.fields {
            // Count occurrences of field name in the source (excluding struct definition)
            let field_usage_count = source.matches(&field.name).count();
            
            // If field is only mentioned in its own declaration, it's likely unused
            // (this is a heuristic - a more sophisticated analysis would be needed for production)
            if field_usage_count <= 1 {
                violations.push(RuleViolation {
                    rule_name: "unused-state-variable".to_string(),
                    description: format!("State variable '{}' appears to be unused", field.name),
                    suggestion: format!("Remove unused state variable '{}' to save ledger storage", field.name),
                    line_number: field.line_number,
                    variable_name: field.name.clone(),
                    severity: ViolationSeverity::Warning,
                });
            }
        }
        
        violations
    }
    
    /// Check for inefficient field types
    fn check_inefficient_field_types(contract_type: &SorobanStruct) -> Vec<RuleViolation> {
        let mut violations = Vec::new();
        
        for field in &contract_type.fields {
            // Check for overly large integer types
            if field.type_name == "u128" || field.type_name == "i128" {
                violations.push(RuleViolation {
                    rule_name: "inefficient-integer-type".to_string(),
                    description: format!("Field '{}' uses {} which may be unnecessarily large", field.name, field.type_name),
                    suggestion: format!("Consider using a smaller integer type like u64 or u32 if the range permits", field.name),
                    line_number: field.line_number,
                    variable_name: field.name.clone(),
                    severity: ViolationSeverity::Info,
                });
            }
            
            // Check for String usage (prefer Symbol for known values)
            if field.type_name == "String" {
                violations.push(RuleViolation {
                    rule_name: "string-instead-of-symbol".to_string(),
                    description: format!("Field '{}' uses String type", field.name),
                    suggestion: "Consider using Symbol for fixed string values to save storage costs".to_string(),
                    line_number: field.line_number,
                    variable_name: field.name.clone(),
                    severity: ViolationSeverity::Info,
                });
            }
        }
        
        violations
    }
    
    /// Check for missing pub fields in contract types
    fn check_missing_pub_fields(contract_type: &SorobanStruct) -> Vec<RuleViolation> {
        let mut violations = Vec::new();
        
        for field in &contract_type.fields {
            if matches!(field.visibility, FieldVisibility::Private) {
                violations.push(RuleViolation {
                    rule_name: "private-contract-field".to_string(),
                    description: format!("Field '{}' is private but contract fields should typically be public", field.name),
                    suggestion: format!("Change '{}' to 'pub {}' to make it accessible", field.name, field.name),
                    line_number: field.line_number,
                    variable_name: field.name.clone(),
                    severity: ViolationSeverity::Warning,
                });
            }
        }
        
        violations
    }
    
    /// Check for expensive operations in functions
    fn check_expensive_operations(function: &SorobanFunction, source: &str) -> Vec<RuleViolation> {
        let mut violations = Vec::new();
        let function_source = &function.raw_definition;
        
        // Check for string operations
        if function_source.contains(".to_string()") || function_source.contains("String::from(") {
            violations.push(RuleViolation {
                rule_name: "expensive-string-operation".to_string(),
                description: "String operations can be expensive in terms of gas/storage",
                suggestion: "Consider using Symbol or Bytes for fixed data, or minimize string operations",
                line_number: function.line_number,
                variable_name: function.name.clone(),
                severity: ViolationSeverity::Medium,
            });
        }
        
        // Check for vector allocations without capacity
        if function_source.contains("Vec::new()") && !function_source.contains("with_capacity") {
            violations.push(RuleViolation {
                rule_name: "vec-without-capacity".to_string(),
                description: "Vec::new() without capacity can cause multiple reallocations",
                suggestion: "Use Vec::with_capacity() to pre-allocate memory when size is known",
                line_number: function.line_number,
                variable_name: function.name.clone(),
                severity: ViolationSeverity::Medium,
            });
        }
        
        // Check for clone operations
        if function_source.contains(".clone()") {
            violations.push(RuleViolation {
                rule_name: "unnecessary-clone".to_string(),
                description: "Clone operations increase resource usage and gas costs",
                suggestion: "Avoid unnecessary cloning, use references where possible",
                line_number: function.line_number,
                variable_name: function.name.clone(),
                severity: ViolationSeverity::Medium,
            });
        }
        
        violations
    }
    
    /// Check parameter validation
    fn check_parameter_validation(function: &SorobanFunction) -> Vec<RuleViolation> {
        let mut violations = Vec::new();
        
        // Check for missing validation on Address parameters
        for param in &function.params {
            if param.type_name.contains("Address") {
                // Heuristic: if function name suggests it's a setter but doesn't validate address
                if function.name.contains("set") || function.name.contains("transfer") {
                    violations.push(RuleViolation {
                        rule_name: "missing-address-validation".to_string(),
                        description: format!("Function '{}' takes Address parameter but may lack validation", function.name),
                        suggestion: "Validate Address parameters to prevent invalid addresses",
                        line_number: function.line_number,
                        variable_name: function.name.clone(),
                        severity: ViolationSeverity::Medium,
                    });
                }
            }
        }
        
        violations
    }
    
    /// Check return value handling
    fn check_return_values(function: &SorobanFunction) -> Vec<RuleViolation> {
        let mut violations = Vec::new();
        
        // Check for functions that should return Result but don't
        if function.name.contains("transfer") || 
           function.name.contains("mint") || 
           function.name.contains("burn") {
            if function.return_type.is_none() || 
               !function.return_type.as_ref().unwrap().contains("Result") {
                violations.push(RuleViolation {
                    rule_name: "missing-error-handling".to_string(),
                    description: format!("Function '{}' should return Result for error handling", function.name),
                    suggestion: "Return Result<(), Error> to properly handle operation failures",
                    line_number: function.line_number,
                    variable_name: function.name.clone(),
                    severity: ViolationSeverity::Medium,
                });
            }
        }
        
        violations
    }
    
    /// Check for unbounded loops
    fn check_unbounded_loops(implementation: &SorobanImpl, source: &str) -> Vec<RuleViolation> {
        let mut violations = Vec::new();
        
        for function in &implementation.functions {
            let func_source = &function.raw_definition;
            
            // Look for loops without clear bounds
            if (func_source.contains("for ") || func_source.contains("while ")) &&
               !func_source.contains(".len()") && 
               !func_source.contains("range(") {
                violations.push(RuleViolation {
                    rule_name: "unbounded-loop".to_string(),
                    description: format!("Function '{}' contains potentially unbounded loop", function.name),
                    suggestion: "Ensure loops have clear termination conditions to prevent CPU limit exhaustion",
                    line_number: function.line_number,
                    variable_name: function.name.clone(),
                    severity: ViolationSeverity::High,
                });
            }
        }
        
        violations
    }
    
    /// Check for inefficient storage patterns
    fn check_storage_patterns(implementation: &SorobanImpl, source: &str) -> Vec<RuleViolation> {
        let mut violations = Vec::new();
        
        // Check for multiple storage reads of the same key
        let storage_reads: Vec<_> = implementation.functions
            .iter()
            .flat_map(|f| {
                let func_source = &f.raw_definition;
                // Simple heuristic: count occurrences of storage access patterns
                let read_count = func_source.matches(".get(").count() +
                               func_source.matches(".load(").count();
                if read_count > 2 {
                    Some((f, read_count))
                } else {
                    None
                }
            })
            .collect();
        
        for (function, read_count) in storage_reads {
            violations.push(RuleViolation {
                rule_name: "inefficient-storage-access".to_string(),
                description: format!("Function '{}' performs {} storage reads - consider caching", function.name, read_count),
                suggestion: "Cache frequently accessed storage values in local variables",
                line_number: function.line_number,
                variable_name: function.name.clone(),
                severity: ViolationSeverity::Medium,
            });
        }
        
        violations
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::soroban::parser::SorobanParser;
    
    #[test]
    fn test_analyze_contract_with_issues() {
        let source = r#"
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

#[contracttype]
pub struct BadContract {
    admin: Address,
    counter: u128,
    unused_field: String,
}

#[contractimpl]
impl BadContract {
    pub fn new(admin: Address) -> Self {
        Self {
            admin,
            counter: 0,
            unused_field: "never_used".to_string(),
        }
    }
    
    pub fn increment(&mut self) {
        self.counter += 1;
        let vec = Vec::new();
        vec.push(1);
    }
}
"#;
        
        let contract = SorobanParser::parse_contract(source, "test.rs").unwrap();
        let violations = SorobanAnalyzer::analyze_contract(&contract);
        
        // Should detect several issues
        assert!(!violations.is_empty());
        
        // Check for specific violations
        let unused_var_found = violations.iter().any(|v| 
            v.rule_name == "unused-state-variable" && v.variable_name == "unused_field"
        );
        assert!(unused_var_found);
        
        let inefficient_type_found = violations.iter().any(|v| 
            v.rule_name == "inefficient-integer-type" && v.variable_name == "counter"
        );
        assert!(inefficient_type_found);
        
        let private_field_found = violations.iter().any(|v| 
            v.rule_name == "private-contract-field" && v.variable_name == "admin"
        );
        assert!(private_field_found);
    }
    
    #[test]
    fn test_analyze_well_optimized_contract() {
        let source = r#"
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol};

#[contracttype]
pub struct GoodContract {
    pub admin: Address,
    pub total_supply: u64,
    pub balances: Map<Address, u64>,
}

#[contractimpl]
impl GoodContract {
    pub fn new(admin: Address, initial_supply: u64) -> Self {
        let mut balances = Map::new();
        balances.set(admin, initial_supply);
        
        Self {
            admin,
            total_supply: initial_supply,
            balances,
        }
    }
    
    pub fn transfer(from: Address, to: Address, amount: u64) -> Result<(), Error> {
        // Proper validation and error handling
        if amount == 0 {
            return Err(Error::InvalidAmount);
        }
        
        let from_balance = self.balances.get(from).unwrap_or(0);
        if from_balance < amount {
            return Err(Error::InsufficientBalance);
        }
        
        let to_balance = self.balances.get(to).unwrap_or(0);
        
        self.balances.set(from, from_balance - amount);
        self.balances.set(to, to_balance + amount);
        
        Ok(())
    }
}
"#;
        
        let contract = SorobanParser::parse_contract(source, "test.rs").unwrap();
        let violations = SorobanAnalyzer::analyze_contract(&contract);
        
        // Well-optimized contract should have minimal violations
        // Most should be informational rather than critical
        let critical_violations: Vec<_> = violations.iter()
            .filter(|v| matches!(v.severity, ViolationSeverity::High | ViolationSeverity::Error))
            .collect();
        
        assert!(critical_violations.is_empty() || critical_violations.len() <= 1);
    }
}