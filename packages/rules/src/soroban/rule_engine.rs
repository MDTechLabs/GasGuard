//! Soroban-specific rule engine
//!
//! This module provides a specialized rule engine for analyzing Soroban smart contracts
//! with rules tailored to Soroban's unique characteristics and gas optimization patterns.

use super::{SorobanAnalyzer, SorobanContract, SorobanParser, SorobanResult};
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
        self.add_rule(UnusedStateVariablesRule::default())
            .add_rule(InefficientStorageAccessRule::default())
            .add_rule(UnboundedLoopRule::default())
            .add_rule(ExpensiveStringOperationsRule::default())
            .add_rule(MissingConstructorRule::default())
            .add_rule(AdminPatternRule::default())
            .add_rule(InefficientIntegerTypesRule::default())
            .add_rule(MissingErrorHandlingRule::default())
            .add_rule(EmergencyWithdrawalRule::default())
            .add_rule(GovernanceVotingRule::default())
            .add_rule(ClaimExpirationRule::default())    // #117
            .add_rule(AntiFrontRunningRule::default())   // #118
            .add_rule(SecureRandomnessRule::default())   // #119
            .add_rule(UpgradeVersionTrackingRule::default()); // #123
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
                        column_number: 0,
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
                        suggestion: "Cache frequently accessed storage values in local variables to reduce ledger interactions".to_string(),
                        line_number: function.line_number,
                        column_number: 0,
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
                        suggestion: "Ensure loops have clear termination conditions to prevent CPU limit exhaustion".to_string(),
                        line_number: function.line_number,
                        column_number: 0,
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
                        suggestion: "Consider using Symbol or Bytes for fixed data, or minimize string operations to reduce gas costs".to_string(),
                        line_number: function.line_number,
                        column_number: 0,
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
                column_number: 0,
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
                description: "Consider adding an admin/owner field for access control".to_string(),
                suggestion: "Add an 'admin: Address' field to your contract state for administrative functions".to_string(),
                line_number: 1,
                column_number: 0,
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
                        column_number: 0,
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
                        suggestion: "Return Result<(), Error> to properly handle operation failures and provide better error reporting".to_string(),
                        line_number: function.line_number,
                        column_number: 0,
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
        
        let mut engine = SorobanRuleEngine::new();
        engine.add_rule(UnusedStateVariablesRule::default());
        
        let violations = engine.analyze(source, "test.rs").unwrap();
        
        let unused_found = violations.iter().any(|v| 
            v.rule_name == "soroban-unused-state-variables" && 
            v.variable_name == "unused_counter"
        );
        assert!(unused_found);
    }
}
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
                // Simple heuristic: Definition + Initialization = 2 occurrences.
                let occurrences = contract.source.matches(&field.name).count();
                if occurrences <= 2 {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: format!("State variable '{}' appears to be unused", field.name),
                        suggestion: format!("Remove unused state variable '{}' to save ledger storage costs", field.name),
                        line_number: field.line_number,
                        column_number: 0,
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
                        suggestion: "Cache frequently accessed storage values in local variables to reduce ledger interactions".to_string(),
                        line_number: function.line_number,
                        column_number: 0,
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
                        suggestion: "Ensure loops have clear termination conditions to prevent CPU limit exhaustion".to_string(),
                        line_number: function.line_number,
                        column_number: 0,
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
                        suggestion: "Consider using Symbol or Bytes for fixed data, or minimize string operations to reduce gas costs".to_string(),
                        line_number: function.line_number,
                        column_number: 0,
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
                column_number: 0,
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
                description: "Consider adding an admin/owner field for access control".to_string(),
                suggestion: "Add an 'admin: Address' field to your contract state for administrative functions".to_string(),
                line_number: 1,
                column_number: 0,
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
                        suggestion: "Consider using a smaller integer type like u64 or u32 if the range permits".to_string(),
                        line_number: field.line_number,
                        column_number: 0,
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
                        suggestion: "Return Result<(), Error> to properly handle operation failures and provide better error reporting".to_string(),
                        line_number: function.line_number,
                        column_number: 0,
                        variable_name: function.name.clone(),
                        severity: self.severity(),
                    });
                }
            }
        }
        
        violations
    }
}

