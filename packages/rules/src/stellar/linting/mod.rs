//! Stellar Soroban Contract Linting Rules
//!
//! This module provides custom linting rules specifically for Soroban contracts
//! that go beyond standard Rust linters to catch Soroban-specific issues.

pub mod soroban_rules;
pub mod stellar_sdk_rules;
pub mod gas_optimization_rules;

pub use soroban_rules::*;
pub use stellar_sdk_rules::*;
pub use gas_optimization_rules::*;

use crate::{RuleViolation, ViolationSeverity};

/// Main linting engine for Soroban contracts
pub struct SorobanLinter {
    rules: Vec<Box<dyn SorobanLintRule>>,
}

impl SorobanLinter {
    /// Create a new linter with default rules
    pub fn new() -> Self {
        let mut rules: Vec<Box<dyn SorobanLintRule>> = Vec::new();
        
        // Add default Soroban-specific rules
        rules.push(Box::new(soroban_rules::ContractMacroRule));
        rules.push(Box::new(soroban_rules::EnvParameterRule));
        rules.push(Box::new(soroban_rules::StoragePatternRule));
        rules.push(Box::new(stellar_sdk_rules::SdkUsageRule));
        rules.push(Box::new(stellar_sdk_rules::AddressValidationRule));
        rules.push(Box::new(gas_optimization_rules::StorageReadRule));
        rules.push(Box::new(gas_optimization_rules::MapIterationRule));
        rules.push(Box::new(gas_optimization_rules::EventEmissionRule));
        
        Self { rules }
    }

    /// Add a custom rule to the linter
    pub fn add_rule(mut self, rule: Box<dyn SorobanLintRule>) -> Self {
        self.rules.push(rule);
        self
    }

    /// Lint a Soroban contract source code
    pub fn lint(&self, source: &str, file_path: &str) -> Vec<RuleViolation> {
        let mut violations = Vec::new();
        
        for rule in &self.rules {
            if let Some(rule_violations) = rule.check(source, file_path) {
                violations.extend(rule_violations);
            }
        }
        
        violations
    }

    /// Get all registered rules
    pub fn get_rules(&self) -> &[Box<dyn SorobanLintRule>] {
        &self.rules
    }
}

impl Default for SorobanLinter {
    fn default() -> Self {
        Self::new()
    }
}

/// Trait for Soroban-specific linting rules
pub trait SorobanLintRule: Send + Sync {
    /// Get the rule ID
    fn id(&self) -> &'static str;
    
    /// Get the rule name
    fn name(&self) -> &'static str;
    
    /// Get the rule description
    fn description(&self) -> &'static str;
    
    /// Get the rule severity
    fn severity(&self) -> ViolationSeverity;
    
    /// Check the source code for violations
    fn check(&self, source: &str, file_path: &str) -> Option<Vec<RuleViolation>>;
}
