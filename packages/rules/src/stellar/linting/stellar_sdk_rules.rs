//! Stellar SDK-specific linting rules
//!
//! Rules that check for proper usage of Stellar SDK components

use super::SorobanLintRule;
use crate::{RuleViolation, ViolationSeverity};

/// Rule to ensure proper Stellar SDK usage
pub struct SdkUsageRule;

impl SorobanLintRule for SdkUsageRule {
    fn id(&self) -> &'static str {
        "stellar-sdk-usage"
    }

    fn name(&self) -> &'static str {
        "Stellar SDK Usage"
    }

    fn description(&self) -> &'static str {
        "Ensures proper usage of Stellar SDK components and types"
    }

    fn severity(&self) -> ViolationSeverity {
        ViolationSeverity::Medium
    }

    fn check(&self, source: &str, file_path: &str) -> Option<Vec<RuleViolation>> {
        let mut violations = Vec::new();

        // Check for Address type without validation
        if source.contains("Address")
            && !source.contains("require_auth")
            && !source.contains("require_auth_for_args")
        {
            violations.push(RuleViolation {
                rule_name: self.id().to_string(),
                description: "Contract uses Address type without authorization checks".to_string(),
                suggestion: "Add require_auth() or require_auth_for_args() for Address parameters"
                    .to_string(),
                line_number: 1,
                column_number: 0,
                variable_name: file_path.to_string(),
                severity: ViolationSeverity::High,
            });
        }

        // Check for BytesN usage without length specification
        if source.contains("BytesN") && !source.contains("BytesN::<") {
            violations.push(RuleViolation {
                rule_name: self.id().to_string(),
                description: "BytesN used without explicit length specification".to_string(),
                suggestion: "Use BytesN::<N> with explicit length for type safety".to_string(),
                line_number: 1,
                column_number: 0,
                variable_name: file_path.to_string(),
                severity: ViolationSeverity::Warning,
            });
        }

        // Check for Map usage without key type specification
        if source.contains("Map<") && !source.contains("Map<") {
            // This is a simplified check
            let lines: Vec<&str> = source.lines().collect();
            for (i, line) in lines.iter().enumerate() {
                if line.contains("Map<") && !line.contains("Map<") {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: "Map used without explicit type parameters".to_string(),
                        suggestion: "Use Map<Key, Value> with explicit type parameters".to_string(),
                        line_number: i + 1,
                        column_number: 0,
                        variable_name: file_path.to_string(),
                        severity: ViolationSeverity::Warning,
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

/// Rule to ensure Address validation
pub struct AddressValidationRule;

impl SorobanLintRule for AddressValidationRule {
    fn id(&self) -> &'static str {
        "stellar-address-validation"
    }

    fn name(&self) -> &'static str {
        "Stellar Address Validation"
    }

    fn description(&self) -> &'static str {
        "Ensures proper validation of Stellar addresses in contract functions"
    }

    fn severity(&self) -> ViolationSeverity {
        ViolationSeverity::High
    }

    fn check(&self, source: &str, file_path: &str) -> Option<Vec<RuleViolation>> {
        let mut violations = Vec::new();

        let lines: Vec<&str> = source.lines().collect();

        for (i, line) in lines.iter().enumerate() {
            // Check for functions with Address parameters that might need validation
            if line.contains("Address") && (line.contains("pub fn") || line.contains("fn ")) {
                // Look ahead to see if there's validation
                let next_lines = lines
                    .iter()
                    .skip(i)
                    .take(15)
                    .copied()
                    .collect::<Vec<_>>()
                    .join("\n");

                if !next_lines.contains("require_auth")
                    && !next_lines.contains("require_auth_for_args")
                    && !next_lines.contains("try_from_xdr")
                {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description:
                            "Function with Address parameter lacks authorization validation"
                                .to_string(),
                        suggestion:
                            "Add require_auth() or require_auth_for_args() to validate caller"
                                .to_string(),
                        line_number: i + 1,
                        column_number: 0,
                        variable_name: file_path.to_string(),
                        severity: self.severity(),
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
