//! Rule: Detect Inefficient Soroban Error Construction (Issue #777)
//!
//! Complex or repeated error construction in Soroban contracts adds avoidable
//! execution and serialization overhead. On error paths, allocating strings,
//! formatting messages, or constructing compound error types wastes metered
//! CPU and memory budget — especially because the error path is exercised on
//! every failing invocation.
//!
//! ## What this rule detects
//!
//! * Repeated construction of the same error type within a single function
//!   (suggests the error value could be cached or inlined as a constant).
//! * Use of `format!()` or string allocation on error paths, which triggers
//!   expensive host-string operations.
//! * Allocations (e.g. `Vec::new`, `String::new`) that only appear on error
//!   branches — avoidable by using simple enum variants instead.
//!
//! ## Suggested fix
//!
//! * Use simple Soroban `contracterror` enum variants with numeric codes
//!   rather than string payloads.
//! * Avoid `format!()` in error returns; prefer pre-defined error constants.
//! * Deduplicate repeated `Err(SomeError::Variant)` constructions by
//!   extracting a helper or returning early once.

use crate::soroban::rule_engine::SorobanRule;
use crate::soroban::SorobanContract;
use crate::{RuleViolation, ViolationSeverity};

/// Patterns that indicate expensive error payload construction.
const EXPENSIVE_ERROR_PATTERNS: &[&str] = &[
    "format!(",
    "String::from(",
    "String::new(",
    ".to_string()",
    "Vec::new(",
    "vec![",
];

/// Patterns that indicate an error is being returned.
const ERROR_RETURN_PATTERNS: &[&str] = &[
    "return Err(",
    "Err(",
    "panic!(",
    ".unwrap_or_else(",
    ".map_err(",
];

/// Rule for detecting inefficient error construction in Soroban contracts.
pub struct InefficientErrorConstructionRule {
    enabled: bool,
}

impl Default for InefficientErrorConstructionRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for InefficientErrorConstructionRule {
    fn id(&self) -> &str {
        "soroban-inefficient-error-construction"
    }

    fn name(&self) -> &str {
        "Inefficient Soroban Error Construction"
    }

    fn description(&self) -> &str {
        "Detects costly error construction patterns — string formatting, heap allocations, \
         or repeated identical error instantiations — that increase execution overhead \
         on Soroban error paths."
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

                let has_error_return = ERROR_RETURN_PATTERNS.iter().any(|p| src.contains(p));
                if !has_error_return {
                    continue;
                }

                // Detect expensive allocations on error paths
                for pattern in EXPENSIVE_ERROR_PATTERNS {
                    if src.contains(pattern) {
                        violations.push(RuleViolation {
                            rule_name: self.id().to_string(),
                            description: format!(
                                "Function '{}' uses '{}' on an error path, adding unnecessary \
                                 allocation overhead",
                                function.name, pattern
                            ),
                            suggestion: "Replace string/allocation-based error payloads with \
                                simple #[contracterror] enum variants that carry only integer \
                                codes. This eliminates heap allocations on the error path."
                                .to_string(),
                            line_number: function.line_number,
                            column_number: 0,
                            variable_name: function.name.clone(),
                            severity: self.severity(),
                        });
                        break; // one violation per function is enough
                    }
                }

                // Detect repeated error construction (same Err( pattern appears multiple times)
                let err_count = src.matches("Err(").count();
                if err_count >= 3 {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: format!(
                            "Function '{}' constructs errors {} times; consider consolidating \
                             repeated error returns",
                            function.name, err_count
                        ),
                        suggestion: "Extract repeated error-return logic into a single early-exit \
                            or use the `?` operator to propagate errors without re-constructing \
                            them at every site."
                            .to_string(),
                        line_number: function.line_number,
                        column_number: 0,
                        variable_name: function.name.clone(),
                        severity: ViolationSeverity::Low,
                    });
                }
            }
        }

        violations
    }
}