/// Rule for detecting emergency withdrawal functions without authorization
pub struct EmergencyWithdrawalRule {
    enabled: bool,
}

impl Default for EmergencyWithdrawalRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for EmergencyWithdrawalRule {
    fn id(&self) -> &str {
        "soroban-emergency-withdrawal"
    }
    
    fn name(&self) -> &str {
        "Emergency Withdrawal Check"
    }
    
    fn description(&self) -> &str {
        "Detects emergency withdrawal functions lacking proper authorization or whitelist checks"
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
                let func_name = function.name.to_lowercase();
                
                // Identify emergency withdrawal functions
                if func_name.contains("emergency") || func_name.contains("withdraw_all") || func_name.contains("rescue") {
                    let source = &function.raw_definition;
                    
                    if !source.contains("require_auth") && !source.contains("authorize") && !source.contains("panic!") {
                        violations.push(RuleViolation {
                            rule_name: self.id().to_string(),
                            description: format!("Emergency function '{}' lacks authorization check", function.name),
                            suggestion: "Implement restrictive access control for emergency functions to prevent unauthorized fund depletion".to_string(),
                            line_number: function.line_number,
                            column_number: 0,
                            variable_name: function.name.clone(),
                            severity: self.severity(),
                        });
                    }
                }
            }
        }
        
        violations
    }
}

/// Rule for detecting governance voting functions without authorization
pub struct GovernanceVotingRule {
    enabled: bool,
}

impl Default for GovernanceVotingRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for GovernanceVotingRule {
    fn id(&self) -> &str {
        "soroban-governance-voting"
    }
    
    fn name(&self) -> &str {
        "Governance Voting Check"
    }
    
    fn description(&self) -> &str {
        "Detects voting functions that may be missing authorization checks or are structurally insecure"
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
                let func_name = function.name.to_lowercase();
                
                // Identify voting functions
                if func_name.contains("vote") || func_name.contains("propose") || func_name.contains("ballot") {
                    let source = &function.raw_definition;
                    
                    // Check for authorization: require_auth() or authorize()
                    if !source.contains("require_auth") && !source.contains("authorize") {
                        violations.push(RuleViolation {
                            rule_name: self.id().to_string(),
                            description: format!("Governance function '{}' lacks explicit authorization check", function.name),
                            suggestion: "Add 'caller.require_auth()' or 'env.authorize()' to ensure only authorized users can perform governance actions".to_string(),
                            line_number: function.line_number,
                            column_number: 0,
                            variable_name: function.name.clone(),
                            severity: self.severity(),
                        });
                    }
                    
                    // Check for timestamp/expiration usage in proposals (heuristic)
                    if func_name.contains("propose") && !source.contains("timestamp") && !source.contains("expiration") {
                        violations.push(RuleViolation {
                            rule_name: self.id().to_string(),
                            description: format!("Governance function '{}' may be missing proposal expiration logic", function.name),
                            suggestion: "Proposals should have an expiration timestamp to prevent indefinite open voting".to_string(),
                            line_number: function.line_number,
                            column_number: 0,
                            variable_name: function.name.clone(),
                            severity: ViolationSeverity::Warning,
                        });
                    }
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
        assert!(rule_ids.contains(&"soroban-governance-voting"));
        assert!(rule_ids.contains(&"soroban-emergency-withdrawal"));
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
        
        let mut engine = SorobanRuleEngine::new();
        engine.add_rule(UnusedStateVariablesRule::default());
        
        let violations = engine.analyze(source, "test.rs").unwrap();
        
        let unused_found = violations.iter().any(|v| 
            v.rule_name == "soroban-unused-state-variables" && 
            v.variable_name == "unused_counter"
        );
        assert!(unused_found);
    }

    #[test]
    fn test_governance_voting_rule() {
        let source = r#"
use soroban_sdk::{contract, contractimpl, Env, Address};

#[contract]
pub struct GovernanceContract;

#[contractimpl]
impl GovernanceContract {
    // ❌ Issue: Missing authorization check for voting
    pub fn vote(env: Env, voter: Address, proposal_id: u64, support: bool) {
        // voter should have require_auth() called here
        let mut current_votes: u64 = env.storage().instance().get(&proposal_id).unwrap_or(0);
        if support {
            current_votes += 1;
        }
        env.storage().instance().set(&proposal_id, &current_votes);
    }
}
"#;
        
        let rule = GovernanceVotingRule::default();
        let contract = SorobanParser::parse_contract(source, "governance.rs").unwrap();
        
        let violations = rule.apply(&contract);
        
        let vote_issue_found = violations.iter().any(|v| 
            v.rule_name == "soroban-governance-voting" && 
            v.description.contains("vote")
        );
        assert!(vote_issue_found);
    }
}

/// Rule for detecting missing claim expiration logic (#117)
pub struct ClaimExpirationRule {
    enabled: bool,
}

impl Default for ClaimExpirationRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for ClaimExpirationRule {
    fn id(&self) -> &str {
        "soroban-claim-expiration"
    }
    
