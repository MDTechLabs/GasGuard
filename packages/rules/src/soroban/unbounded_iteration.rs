//! Rule: Detect Unbounded Soroban Iteration
//!
//! Loops whose iteration count cannot be statically bounded (e.g., iterating
//! over a collection whose size is controlled by user input or contract state)
//! can exhaust Soroban CPU/memory limits and cause transaction failure.
//!
//! This rule detects:
//!
//! * `for` loops over a range derived from a function parameter or storage value.
//! * `while` loops without an obvious constant upper bound.
//! * `loop` blocks with no early-exit guard on a bounded counter.
//!
//! Issue: #770

use crate::soroban::rule_engine::SorobanRule;
use crate::soroban::SorobanContract;
use crate::{RuleViolation, ViolationSeverity};

/// Patterns that suggest the loop bound comes from external / dynamic input.
const DYNAMIC_BOUND_PATTERNS: &[&str] = &[
    "env.storage()",
    ".len()",
    ".count()",
    "params.",
    "args.",
    "input.",
    "request.",
];

/// Patterns for `while` loops that lack a fixed upper bound.
const UNBOUNDED_WHILE_PATTERNS: &[&str] = &["while true", "while !done", "while running"];

/// Detects loops that cannot be statically bounded.
pub struct UnboundedIterationRule {
    enabled: bool,
}

impl Default for UnboundedIterationRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for UnboundedIterationRule {
    fn id(&self) -> &str {
        "soroban-unbounded-iteration"
    }

    fn name(&self) -> &str {
        "Unbounded Soroban Iteration"
    }

    fn description(&self) -> &str {
        "Detects loops whose iteration count is not statically bounded. \
         Unbounded iteration can exhaust Soroban CPU/memory limits and \
         cause transaction failure or denial-of-service."
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
        let lines: Vec<&str> = contract.source.lines().collect();

        for (i, line) in lines.iter().enumerate() {
            let line_num = i + 1;
            let trimmed = line.trim();

            // --- `for` loop with a dynamic upper bound ---
            if trimmed.starts_with("for ") || trimmed.contains(" for ") {
                let has_dynamic_bound = DYNAMIC_BOUND_PATTERNS
                    .iter()
                    .any(|p| trimmed.contains(p));

                if has_dynamic_bound {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description:
                            "For-loop iterates over a dynamically-sized collection or range. \
                             The number of iterations is not statically bounded, which can \
                             exhaust Soroban metered CPU budget."
                                .to_string(),
                        suggestion:
                            "Add an explicit upper-bound cap (e.g., `let safe_len = \
                             coll.len().min(MAX_ITEMS);`) and assert inputs do not exceed \
                             a safe limit before entering the loop."
                                .to_string(),
                        line_number: line_num,
                        column_number: 0,
                        variable_name: String::new(),
                        severity: ViolationSeverity::High,
                    });
                }
            }

            // --- Infinite / unbounded `while` loops ---
            for pattern in UNBOUNDED_WHILE_PATTERNS {
                if trimmed.contains(pattern) {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: format!(
                            "Potentially unbounded while-loop ('{}') detected. \
                             Without a guaranteed termination condition this loop \
                             may run until resources are exhausted.",
                            pattern
                        ),
                        suggestion:
                            "Replace the unbounded while with a for-loop over a capped range, \
                             or add a hard iteration counter that breaks after a safe maximum."
                                .to_string(),
                        line_number: line_num,
                        column_number: 0,
                        variable_name: String::new(),
                        severity: ViolationSeverity::High,
                    });
                    break;
                }
            }

            // --- Bare `loop {}` without an obvious bounded counter ---
            if trimmed == "loop {" || trimmed == "loop{" {
                // Look ahead a few lines for a break condition referencing a counter
                let lookahead = lines
                    .get(i + 1..i.saturating_add(10).min(lines.len()))
                    .unwrap_or(&[]);
                let has_bounded_break = lookahead.iter().any(|l| {
                    let t = l.trim();
                    t.contains("break") && (t.contains(">=") || t.contains("==") || t.contains('>'))
                });

                if !has_bounded_break {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description:
                            "Bare `loop {}` block without an obvious bounded break condition. \
                             If the exit condition depends on external state this loop \
                             may consume all available Soroban CPU budget."
                                .to_string(),
                        suggestion:
                            "Add a counter variable that increments each iteration and breaks \
                             when it exceeds a compile-time constant (e.g., `const MAX: u32 = 100`)."
                                .to_string(),
                        line_number: line_num,
                        column_number: 0,
                        variable_name: String::new(),
                        severity: ViolationSeverity::Medium,
                    });
                }
            }
        }

        violations
    }
}
