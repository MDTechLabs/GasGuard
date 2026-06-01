//! Gas optimization rules for Soroban contracts
//!
//! Rules that identify gas optimization opportunities specific to Soroban

use crate::{RuleViolation, ViolationSeverity};
use super::SorobanLintRule;

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
                let func_lines = lines.iter().skip(i.saturating_sub(20)).take(40).collect::<Vec<_>>().join("\n");
                
                let get_count = func_lines.matches(".get(").count();
                if get_count > 2 {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: format!("Function performs {} storage reads - consider caching", get_count),
                        suggestion: "Cache storage values in local variables to reduce read operations".to_string(),
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
                    let next_line = if i + 1 < lines.len() { lines[i + 1] } else { "" };
                    
                    if !next_line.contains(",") && !line.contains(",") {
                        violations.push(RuleViolation {
                            rule_name: self.id().to_string(),
                            description: "Event emission without topics may reduce filtering capabilities".to_string(),
                            suggestion: "Include topics in event emission for better indexing and filtering".to_string(),
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
                if line.contains("pub fn") && (line.contains("transfer") || line.contains("mint") || line.contains("burn")) {
                    let func_lines = lines.iter().skip(i).take(20).collect::<Vec<_>>().join("\n");
                    
                    if !func_lines.contains("events().publish(") {
                        violations.push(RuleViolation {
                            rule_name: self.id().to_string(),
                            description: "State-changing function lacks event emission".to_string(),
                            suggestion: "Emit events for state changes to improve transparency and indexing".to_string(),
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
