//! Gas optimization rules for Soroban contracts
//!
//! Rules that identify gas optimization opportunities specific to Soroban

use super::SorobanLintRule;
use crate::{RuleViolation, ViolationSeverity};

/// Rule to check for inefficient storage read patterns
pub struct StorageReadRule;

impl SorobanLintRule for StorageReadRule {
    fn id(&self) -> &'static str {
        "soroban-storage-read"
    }

    fn name(&self) -> &'static str {
        "Soroban Storage Read Optimization"
    }

    fn description(&self) -> &'static str {
        "Identifies inefficient storage read patterns that can be optimized"
    }

    fn severity(&self) -> ViolationSeverity {
        ViolationSeverity::Medium
    }

    fn check(&self, source: &str, file_path: &str) -> Option<Vec<RuleViolation>> {
        let mut violations = Vec::new();

        let lines: Vec<&str> = source.lines().collect();

        for (i, line) in lines.iter().enumerate() {
            // Check for multiple .get() calls on same storage
            if line.contains(".get(") {
                // Look for repeated patterns
                let func_lines = lines
                    .iter()
                    .skip(i.saturating_sub(20))
                    .take(40)
                    .copied()
                    .collect::<Vec<_>>()
                    .join("\n");

                let get_count = func_lines.matches(".get(").count();
                if get_count > 2 {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: format!(
                            "Function performs {} storage reads - consider caching",
                            get_count
                        ),
                        suggestion:
                            "Cache storage values in local variables to reduce read operations"
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

/// Rule to detect gas-heavy Soroban Map iteration
pub struct MapIterationRule;

impl SorobanLintRule for MapIterationRule {
    fn id(&self) -> &'static str {
        "soroban-map-iteration"
    }

    fn name(&self) -> &'static str {
        "Soroban Map Iteration"
    }

    fn description(&self) -> &'static str {
        "Detects heavy iteration over Soroban Map collections that can be expensive for large datasets"
    }

    fn severity(&self) -> ViolationSeverity {
        ViolationSeverity::High
    }

    fn check(&self, source: &str, file_path: &str) -> Option<Vec<RuleViolation>> {
        let mut violations = Vec::new();
        let lines: Vec<&str> = source.lines().collect();

        for (i, line) in lines.iter().enumerate() {
            if (line.contains("for ") || line.contains("while "))
                && (line.contains(".iter()")
                    || line.contains(".keys(")
                    || line.contains(".values(")
                    || line.contains(".entries(")
                    || line.contains(".range("))
            {
                let window = lines
                    .iter()
                    .skip(i.saturating_sub(8))
                    .take(20)
                    .copied()
                    .collect::<Vec<_>>()
                    .join("\n");
                if window.contains("Map<") || window.contains("Map::") || window.contains(": Map") {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: "Detected potentially expensive iteration over a Soroban Map".to_string(),
                        suggestion: "Use pagination or chunked iteration rather than iterating over the entire Map in one call".to_string(),
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

/// Rule to check for efficient event emission patterns
pub struct EventEmissionRule;

impl SorobanLintRule for EventEmissionRule {
    fn id(&self) -> &'static str {
        "soroban-event-emission"
    }

    fn name(&self) -> &'static str {
        "Soroban Event Emission"
    }

    fn description(&self) -> &'static str {
        "Checks for efficient event emission patterns in Soroban contracts"
    }

    fn severity(&self) -> ViolationSeverity {
        ViolationSeverity::Info
    }

    fn check(&self, source: &str, file_path: &str) -> Option<Vec<RuleViolation>> {
        let mut violations = Vec::new();

        // Check for events without topics
        if source.contains("env.events().publish(") {
            let lines: Vec<&str> = source.lines().collect();

            for (i, line) in lines.iter().enumerate() {
                if line.contains("env.events().publish(") {
                    // Check if topics are being used
                    let next_line = if i + 1 < lines.len() {
                        lines[i + 1]
                    } else {
                        ""
                    };

                    if !next_line.contains(",") && !line.contains(",") {
                        violations.push(RuleViolation {
                            rule_name: self.id().to_string(),
                            description:
                                "Event emission without topics may reduce filtering capabilities"
                                    .to_string(),
                            suggestion:
                                "Include topics in event emission for better indexing and filtering"
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

        // Check for missing events in state-changing functions
        if source.contains("pub fn") && (source.contains(".set(") || source.contains(".put(")) {
            let lines: Vec<&str> = source.lines().collect();

            for (i, line) in lines.iter().enumerate() {
                if line.contains("pub fn")
                    && (line.contains("transfer") || line.contains("mint") || line.contains("burn"))
                {
                    let func_lines = lines
                        .iter()
                        .skip(i)
                        .take(20)
                        .copied()
                        .collect::<Vec<_>>()
                        .join("\n");

                    if !func_lines.contains("events().publish(") {
                        violations.push(RuleViolation {
                            rule_name: self.id().to_string(),
                            description: "State-changing function lacks event emission".to_string(),
                            suggestion:
                                "Emit events for state changes to improve transparency and indexing"
                                    .to_string(),
                            line_number: i + 1,
                            column_number: 0,
                            variable_name: file_path.to_string(),
                            severity: ViolationSeverity::Info,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_map_iteration_rule_detects_map_loop() {
        let source = r#"
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Map};

#[contractimpl]
impl MyContract {
    pub fn scan_map(&self, env: Env, data: Map<Address, u64>) {
        for (key, value) in data.iter() {
            let _ = key;
            let _ = value;
        }
    }
}
"#;

        let violations = MapIterationRule.check(source, "test.rs");
        assert!(violations.is_some());
        let violations = violations.unwrap();
        assert!(violations
            .iter()
            .any(|v| v.rule_name == "soroban-map-iteration"));
    }

    #[test]
    fn test_map_iteration_rule_ignores_non_map_loops() {
        let source = r#"
use soroban_sdk::{contract, contractimpl, contracttype, Address};

#[contractimpl]
impl MyContract {
    pub fn count(&self) {
        for i in 0..10 {
            let _ = i;
        }
    }
}
"#;

        let violations = MapIterationRule.check(source, "test.rs");
        assert!(violations.is_none());
    }
}
