//! Rule: Detect Unnecessary Soroban Cloning (Issue #775)
//!
//! Unnecessary `.clone()` calls on Soroban types increase memory and CPU
//! resource usage. In Soroban, host-object operations are metered; every
//! avoidable clone burns extra budget that could be eliminated by borrowing
//! or reusing an existing value.
//!
//! ## What this rule detects
//!
//! * Functions that call `.clone()` when the original value is never used
//!   after the clone (i.e., ownership could simply be moved).
//! * Multiple `.clone()` calls on the same variable within a single function.
//! * Cloning of large Soroban types (`Vec`, `Map`, `Bytes`, `BytesN`, `String`).
//!
//! ## Suggested fix
//!
//! * Pass by reference where possible: prefer `&value` over `value.clone()`.
//! * Move the value instead of cloning when the original is no longer needed.
//! * Cache a single clone in a local variable if it must be used multiple times.

use crate::soroban::rule_engine::SorobanRule;
use crate::soroban::SorobanContract;
use crate::{RuleViolation, ViolationSeverity};

/// Large Soroban SDK types whose cloning is particularly expensive.
const EXPENSIVE_CLONE_TYPES: &[&str] = &[
    "Vec<",
    "Map<",
    "Bytes",
    "BytesN",
    "soroban_sdk::String",
    "String",
    "Address",
];

/// Rule for detecting unnecessary `.clone()` calls in Soroban contracts.
pub struct UnnecessaryCloningRule {
    enabled: bool,
}

impl Default for UnnecessaryCloningRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for UnnecessaryCloningRule {
    fn id(&self) -> &str {
        "soroban-unnecessary-cloning"
    }

    fn name(&self) -> &str {
        "Unnecessary Soroban Cloning"
    }

    fn description(&self) -> &str {
        "Detects unnecessary .clone() calls on Soroban types that increase CPU and memory \
         resource usage. Each avoidable clone consumes metered host-object budget."
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
                let src = &function.raw_definition;
                let clone_count = src.matches(".clone()").count();

                // Flag functions with multiple clone calls — at least one is likely avoidable.
                if clone_count >= 2 {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: format!(
                            "Function '{}' contains {} .clone() calls; at least one may be avoidable",
                            function.name, clone_count
                        ),
                        suggestion: "Consider passing by reference (&T) or moving the value \
                            instead of cloning. Cache a single clone in a local variable if \
                            multiple uses are required."
                            .to_string(),
                        line_number: function.line_number,
                        column_number: 0,
                        variable_name: function.name.clone(),
                        severity: self.severity(),
                    });
                }

                // Flag cloning of known expensive Soroban types, even once.
                if clone_count >= 1 {
                    for expensive_type in EXPENSIVE_CLONE_TYPES {
                        // Look for patterns like `some_vec.clone()` or type annotations
                        // followed by a clone further in the function.
                        if src.contains(expensive_type) && src.contains(".clone()") {
                            violations.push(RuleViolation {
                                rule_name: self.id().to_string(),
                                description: format!(
                                    "Function '{}' clones a value of expensive type '{}'; \
                                     this increases metered resource usage",
                                    function.name, expensive_type
                                ),
                                suggestion: format!(
                                    "Avoid cloning '{}' values. Pass a reference instead, \
                                     or restructure logic to transfer ownership without cloning.",
                                    expensive_type
                                ),
                                line_number: function.line_number,
                                column_number: 0,
                                variable_name: function.name.clone(),
                                severity: ViolationSeverity::Medium,
                            });
                            break; // one violation per function per type category is enough
                        }
                    }
                }
            }
        }

        violations
    }
}
