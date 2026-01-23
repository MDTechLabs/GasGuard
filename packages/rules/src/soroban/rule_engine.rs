//! Soroban-specific rule engine
//!
//! This module provides a specialized rule engine for analyzing Soroban smart contracts
//! with rules tailored to Soroban's unique characteristics and gas optimization patterns.

use super::soroban::{SorobanAnalyzer, SorobanContract, SorobanParser, SorobanResult};
use crate::{RuleViolation, ViolationSeverity};
use std::collections::HashMap;

/// Soroban-specific rule engine
pub struct SorobanRuleEngine {
    /// Active rules in the engine
    rules: HashMap<String, Box<dyn SorobanRule>>,
    /// Whether to enable all rules by default
    enable_all_by_default: bool,
}

impl SorobanRuleEngine {
    /// Create a new Soroban rule engine with default rules
    pub fn with_default_rules() -> Self {
        let mut engine = Self::new();
        engine.add_default_rules();
        engine
    }
    
    /// Create a new empty Soroban rule engine
    pub fn new() -> Self {
        Self {
            rules: HashMap::new(),
            enable_all_by_default: true,
        }
    }
    
    /// Add a rule to the engine
    pub fn add_rule<R: SorobanRule + 'static>(&mut self, rule: R) -> &mut Self {
        self.rules.insert(rule.id().to_string(), Box::new(rule));
        self
    }
    
    /// Add all default Soroban rules
    fn add_default_rules(&mut self) {
        self.add_rule(UnusedStateVariablesRule)
            .add_rule(InefficientStorageAccessRule)
            .add_rule(UnboundedLoopRule)
            .add_rule(ExpensiveStringOperationsRule)
            .add_rule(MissingConstructorRule)
            .add_rule(AdminPatternRule)
            .add_rule(InefficientIntegerTypesRule)
            .add_rule(MissingErrorHandlingRule);
    }
    
    /// Analyze Soroban contract source code
    pub fn analyze(&self, source: &str, file_path: &str) -> SorobanResult<Vec<RuleViolation>> {
        // Parse the contract
        let contract = SorobanParser::parse_contract(source, file_path)?;
        
        // Run analysis
        let violations = SorobanAnalyzer::analyze_contract(&contract);
        
        // Apply active rules
        let mut all_violations = violations;
        for rule in self.rules.values() {
            if rule.is_enabled() {
                all_violations.extend(rule.apply(&contract));
            }
        }
        
        Ok(all_violations)
    }
    
    /// Get all registered rules
    pub fn get_rules(&self) -> Vec<&dyn SorobanRule> {
        self.rules.values().map(|r| r.as_ref()).collect()
    }
    
    /// Enable or disable a specific rule
    pub fn set_rule_enabled(&mut self, rule_id: &str, enabled: bool) {
        if let Some(rule) = self.rules.get_mut(rule_id) {
            rule.set_enabled(enabled);
        }
    }
}

/// Trait for Soroban-specific rules
pub trait SorobanRule: Send + Sync {
    /// Unique identifier for the rule
    fn id(&self) -> &str;
    
    /// Human-readable name of the rule
    fn name(&self) -> &str;
    
    /// Description of what the rule checks for
    fn description(&self) -> &str;
    
    /// Severity level of violations from this rule
    fn severity(&self) -> ViolationSeverity;
    
    /// Whether this rule is currently enabled
    fn is_enabled(&self) -> bool;
    
    /// Enable or disable the rule
    fn set_enabled(&mut self, enabled: bool);
    
    /// Apply the rule to a parsed Soroban contract
    fn apply(&self, contract: &SorobanContract) -> Vec<RuleViolation>;
}

/// Rule for detecting unused state variables
pub struct UnusedStateVariablesRule {
    enabled: bool,
}

impl Default for UnusedStateVariablesRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for UnusedStateVariablesRule {
    fn id(&self) -> &str {
        "soroban-unused-state-variables"
    }
    
    fn name(&self) -> &str {
        "Unused State Variables"
    }
    
