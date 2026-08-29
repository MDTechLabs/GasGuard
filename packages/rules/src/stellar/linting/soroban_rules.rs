//! Soroban-specific linting rules
//!
//! Rules that check for Soroban contract-specific patterns and issues

use super::SorobanLintRule;
use crate::{RuleViolation, ViolationSeverity};

/// Rule to ensure proper use of Soroban contract macros
pub struct ContractMacroRule;

impl SorobanLintRule for ContractMacroRule {
    fn id(&self) -> &'static str {
        "soroban-contract-macro"
    }

    fn name(&self) -> &'static str {
        "Soroban Contract Macro Usage"
    }

    fn description(&self) -> &'static str {
        "Ensures proper use of #[contract], #[contractimpl], and #[contracttype] macros"
    }

    fn severity(&self) -> ViolationSeverity {
        ViolationSeverity::High
    }

    fn check(&self, source: &str, file_path: &str) -> Option<Vec<RuleViolation>> {
        let mut violations = Vec::new();

        // Check for soroban_sdk import
        if !source.contains("soroban_sdk") {
            violations.push(RuleViolation {
                rule_name: self.id().to_string(),
                description: "Soroban contracts should import soroban_sdk".to_string(),
                suggestion: "Add `use soroban_sdk::{contract, contractimpl, contracttype};`"
                    .to_string(),
                line_number: 1,
                column_number: 0,
                variable_name: file_path.to_string(),
                severity: self.severity(),
            });
        }

        // Check for #[contract] macro usage
        if source.contains("#[contractimpl]") && !source.contains("#[contracttype]") {
            violations.push(RuleViolation {
                rule_name: self.id().to_string(),
                description: "Contract uses #[contractimpl] but missing #[contracttype]"
                    .to_string(),
                suggestion: "Define contract state struct with #[contracttype] macro".to_string(),
                line_number: 1,
                column_number: 0,
                variable_name: file_path.to_string(),
                severity: ViolationSeverity::High,
            });
        }

        // Check for duplicate macro attributes
        let lines: Vec<&str> = source.lines().collect();
        for (i, line) in lines.iter().enumerate() {
            if line.matches("#[contractimpl]").count() > 1 {
                violations.push(RuleViolation {
                    rule_name: self.id().to_string(),
                    description: "Duplicate #[contractimpl] attribute detected".to_string(),
                    suggestion: "Remove duplicate #[contractimpl] attributes".to_string(),
                    line_number: i + 1,
                    column_number: 0,
                    variable_name: file_path.to_string(),
                    severity: ViolationSeverity::Critical,
                });
            }
        }

        if violations.is_empty() {
            None
        } else {
            Some(violations)
        }
    }
}

/// Rule to ensure Env parameter is properly used in functions
pub struct EnvParameterRule;

impl SorobanLintRule for EnvParameterRule {
    fn id(&self) -> &'static str {
        "soroban-env-parameter"
    }

    fn name(&self) -> &'static str {
        "Soroban Env Parameter Usage"
    }

    fn description(&self) -> &'static str {
        "Ensures Env parameter is properly used in contract functions"
    }

    fn severity(&self) -> ViolationSeverity {
        ViolationSeverity::Medium
    }

    fn check(&self, source: &str, file_path: &str) -> Option<Vec<RuleViolation>> {
        let mut violations = Vec::new();

        // Check for functions that modify state but don't have Env parameter
        let lines: Vec<&str> = source.lines().collect();
        let in_impl_block = false;

        for (i, line) in lines.iter().enumerate() {
            // Look for pub fn that might need Env
            if line.contains("pub fn") && !line.contains("Env") {
                // Check if function body has storage operations
                if i + 1 < lines.len() {
                    let next_lines = lines
                        .iter()
                        .skip(i)
                        .take(10)
                        .copied()
                        .collect::<Vec<_>>()
                        .join("\n");
                    if next_lines.contains(".set(") || next_lines.contains(".put(") {
                        violations.push(RuleViolation {
                            rule_name: self.id().to_string(),
                            description:
                                "Function performs storage operations but lacks Env parameter"
                                    .to_string(),
                            suggestion: "Add `env: &Env` parameter to function signature"
                                .to_string(),
                            line_number: i + 1,
                            column_number: 0,
                            variable_name: file_path.to_string(),
                            severity: self.severity(),
                        });
                    }
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

/// Rule to check for proper storage patterns
pub struct StoragePatternRule;

impl SorobanLintRule for StoragePatternRule {
    fn id(&self) -> &'static str {
        "soroban-storage-pattern"
    }

    fn name(&self) -> &'static str {
        "Soroban Storage Pattern"
    }

    fn description(&self) -> &'static str {
        "Checks for proper storage access patterns in Soroban contracts"
    }

    fn severity(&self) -> ViolationSeverity {
        ViolationSeverity::Medium
    }

    fn check(&self, source: &str, file_path: &str) -> Option<Vec<RuleViolation>> {
        let mut violations = Vec::new();

        // Check for persistent storage without proper key management
        if source.contains("Persistent") && !source.contains("StorageKey") {
            violations.push(RuleViolation {
                rule_name: self.id().to_string(),
                description: "Using Persistent storage without StorageKey".to_string(),
                suggestion: "Use StorageKey for type-safe storage key management".to_string(),
                line_number: 1,
                column_number: 0,
                variable_name: file_path.to_string(),
                severity: self.severity(),
            });
        }

        // Check for Instance storage without proper initialization
        if source.contains("Instance") && !source.contains("new(") {
            violations.push(RuleViolation {
                rule_name: self.id().to_string(),
                description: "Using Instance storage without initialization".to_string(),
                suggestion: "Initialize Instance storage with `Instance::new(&env, key)`"
                    .to_string(),
                line_number: 1,
                column_number: 0,
                variable_name: file_path.to_string(),
                severity: ViolationSeverity::Warning,
            });
        }

        if violations.is_empty() {
            None
        } else {
            Some(violations)
        }
    }
}