    fn name(&self) -> &str {
        "Claim Expiration Check"
    }
    
    fn description(&self) -> &str {
        "Detects claim-related functions that lack expiration/timeout logic"
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
                let func_name = function.name.to_lowercase();
                
                if func_name.contains("claim") || func_name.contains("settle") || func_name.contains("redeem") {
                    let source = &function.raw_definition;
                    
                    if !source.contains("timestamp") && !source.contains("expiration") && !source.contains("expiry") {
                        violations.push(RuleViolation {
                            rule_name: self.id().to_string(),
                            description: format!("Claim function '{}' may be missing expiration logic", function.name),
                            suggestion: "Add an expiration timestamp check to ensure claims cannot be processed after a certain deadline".to_string(),
                            line_number: function.line_number,
                            column_number: 0,
                            variable_name: function.name.clone(),
                            severity: self.severity(),
                        });
                    }
                }
            }
        }
        
        violations
    }
}

/// Rule for detecting susceptibility to front-running (#118)
pub struct AntiFrontRunningRule {
    enabled: bool,
}

impl Default for AntiFrontRunningRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for AntiFrontRunningRule {
    fn id(&self) -> &str {
        "soroban-anti-front-running"
    }
    
    fn name(&self) -> &str {
        "Anti-Front-Running Protection"
    }
    
    fn description(&self) -> &str {
        "Detects transaction patterns vulnerable to front-running (e.g., missing nonces or slippage checks)"
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
                let func_name = function.name.to_lowercase();
                
                // Sensitive operations: transfer, swap, liquidate
                if func_name.contains("transfer") || func_name.contains("swap") || func_name.contains("liquidate") {
                    let source = &function.raw_definition;
                    
                    if !source.contains("nonce") && !source.contains("deadline") && !source.contains("min_amount") {
                        violations.push(RuleViolation {
                            rule_name: self.id().to_string(),
                            description: format!("Function '{}' may be vulnerable to front-running", function.name),
                            suggestion: "Implement nonces, deadlines, or minimum output checks (slippage protection) to prevent transaction reordering attacks".to_string(),
                            line_number: function.line_number,
                            column_number: 0,
                            variable_name: function.name.clone(),
                            severity: self.severity(),
                        });
                    }
                }
            }
        }
        
        violations
    }
}

/// Rule for detecting insecure randomness sources (#119)
pub struct SecureRandomnessRule {
    enabled: bool,
}

impl Default for SecureRandomnessRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for SecureRandomnessRule {
    fn id(&self) -> &str {
        "soroban-secure-randomness"
    }
    
    fn name(&self) -> &str {
        "Secure Randomness Check"
    }
    
    fn description(&self) -> &str {
        "Detects the use of predictable values for randomness instead of 'env.pseudo_random()'"
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
        
        let insecure_patterns = ["env.ledger().timestamp()", "env.ledger().sequence()", "timestamp()", "sequence()"];
        
        for implementation in &contract.implementations {
            for function in &implementation.functions {
                let source = &function.raw_definition;
                
                if (source.contains("random") || source.contains("seed")) && 
                   insecure_patterns.iter().any(|p| source.contains(p)) &&
                   !source.contains("pseudo_random") {
                    
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: format!("Function '{}' uses predictable values for randomness", function.name),
                        suggestion: "Use 'env.pseudo_random()' for generating secure random values instead of ledger block properties".to_string(),
                        line_number: function.line_number,
                        column_number: 0,
                        variable_name: function.name.clone(),
                        severity: self.severity(),
                    });
                }
            }
        }
        
        violations
    }
}