    fn description(&self) -> &str {
        "Detects state variables that are declared but never used"
    }
    
    fn severity(&self) -> ViolationSeverity {
        ViolationSeverity::Warning
    }
    
    fn is_enabled(&self) -> bool {
        self.enabled
    }
    
    fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }
    
    fn apply(&self, contract: &SorobanContract) -> Vec<RuleViolation> {
        let mut violations = Vec::new();
        
        for contract_type in &contract.contract_types {
            for field in &contract_type.fields {
                // Simple heuristic: if field name appears only once in source, it's likely unused
                let occurrences = contract.source.matches(&field.name).count();
                if occurrences <= 1 {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: format!("State variable '{}' appears to be unused", field.name),
                        suggestion: format!("Remove unused state variable '{}' to save ledger storage costs", field.name),
                        line_number: field.line_number,
                        variable_name: field.name.clone(),
                        severity: self.severity(),
                    });
                }
            }
        }
        
        violations
    }
}

/// Rule for detecting inefficient storage access patterns
pub struct InefficientStorageAccessRule {
    enabled: bool,
}

impl Default for InefficientStorageAccessRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for InefficientStorageAccessRule {
    fn id(&self) -> &str {
        "soroban-inefficient-storage"
    }
    
    fn name(&self) -> &str {
        "Inefficient Storage Access"
    }
    
    fn description(&self) -> &str {
        "Detects multiple reads/writes to the same storage key without caching"
    }
    
    fn severity(&self) -> ViolationSeverity {
        ViolationSeverity::Medium
    }
    
    fn is_enabled(&self) -> bool {
        self.enabled
    }
    
    fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }
    
    fn apply(&self, contract: &SorobanContract) -> Vec<RuleViolation> {
        let mut violations = Vec::new();
        
        for implementation in &contract.implementations {
            for function in &implementation.functions {
                let func_source = &function.raw_definition;
                
                // Count storage operations
                let get_count = func_source.matches(".get(").count();
                let set_count = func_source.matches(".set(").count();
                let load_count = func_source.matches(".load(").count();
                let store_count = func_source.matches(".store(").count();
                
                let total_ops = get_count + set_count + load_count + store_count;
                
                // If there are many storage operations, flag for review
                if total_ops > 3 {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: format!("Function '{}' performs {} storage operations - consider caching", function.name, total_ops),
                        suggestion: "Cache frequently accessed storage values in local variables to reduce ledger interactions",
                        line_number: function.line_number,
                        variable_name: function.name.clone(),
                        severity: self.severity(),
                    });
                }
            }
        }
        
        violations
    }
}

/// Rule for detecting unbounded loops
pub struct UnboundedLoopRule {
    enabled: bool,
}

impl Default for UnboundedLoopRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for UnboundedLoopRule {
    fn id(&self) -> &str {
        "soroban-unbounded-loop"
    }
    
    fn name(&self) -> &str {
        "Unbounded Loop Detection"
    }
    
    fn description(&self) -> &str {
        "Detects loops without clear termination conditions that could exhaust CPU limits"
    }
    
    fn severity(&self) -> ViolationSeverity {
        ViolationSeverity::High
    }
    
    fn is_enabled(&self) -> bool {
        self.enabled
    }
    
    fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }
    
    fn apply(&self, contract: &SorobanContract) -> Vec<RuleViolation> {
        let mut violations = Vec::new();
        
        for implementation in &contract.implementations {
            for function in &implementation.functions {
                let func_source = &function.raw_definition;
                
                // Look for potentially unbounded loops
                if (func_source.contains("loop {") || 
                    func_source.contains("while ") || 
                    func_source.contains("for ")) &&
                   !(func_source.contains(".len()") || 
                     func_source.contains("range(") || 
                     func_source.contains("..")) {
                    
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: format!("Function '{}' contains potentially unbounded loop", function.name),
                        suggestion: "Ensure loops have clear termination conditions to prevent CPU limit exhaustion",
                        line_number: function.line_number,
                        variable_name: function.name.clone(),
                        severity: self.severity(),
                    });
                }
            }
        }
        
        violations
    }
}

