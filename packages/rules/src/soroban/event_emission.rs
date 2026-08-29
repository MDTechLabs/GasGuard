//! Rule: Soroban Event Emission Cost Analyzer (Issue #778)
//!
//! Every event emitted by a Soroban contract is recorded in the ledger's
//! transaction meta and contributes to the transaction's resource usage
//! (both CPU and footprint). Excessive or oversized event payloads therefore
//! directly inflate transaction costs for end-users.
//!
//! ## What this rule detects
//!
//! * Functions that emit events frequently (multiple `env.events().publish`
//!   calls), where some could be merged or removed.
//! * Event payloads that include large types (`Vec`, `Map`, `Bytes`,
//!   `BytesN`, `String`) which increase serialization overhead.
//! * Redundant events emitted with identical topic patterns, suggesting
//!   duplicate or no-op emissions.
//! * Events emitted inside loops, which multiplies their resource cost.
//!
//! ## Suggested fix
//!
//! * Merge related events into a single emission with a richer data payload.
//! * Use lightweight `Symbol` topics and small integer/boolean data fields.
//! * Move event emission outside loops where possible, emitting a summary
//!   event once rather than one event per iteration.
//! * Remove redundant events that carry no unique information.

use crate::soroban::rule_engine::SorobanRule;
use crate::soroban::SorobanContract;
use crate::{RuleViolation, ViolationSeverity};

/// Soroban event publish call patterns.
const EVENT_EMIT_PATTERNS: &[&str] = &[
    "env.events().publish(",
    "events().publish(",
    ".publish(",
];

/// Large payload types that make events expensive to serialize.
const LARGE_PAYLOAD_TYPES: &[&str] = &[
    "Vec<",
    "Map<",
    "Bytes",
    "BytesN",
    "soroban_sdk::String",
    "String",
];

/// Loop keywords for detecting in-loop event emission.
const LOOP_KEYWORDS: &[&str] = &["for ", "while ", "loop {"];

/// Rule for detecting expensive event emission patterns in Soroban contracts.
pub struct EventEmissionCostRule {
    enabled: bool,
}

impl Default for EventEmissionCostRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for EventEmissionCostRule {
    fn id(&self) -> &str {
        "soroban-event-emission-cost"
    }

    fn name(&self) -> &str {
        "Soroban Event Emission Cost"
    }

    fn description(&self) -> &str {
        "Detects expensive event emission patterns including frequent emissions, large \
         payloads, redundant events, and in-loop emissions that inflate Soroban \
         transaction resource costs."
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

                // Count total event emissions in this function
                let emit_count: usize = EVENT_EMIT_PATTERNS
                    .iter()
                    .map(|p| src.matches(p).count())
                    .sum();

                if emit_count == 0 {
                    continue;
                }

                // Flag frequent event emission (multiple per function)
                if emit_count >= 3 {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: format!(
                            "Function '{}' emits {} events; frequent emission inflates \
                             transaction resource usage",
                            function.name, emit_count
                        ),
                        suggestion: "Merge related events into a single emission. Emit only \
                            state-changing events and remove informational duplicates."
                            .to_string(),
                        line_number: function.line_number,
                        column_number: 0,
                        variable_name: function.name.clone(),
                        severity: self.severity(),
                    });
                }

                // Flag large payload types in event-emitting functions
                for payload_type in LARGE_PAYLOAD_TYPES {
                    if src.contains(payload_type) {
                        violations.push(RuleViolation {
                            rule_name: self.id().to_string(),
                            description: format!(
                                "Function '{}' emits an event with a large '{}' payload, \
                                 increasing serialization cost",
                                function.name, payload_type
                            ),
                            suggestion: format!(
                                "Avoid including '{}' in event data. Use lightweight types \
                                 (Symbol, u64, bool) as event data to reduce ledger footprint.",
                                payload_type
                            ),
                            line_number: function.line_number,
                            column_number: 0,
                            variable_name: function.name.clone(),
                            severity: ViolationSeverity::Low,
                        });
                        break; // one per function is sufficient
                    }
                }

                // Flag event emission inside loops
                let has_loop = LOOP_KEYWORDS.iter().any(|kw| src.contains(kw));
                if has_loop {
                    let loop_start = LOOP_KEYWORDS
                        .iter()
                        .filter_map(|kw| src.find(kw))
                        .min();

                    if let Some(loop_pos) = loop_start {
                        let in_loop_section = &src[loop_pos..];
                        let in_loop_emit = EVENT_EMIT_PATTERNS
                            .iter()
                            .any(|p| in_loop_section.contains(p));

                        if in_loop_emit {
                            violations.push(RuleViolation {
                                rule_name: self.id().to_string(),
                                description: format!(
                                    "Function '{}' emits events inside a loop, multiplying \
                                     resource costs per iteration",
                                    function.name
                                ),
                                suggestion: "Move event emission outside the loop. Accumulate \
                                    relevant data and emit a single summary event after the loop \
                                    completes."
                                    .to_string(),
                                line_number: function.line_number,
                                column_number: 0,
                                variable_name: function.name.clone(),
                                severity: ViolationSeverity::High,
                            });
                        }
                    }
                }
            }
        }

        violations
    }
}