/// Rule for detecting missing version tracking in contracts (#123)
pub struct UpgradeVersionTrackingRule {
    enabled: bool,
}

impl Default for UpgradeVersionTrackingRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for UpgradeVersionTrackingRule {
    fn id(&self) -> &str {
        "soroban-upgrade-version-tracking"
    }
    
    fn name(&self) -> &str {
        "Upgrade Version Tracking"
    }
    
    fn description(&self) -> &str {
        "Detects contracts missing version information or upgrade tracking"
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
        let mut has_version_field = false;
        let mut has_version_query = false;
        
        for ct in &contract.contract_types {
            if ct.fields.iter().any(|f| f.name.contains("version")) {
                has_version_field = true;
                break;
            }
        }
        
        for imp in &contract.implementations {
            if imp.functions.iter().any(|f| f.name == "version" || f.name == "get_version") {
                has_version_query = true;
                break;
            }
        }
        
        if !has_version_field && !has_version_query {
            return vec![RuleViolation {
                rule_name: self.id().to_string(),
                description: "Contract lacks version tracking or a version query method".to_string(),
                suggestion: "Add a 'version: u32' field to your state and a 'version()' method to track contract upgrades".to_string(),
                line_number: 1,
                column_number: 0,
                variable_name: contract.name.clone(),
                severity: self.severity(),
            }];
        }
        
        Vec::new()
    }
}

#[cfg(test)]
mod issue_tests {
    use super::*;
    
    #[test]
    fn test_claim_expiration_rule() {
        let source = r#"
use soroban_sdk::{contract, contractimpl, Env, Address};

#[contract]
pub struct MyContract;

#[contractimpl]
impl MyContract {
    pub fn claim_reward(env: Env, user: Address) {
        // ❌ Missing expiration check
        let reward = 100;
        env.storage().instance().set(&user, &reward);
    }
    
    pub fn secure_claim(env: Env, deadline: u64) {
        // ✅ Has expiration check
        if env.ledger().timestamp() > deadline {
            panic!("Expired");
        }
    }
}
"#;
        let rule = ClaimExpirationRule::default();
        let contract = SorobanParser::parse_contract(source, "test.rs").unwrap();
        let violations = rule.apply(&contract);
        
        // Should find one violation for claim_reward
        assert!(violations.iter().any(|v| v.variable_name == "claim_reward"));
        // Should NOT find violation for secure_claim
        assert!(!violations.iter().any(|v| v.variable_name == "secure_claim"));
    }

    #[test]
    fn test_secure_randomness_rule() {
        let source = r#"
use soroban_sdk::{contract, contractimpl, Env};

#[contract]
pub struct MyContract;

#[contractimpl]
impl MyContract {
    pub fn roll_dice(env: Env) -> u32 {
        // ❌ Insecure randomness
        let seed = env.ledger().timestamp();
        (seed % 6) + 1
    }
}
"#;
        let rule = SecureRandomnessRule::default();
        let contract = SorobanParser::parse_contract(source, "test.rs").unwrap();
        let violations = rule.apply(&contract);
        assert!(!violations.is_empty());
    }

    #[test]
    fn test_upgrade_version_tracking_rule() {
        let source = r#"
use soroban_sdk::{contract, contractimpl};

#[contract]
pub struct MyContract;

#[contractimpl]
impl MyContract {
    pub fn hello() {}
}
"#;
        let rule = UpgradeVersionTrackingRule::default();
        let contract = SorobanParser::parse_contract(source, "test.rs").unwrap();
        let violations = rule.apply(&contract);
        
        // Should find a violation because version is missing
        assert!(violations.iter().any(|v| v.rule_name == "soroban-upgrade-version-tracking"));
    }
}
>>>>>>> upstream/main