/// Rule for detecting expensive string operations
pub struct ExpensiveStringOperationsRule {
    enabled: bool,
}

impl Default for ExpensiveStringOperationsRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for ExpensiveStringOperationsRule {
    fn id(&self) -> &str {
        "soroban-expensive-strings"
    }
    
    fn name(&self) -> &str {
        "Expensive String Operations"
    }
    
    fn description(&self) -> &str {
        "Detects expensive string operations that increase gas/storage costs"
    }
    
    fn severity(&self) -> ViolationSeverity {
        ViolationSeverity::Medium
    }
    
    fn is_enabled(&self) -> bool {
        self.enabled
    }
    
    fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }
    
    fn apply(&self, contract: &SorobanContract) -> Vec<RuleViolation> {
        let mut violations = Vec::new();
        
        for implementation in &contract.implementations {
            for function in &implementation.functions {
                let func_source = &function.raw_definition;
                
                if func_source.contains(".to_string()") || 
                   func_source.contains("String::from(") ||
                   func_source.contains("format!(") {
                    
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: format!("Function '{}' uses expensive string operations", function.name),
                        suggestion: "Consider using Symbol or Bytes for fixed data, or minimize string operations to reduce gas costs",
                        line_number: function.line_number,
                        variable_name: function.name.clone(),
                        severity: self.severity(),
                    });
                }
            }
        }
        
        violations
    }
}

/// Rule for detecting missing constructors
pub struct MissingConstructorRule {
    enabled: bool,
}

impl Default for MissingConstructorRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for MissingConstructorRule {
    fn id(&self) -> &str {
        "soroban-missing-constructor"
    }
    
    fn name(&self) -> &str {
        "Missing Constructor"
    }
    
    fn description(&self) -> &str {
        "Detects contracts without constructor functions for initialization"
    }
    
    fn severity(&self) -> ViolationSeverity {
        ViolationSeverity::Warning
    }
    
    fn is_enabled(&self) -> bool {
        self.enabled
    }
    
    fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }
    
    fn apply(&self, contract: &SorobanContract) -> Vec<RuleViolation> {
        let has_constructor = contract.implementations.iter().any(|imp| {
            imp.functions.iter().any(|f| f.is_constructor)
        });
        
        if !has_constructor {
            vec![RuleViolation {
                rule_name: self.id().to_string(),
                description: "Contract lacks a constructor function for initialization".to_string(),
                suggestion: "Add a 'new' function that initializes the contract state properly".to_string(),
                line_number: 1,
                variable_name: contract.name.clone(),
                severity: self.severity(),
            }]
        } else {
            Vec::new()
        }
    }
}

/// Rule for suggesting admin pattern
pub struct AdminPatternRule {
    enabled: bool,
}

impl Default for AdminPatternRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for AdminPatternRule {
    fn id(&self) -> &str {
        "soroban-admin-pattern"
    }
    
    fn name(&self) -> &str {
        "Admin Pattern Suggestion"
    }
    
    fn description(&self) -> &str {
        "Suggests adding admin/owner pattern for access control"
    }
    
    fn severity(&self) -> ViolationSeverity {
        ViolationSeverity::Info
    }
    
    fn is_enabled(&self) -> bool {
        self.enabled
    }
    
    fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }
    
    fn apply(&self, contract: &SorobanContract) -> Vec<RuleViolation> {
        let has_admin = contract.contract_types.iter().any(|ct| {
            ct.fields.iter().any(|f| 
                f.name.contains("admin") || 
                f.name.contains("owner") ||
                f.type_name.contains("Address")
            )
        });
        
        if !has_admin {
            vec![RuleViolation {
                rule_name: self.id().to_string(),
                description: "Consider adding an admin/owner field for access control",
                suggestion: "Add an 'admin: Address' field to your contract state for administrative functions",
                line_number: 1,
                variable_name: contract.name.clone(),
                severity: self.severity(),
            }]
        } else {
            Vec::new()
        }
    }
}

