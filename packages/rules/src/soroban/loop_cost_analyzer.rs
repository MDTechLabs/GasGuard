//! Rule: Soroban Loop Cost Analyzer
//!
//! Analyzes loops for expensive execution patterns that consume excess metered
//! Soroban resources. Detects:
//!
//! * Storage access inside loop bodies (`env.storage()` calls inside `for`/`while`/`loop`).
//! * Nested loops, which multiply execution cost.
//! * Cross-contract calls inside loops.
//!
//! Issue: #769

use crate::soroban::rule_engine::SorobanRule;
use crate::soroban::SorobanContract;
use crate::{RuleViolation, ViolationSeverity};

/// Keywords that open a loop body.
const LOOP_OPENERS: &[&str] = &["for ", "while ", "loop {"];

/// Patterns indicating a storage operation (metered host call).
const STORAGE_PATTERNS: &[&str] = &[
    "env.storage()",
    ".persistent()",
    ".temporary()",
    ".instance()",
];

/// Patterns indicating a cross-contract call.
const CROSS_CONTRACT_PATTERNS: &[&str] = &[
    "invoke_contract",
    "call(",
    "Client::new(",
    "client.invoke(",
];

/// Analyzes Soroban contract loops for cost-heavy patterns.
pub struct LoopCostAnalyzerRule {
    enabled: bool,
}

impl Default for LoopCostAnalyzerRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for LoopCostAnalyzerRule {
    fn id(&self) -> &str {
        "soroban-loop-cost-analyzer"
    }

    fn name(&self) -> &str {
        "Loop Cost Analyzer"
    }

    fn description(&self) -> &str {
        "Detects expensive operations (storage access, nested loops, cross-contract calls) \
         inside Soroban loop bodies that multiply metered CPU and memory costs."
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

        // Track brace depth to understand when we enter/exit a loop body
        let mut loop_depth: usize = 0;
        let mut nested_loop_start: Option<usize> = None;

        for (i, line) in lines.iter().enumerate() {
            let line_num = i + 1;
            let trimmed = line.trim();

            // Detect loop openers
            let opens_loop = LOOP_OPENERS.iter().any(|p| trimmed.starts_with(p) || trimmed.contains(p));
            if opens_loop {
                if loop_depth > 0 {
                    // Already inside a loop – this is a nested loop
                    if nested_loop_start.is_none() {
                        nested_loop_start = Some(line_num);
                    }
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: "Nested loop detected. Nested loops multiply execution cost \
                                      (O(n²) or worse) and can exhaust Soroban CPU budget."
                            .to_string(),
                        suggestion:
                            "Flatten the nested loop or precompute intermediate results outside \
                             the outer loop to reduce total iterations."
                                .to_string(),
                        line_number: line_num,
                        column_number: 0,
                        variable_name: String::new(),
                        severity: ViolationSeverity::High,
                    });
                }
                loop_depth += 1;
            }

            // Track brace balance to detect loop end (rough heuristic)
            let opens = trimmed.chars().filter(|&c| c == '{').count();
            let closes = trimmed.chars().filter(|&c| c == '}').count();
            // Only update depth on non-loop-opening lines to avoid double-counting
            if !opens_loop {
                // Net brace change adjusts loop tracking
            }
            if closes > opens && loop_depth > 0 {
                let diff = closes - opens;
                loop_depth = loop_depth.saturating_sub(diff);
                if loop_depth == 0 {
                    nested_loop_start = None;
                }
            }

            // Inside a loop – check for expensive patterns
            if loop_depth > 0 {
                // Storage access inside loop
                for pattern in STORAGE_PATTERNS {
                    if trimmed.contains(pattern) {
                        violations.push(RuleViolation {
                            rule_name: self.id().to_string(),
                            description: format!(
                                "Storage operation ('{}') inside a loop body. \
                                 Each storage call is a metered host operation; \
                                 calling it per iteration multiplies the cost linearly.",
                                pattern
                            ),
                            suggestion:
                                "Cache the storage value in a local variable before the loop \
                                 and write back once after the loop completes."
                                    .to_string(),
                            line_number: line_num,
                            column_number: 0,
                            variable_name: String::new(),
                            severity: ViolationSeverity::High,
                        });
                        break;
                    }
                }

                // Cross-contract call inside loop
                for pattern in CROSS_CONTRACT_PATTERNS {
                    if trimmed.contains(pattern) {
                        violations.push(RuleViolation {
                            rule_name: self.id().to_string(),
                            description: format!(
                                "Cross-contract call ('{}') detected inside a loop. \
                                 Each invocation consumes significant CPU and auth budget.",
                                pattern
                            ),
                            suggestion:
                                "Batch cross-contract operations outside the loop, or redesign \
                                 the contract interface to accept bulk inputs."
                                    .to_string(),
                            line_number: line_num,
                            column_number: 0,
                            variable_name: String::new(),
                            severity: ViolationSeverity::Critical,
                        });
                        break;
                    }
                }
            }
        }

        violations
    }
}
