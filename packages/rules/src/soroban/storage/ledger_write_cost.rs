//! Rule & Analyzer: Soroban Ledger Write Cost Analyzer
//!
//! Analyzes Soroban contract ledger write operations for resource optimization opportunities.
//! Ledger write mutations are among the most expensive operations in Soroban on the Stellar network
//! because they require ledger state updates, byte serialization, and persistent rent/footprint allocation.
//!
//! ## What this analyzer/rule detects
//!
//! * **Ledger Writes**: Identifies `storage().instance().set/remove`, `storage().persistent().set/remove`,
//!   and `storage().temporary().set/remove` operations.
//! * **Repeated Writes**: Detects multiple writes to the same storage key within a single function
//!   execution, representing unnecessary or redundant state mutations.
//! * **Unnecessary Mutations & Loop Writes**: Flags state writes performed inside loops or without prior state checks.
//! * **High-Impact Write Patterns**: Identifies functions with high write volume and suggests batching or coalescing state updates.

use crate::soroban::rule_engine::SorobanRule;
use crate::soroban::{SorobanContract, SorobanFunction, SorobanImpl};
use crate::{RuleViolation, ViolationSeverity};
use std::collections::HashMap;

/// Storage write operation types in Soroban
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LedgerWriteKind {
    InstanceSet,
    InstanceRemove,
    PersistentSet,
    PersistentRemove,
    TemporarySet,
    TemporaryRemove,
    GenericSet,
    GenericRemove,
}

/// Represents an individual detected ledger write access
#[derive(Debug, Clone, PartialEq)]
pub struct LedgerWriteAccess {
    pub key: String,
    pub kind: LedgerWriteKind,
    pub line_number: usize,
    pub is_in_loop: bool,
    pub function_name: String,
}

/// Analysis report for ledger write operations
#[derive(Debug, Clone, Default)]
pub struct LedgerWriteReport {
    pub total_writes: usize,
    pub repeated_writes: HashMap<String, usize>,
    pub loop_writes: Vec<LedgerWriteAccess>,
    pub accesses: Vec<LedgerWriteAccess>,
    pub high_impact_paths: Vec<String>,
}

/// Soroban Ledger Write Cost Rule
pub struct SorobanLedgerWriteCostRule {
    enabled: bool,
}

impl Default for SorobanLedgerWriteCostRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanLedgerWriteCostRule {
    pub fn new() -> Self {
        Self::default()
    }

    /// Analyze a contract function for ledger write operations
    pub fn analyze_function(function: &SorobanFunction) -> LedgerWriteReport {
        let mut report = LedgerWriteReport::default();
        let body = &function.raw_definition;
        let lines: Vec<&str> = body.lines().collect();

        let mut in_loop = false;
        let mut loop_depth = 0;

        for (idx, line) in lines.iter().enumerate() {
            let line_trimmed = line.trim();
            let current_line_num = function.line_number + idx;

            // Track loop boundaries
            if line_trimmed.starts_with("for ") || line_trimmed.starts_with("while ") || line_trimmed.starts_with("loop ") || line_trimmed.starts_with("loop{") {
                in_loop = true;
                loop_depth += 1;
            }

            // Detect write operations
            let detected_writes = Self::extract_writes_from_line(line_trimmed, current_line_num, in_loop, &function.name);
            for write in detected_writes {
                report.total_writes += 1;
                *report.repeated_writes.entry(write.key.clone()).or_insert(0) += 1;
                if write.is_in_loop {
                    report.loop_writes.push(write.clone());
                }
                report.accesses.push(write);
            }

            // Track closing loop
            if in_loop && line_trimmed.contains('}') {
                let open_braces = line_trimmed.chars().filter(|&c| c == '{').count();
                let close_braces = line_trimmed.chars().filter(|&c| c == '}').count();
                if close_braces > open_braces {
                    loop_depth = loop_depth.saturating_sub(close_braces - open_braces);
                    if loop_depth == 0 {
                        in_loop = false;
                    }
                }
            }
        }

        if report.total_writes >= 3 {
            report.high_impact_paths.push(format!(
                "Function '{}' performs {} ledger writes - high mutation impact",
                function.name, report.total_writes
            ));
        }

        report
    }

