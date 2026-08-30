//! Rule & Analyzer: Soroban Ledger Read Cost Analyzer
//!
//! Analyzes Soroban contract operations that require ledger state access.
//! Excessive ledger reads increase resource consumption (CPU instructions and ledger read bytes)
//! and reduce contract efficiency on the Stellar network.
//!
//! ## What this analyzer/rule detects
//!
//! * **Ledger Reads**: Identifies `storage().instance().get/has`, `storage().persistent().get/has`,
//!   and `storage().temporary().get/has` operations.
//! * **Repeated Reads**: Detects multiple reads to the exact same storage key within a single function
//!   without caching into a local `let` binding.
//! * **Read-Heavy Execution Paths**: Detects storage read operations nested inside `for`, `while`,
//!   or `loop` blocks, or execution paths with high read density.
//! * **Optimization Suggestions**: Provides actionable recommendations including local variable caching,
//!   read hoisting, and read batching.

use crate::soroban::rule_engine::SorobanRule;
use crate::soroban::{SorobanContract, SorobanFunction, SorobanImpl};
use crate::{RuleViolation, ViolationSeverity};
use std::collections::HashMap;

/// Storage read operation types in Soroban
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LedgerReadKind {
    InstanceGet,
    InstanceHas,
    PersistentGet,
    PersistentHas,
    TemporaryGet,
    TemporaryHas,
    GenericGet,
    GenericHas,
}

/// Represents an individual detected ledger read access
#[derive(Debug, Clone, PartialEq)]
pub struct LedgerReadAccess {
    pub key: String,
    pub kind: LedgerReadKind,
    pub line_number: usize,
    pub is_in_loop: bool,
    pub function_name: String,
}

/// Analysis report for ledger read operations
#[derive(Debug, Clone, Default)]
pub struct LedgerReadReport {
    pub total_reads: usize,
    pub repeated_reads: HashMap<String, usize>,
    pub loop_reads: Vec<LedgerReadAccess>,
    pub accesses: Vec<LedgerReadAccess>,
    pub read_heavy_paths: Vec<String>,
}

/// Soroban Ledger Read Cost Rule
pub struct SorobanLedgerReadCostRule {
    enabled: bool,
}

impl Default for SorobanLedgerReadCostRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanLedgerReadCostRule {
    pub fn new() -> Self {
        Self::default()
    }

    /// Analyze a contract function for ledger read operations
    pub fn analyze_function(function: &SorobanFunction) -> LedgerReadReport {
        let mut report = LedgerReadReport::default();
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

            // Detect read operations
            let detected_reads = Self::extract_reads_from_line(line_trimmed, current_line_num, in_loop, &function.name);
            for read in detected_reads {
                report.total_reads += 1;
                *report.repeated_reads.entry(read.key.clone()).or_insert(0) += 1;
                if read.is_in_loop {
                    report.loop_reads.push(read.clone());
                }
                report.accesses.push(read);
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

        if report.total_reads >= 4 {
            report.read_heavy_paths.push(format!(
                "Function '{}' has high ledger read density ({} total reads)",
                function.name, report.total_reads
            ));
        }

        report
    }

    /// Extract ledger read accesses from a source line
    fn extract_reads_from_line(
        line: &str,
        line_num: usize,
        is_in_loop: bool,
        func_name: &str,
    ) -> Vec<LedgerReadAccess> {
        let mut reads = Vec::new();

        let patterns = [
            ("storage().instance().get", LedgerReadKind::InstanceGet),
            ("storage().instance().has", LedgerReadKind::InstanceHas),
            ("storage().persistent().get", LedgerReadKind::PersistentGet),
            ("storage().persistent().has", LedgerReadKind::PersistentHas),
            ("storage().temporary().get", LedgerReadKind::TemporaryGet),
            ("storage().temporary().has", LedgerReadKind::TemporaryHas),
            ("storage().get", LedgerReadKind::GenericGet),
            ("storage().has", LedgerReadKind::GenericHas),
            ("env.storage().instance().get", LedgerReadKind::InstanceGet),
            ("env.storage().persistent().get", LedgerReadKind::PersistentGet),
            ("env.storage().temporary().get", LedgerReadKind::TemporaryGet),
        ];

        for (pattern, kind) in patterns {
            let mut search_idx = 0;
            while let Some(pos) = line[search_idx..].find(pattern) {
                let full_pos = search_idx + pos;
                let key = Self::extract_key_argument(&line[full_pos + pattern.len()..]);
                reads.push(LedgerReadAccess {
                    key: if key.is_empty() { format!("unknown_key_{}", line_num) } else { key },
                    kind: kind.clone(),
                    line_number: line_num,
                    is_in_loop,
                    function_name: func_name.to_string(),
                });
                search_idx = full_pos + pattern.len();
            }
        }

        reads
    }

    /// Helper to extract key argument from call like `(&DataKey::Balance(id))` or `(&key)`
    fn extract_key_argument(args_slice: &str) -> String {
        if !args_slice.starts_with('(') {
            return String::new();
        }
        let after_paren = &args_slice[1..];
        if let Some(end_paren) = after_paren.find(')') {
            let arg = after_paren[..end_paren].trim();
            arg.trim_start_matches('&').trim().to_string()
        } else {
            String::new()
        }
    }
}

impl SorobanRule for SorobanLedgerReadCostRule {
    fn id(&self) -> &str {
        "soroban-ledger-read-cost"
    }