/// Rule for detecting inefficient integer types
pub struct InefficientIntegerTypesRule {
    enabled: bool,
}

impl Default for InefficientIntegerTypesRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for InefficientIntegerTypesRule {
    fn id(&self) -> &str {
        "soroban-inefficient-integers"
    }
    
    fn name(&self) -> &str {
        "Inefficient Integer Types"
    }
    
    fn description(&self) -> &str {
        "Detects use of unnecessarily large integer types"
    }
    
    fn severity(&self) -> ViolationSeverity {
        ViolationSeverity::Info
    }
    
    fn is_enabled(&self) -> bool {
        self.enabled
    }
    
    fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }
    
    fn apply(&self, contract: &SorobanContract) -> Vec<RuleViolation> {
        let mut violations = Vec::new();
        
        for contract_type in &contract.contract_types {
            for field in &contract_type.fields {
                if field.type_name == "u128" || field.type_name == "i128" {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: format!("Field '{}' uses {} which may be unnecessarily large", field.name, field.type_name),
                        suggestion: format!("Consider using a smaller integer type like u64 or u32 if the range permits"),
                        line_number: field.line_number,
                        variable_name: field.name.clone(),
                        severity: self.severity(),
                    });
                }
            }
        }
        
        violations
    }
}

/// Rule for detecting missing error handling
pub struct MissingErrorHandlingRule {
    enabled: bool,
}

impl Default for MissingErrorHandlingRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for MissingErrorHandlingRule {
    fn id(&self) -> &str {
        "soroban-missing-error-handling"
    }
    
    fn name(&self) -> &str {
        "Missing Error Handling"
    }
    
    fn description(&self) -> &str {
        "Detects functions that should return Result but don't"
    }
    
    fn severity(&self) -> ViolationSeverity {
        ViolationSeverity::Medium
    }
    
    fn is_enabled(&self) -> bool {
        self.enabled
    }
    
    fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }
    
    fn apply(&self, contract: &SorobanContract) -> Vec<RuleViolation> {
        let mut violations = Vec::new();
        
        for implementation in &contract.implementations {
            for function in &implementation.functions {
                // Functions that modify state should return Result
                if (function.name.contains("transfer") || 
                    function.name.contains("mint") || 
                    function.name.contains("burn") ||
                    function.name.contains("set")) &&
                   (function.return_type.is_none() || 
                    !function.return_type.as_ref().unwrap().contains("Result")) {
                    
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: format!("Function '{}' should return Result for proper error handling", function.name),
                        suggestion: "Return Result<(), Error> to properly handle operation failures and provide better error reporting",
                        line_number: function.line_number,
                        variable_name: function.name.clone(),
                        severity: self.severity(),
                    });
                }
            }
        }
        
        violations
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_soroban_rule_engine_creation() {
        let engine = SorobanRuleEngine::with_default_rules();
        assert!(!engine.get_rules().is_empty());
        
        let rule_ids: Vec<_> = engine.get_rules().iter().map(|r| r.id()).collect();
        assert!(rule_ids.contains(&"soroban-unused-state-variables"));
        assert!(rule_ids.contains(&"soroban-inefficient-storage"));
    }
    
    #[test]
    fn test_unused_state_variables_rule() {
        let source = r#"
use soroban_sdk::{contract, contractimpl, contracttype, Address};

#[contracttype]
pub struct TestContract {
    pub admin: Address,
    pub unused_counter: u64,
}

#[contractimpl]
impl TestContract {
    pub fn new(admin: Address) -> Self {
        Self { admin, unused_counter: 0 }
    }
    
    pub fn get_admin(&self) -> Address {
        self.admin
    }
}
"#;
        
        let engine = SorobanRuleEngine::new()
            .add_rule(UnusedStateVariablesRule::default());
        
        let violations = engine.analyze(source, "test.rs").unwrap();
        
        let unused_found = violations.iter().any(|v| 
            v.rule_name == "soroban-unused-state-variables" && 
            v.variable_name == "unused_counter"
        );
        assert!(unused_found);
    }
}