    /// Extract ledger write accesses from a source line
    fn extract_writes_from_line(
        line: &str,
        line_num: usize,
        is_in_loop: bool,
        func_name: &str,
    ) -> Vec<LedgerWriteAccess> {
        let mut writes = Vec::new();

        let patterns = [
            ("storage().instance().set", LedgerWriteKind::InstanceSet),
            ("storage().instance().remove", LedgerWriteKind::InstanceRemove),
            ("storage().persistent().set", LedgerWriteKind::PersistentSet),
            ("storage().persistent().remove", LedgerWriteKind::PersistentRemove),
            ("storage().temporary().set", LedgerWriteKind::TemporarySet),
            ("storage().temporary().remove", LedgerWriteKind::TemporaryRemove),
            ("storage().set", LedgerWriteKind::GenericSet),
            ("storage().remove", LedgerWriteKind::GenericRemove),
            ("env.storage().instance().set", LedgerWriteKind::InstanceSet),
            ("env.storage().persistent().set", LedgerWriteKind::PersistentSet),
            ("env.storage().temporary().set", LedgerWriteKind::TemporarySet),
        ];

        for (pattern, kind) in patterns {
            let mut search_idx = 0;
            while let Some(pos) = line[search_idx..].find(pattern) {
                let full_pos = search_idx + pos;
                let key = Self::extract_key_argument(&line[full_pos + pattern.len()..]);
                writes.push(LedgerWriteAccess {
                    key: if key.is_empty() { format!("unknown_key_{}", line_num) } else { key },
                    kind: kind.clone(),
                    line_number: line_num,
                    is_in_loop,
                    function_name: func_name.to_string(),
                });
                search_idx = full_pos + pattern.len();
            }
        }

        writes
    }

    /// Helper to extract key argument from call like `(&DataKey::Balance(id), &new_val)` or `(&key, &val)`
    fn extract_key_argument(args_slice: &str) -> String {
        if !args_slice.starts_with('(') {
            return String::new();
        }
        let after_paren = &args_slice[1..];
        if let Some(comma_or_end) = after_paren.find(|c| c == ',' || c == ')') {
            let arg = after_paren[..comma_or_end].trim();
            arg.trim_start_matches('&').trim().to_string()
        } else {
            String::new()
        }
    }
}

impl SorobanRule for SorobanLedgerWriteCostRule {
    fn id(&self) -> &str {
        "soroban-ledger-write-cost"
    }

    fn name(&self) -> &str {
        "Soroban Ledger Write Cost Analyzer"
    }

    fn description(&self) -> &str {
        "Analyzes ledger write operations and mutations to detect repeated writes, loop mutations, and high-impact write patterns"
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
                let report = Self::analyze_function(function);

                // 1. Check for writes inside loops (High severity)
                for loop_write in &report.loop_writes {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: format!(
                            "Ledger write '{}' inside a loop in function '{}'. Repeated ledger writes in loops incur massive fee and ledger footprint overhead.",
                            loop_write.key, function.name
                        ),
                        suggestion: format!(
                            "Accumulate mutations in memory and perform a single batched ledger write for '{}' after the loop.",
                            loop_write.key
                        ),
                        line_number: loop_write.line_number,
                        column_number: 0,
                        variable_name: loop_write.key.clone(),
                        severity: ViolationSeverity::High,
                    });
                }

                // 2. Check for repeated writes to the same key (Medium/High severity)
                for (key, count) in &report.repeated_writes {
                    if *count > 1 {
                        violations.push(RuleViolation {
                            rule_name: self.id().to_string(),
                            description: format!(
                                "Storage key '{}' is written to {} times in function '{}'. Intermediate writes may be redundant.",
                                key, count, function.name
                            ),
                            suggestion: format!(
                                "Consolidate state mutations to '{}' and write to ledger storage only once at the end of execution.",
                                key
                            ),
                            line_number: function.line_number,
                            column_number: 0,
                            variable_name: key.clone(),
                            severity: ViolationSeverity::Medium,
                        });
                    }
                }

                // 3. Check for high write volume / impact paths
                if report.total_writes >= 3 {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: format!(
                            "Function '{}' performs {} ledger writes. High mutation volume increases transaction fee and rent costs.",
                            function.name, report.total_writes
                        ),
                        suggestion: "Combine multiple related state fields into a single struct entry or evaluate temporary vs persistent storage tiers to reduce rent costs.".to_string(),
                        line_number: function.line_number,
                        column_number: 0,
                        variable_name: function.name.clone(),
                        severity: ViolationSeverity::Medium,
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
    use crate::soroban::parser::SorobanParser;

    #[test]
    fn test_detect_repeated_ledger_writes() {
        let code = r#"
            #[contractimpl]
            impl Contract {
                pub fn update_state(env: Env, key: Symbol, val1: i128, val2: i128) {
                    env.storage().instance().set(&key, &val1);
                    // some logic
                    env.storage().instance().set(&key, &val2);
                }
            }
        "#;
        let contract = SorobanParser::parse_contract(code, "test.rs").expect("Parsed");
        let rule = SorobanLedgerWriteCostRule::new();
        let violations = rule.apply(&contract);

        assert!(violations.iter().any(|v| v.description.contains("written to 2 times")));
    }

    #[test]
    fn test_detect_loop_ledger_writes() {
        let code = r#"
            #[contractimpl]
            impl Contract {
                pub fn batch_set(env: Env, items: Vec<(Address, i128)>) {
                    for item in items.iter() {
                        env.storage().persistent().set(&item.0, &item.1);
                    }
                }
            }
        "#;
        let contract = SorobanParser::parse_contract(code, "test.rs").expect("Parsed");
        let rule = SorobanLedgerWriteCostRule::new();
        let violations = rule.apply(&contract);

        assert!(violations.iter().any(|v| v.severity == ViolationSeverity::High && v.description.contains("inside a loop")));
    }
}