    fn name(&self) -> &str {
        "Soroban Ledger Read Cost Analyzer"
    }

    fn description(&self) -> &str {
        "Analyzes contract operations for ledger state access, repeated reads, and read-heavy loop paths to optimize Soroban resource consumption"
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

                // 1. Check for reads inside loops (High severity)
                for loop_read in &report.loop_reads {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: format!(
                            "Ledger read '{}' inside a loop in function '{}'. Repeated ledger reads in loops exponentially multiply gas and ledger footprint costs.",
                            loop_read.key, function.name
                        ),
                        suggestion: format!(
                            "Hoist ledger read for '{}' outside the loop into a local variable, or batch access before entering the loop.",
                            loop_read.key
                        ),
                        line_number: loop_read.line_number,
                        column_number: 0,
                        variable_name: loop_read.key.clone(),
                        severity: ViolationSeverity::High,
                    });
                }

                // 2. Check for repeated reads of identical key (Medium severity)
                for (key, count) in &report.repeated_reads {
                    if *count > 1 {
                        violations.push(RuleViolation {
                            rule_name: self.id().to_string(),
                            description: format!(
                                "Storage key '{}' is read {} times in function '{}' without caching.",
                                key, count, function.name
                            ),
                            suggestion: format!(
                                "Cache the value of '{}' in a local `let` binding to eliminate redundant ledger read costs.",
                                key
                            ),
                            line_number: function.line_number,
                            column_number: 0,
                            variable_name: key.clone(),
                            severity: ViolationSeverity::Medium,
                        });
                    }
                }

                // 3. Check for read-heavy execution paths
                if report.total_reads >= 4 {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: format!(
                            "Function '{}' performs {} ledger reads across its execution path.",
                            function.name, report.total_reads
                        ),
                        suggestion: "Consider restructuring data into a combined struct or batching storage queries to minimize ledger entry lookups.".to_string(),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::soroban::parser::SorobanParser;

    #[test]
    fn test_detect_repeated_ledger_reads() {
        let code = r#"
            #[contractimpl]
            impl Contract {
                pub fn check_balance(env: Env, user: Address) -> i128 {
                    let a = env.storage().instance().get(&user).unwrap_or(0);
                    let b = env.storage().instance().get(&user).unwrap_or(0);
                    a + b
                }
            }
        "#;
        let contract = SorobanParser::parse_contract(code, "test.rs").expect("Parsed");
        let rule = SorobanLedgerReadCostRule::new();
        let violations = rule.apply(&contract);

        assert!(violations.iter().any(|v| v.description.contains("is read 2 times")));
    }

    #[test]
    fn test_detect_loop_ledger_reads() {
        let code = r#"
            #[contractimpl]
            impl Contract {
                pub fn sum_balances(env: Env, users: Vec<Address>) -> i128 {
                    let mut total = 0;
                    for user in users.iter() {
                        let bal = env.storage().persistent().get(&user).unwrap_or(0);
                        total += bal;
                    }
                    total
                }
            }
        "#;
        let contract = SorobanParser::parse_contract(code, "test.rs").expect("Parsed");
        let rule = SorobanLedgerReadCostRule::new();
        let violations = rule.apply(&contract);

        assert!(violations.iter().any(|v| v.severity == ViolationSeverity::High && v.description.contains("inside a loop")));
    }
}
