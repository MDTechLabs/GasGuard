//! Custom assertion helpers for rule testing

use gasguard_rules::{RuleViolation, ViolationSeverity};
use crate::fixture::ExpectedViolation;

/// Assertion utilities for rule testing
pub struct RuleAssertions;

impl RuleAssertions {
    /// Assert that violations contain a specific rule
    pub fn assert_has_violation(violations: &[RuleViolation], rule_name: &str) -> Result<(), String> {
        let found = violations.iter().find(|v| v.rule_name == rule_name);
        
        match found {
            Some(_) => Ok(()),
            None => {
                let available: Vec<&str> = violations.iter().map(|v| v.rule_name.as_str()).collect();
                Err(format!(
                    "Expected violation with rule_name \"{}\" but it was not found. Available: {:?}",
                    rule_name, available
                ))
            }
        }
    }
    
    /// Assert that violations do NOT contain a specific rule
    pub fn assert_not_has_violation(violations: &[RuleViolation], rule_name: &str) -> Result<(), String> {
        let found = violations.iter().find(|v| v.rule_name == rule_name);
        
        match found {
            Some(v) => Err(format!(
                "Expected NOT to find rule_name \"{}\" but it was found at line {}",
                rule_name, v.line_number
            )),
            None => Ok(()),
        }
    }
    
    /// Assert violation count
    pub fn assert_violation_count(violations: &[RuleViolation], expected_count: usize) -> Result<(), String> {
        if violations.len() == expected_count {
            Ok(())
        } else {
            Err(format!(
                "Expected {} violation(s) but got {}",
                expected_count,
                violations.len()
            ))
        }
    }
    
    /// Assert violation at specific line
    pub fn assert_violation_at_line(
        violations: &[RuleViolation],
        rule_name: &str,
        expected_line: usize,
        tolerance: usize,
    ) -> Result<(), String> {
        let violation = violations.iter().find(|v| v.rule_name == rule_name)
            .ok_or_else(|| format!("Violation with rule_name \"{}\" not found", rule_name))?;
        
        let actual_line = violation.line_number;
        let diff = if actual_line > expected_line {
            actual_line - expected_line
        } else {
            expected_line - actual_line
        };
        
        if diff > tolerance {
            Err(format!(
                "Expected rule \"{}\" at line {} (±{}) but found at line {}",
                rule_name, expected_line, tolerance, actual_line
            ))
        } else {
            Ok(())
        }
    }
    
    /// Match expected violations against actual violations
    pub fn assert_match_expected(
        actual: &[RuleViolation],
        expected: &[ExpectedViolation],
    ) -> Result<(), String> {
        let mut errors = Vec::new();
        
        for exp in expected {
            let matched = actual.iter().any(|act| {
                if act.rule_name != exp.rule_name {
                    return false;
                }
                
                if let Some(ref pattern) = exp.message_pattern {
                    if !act.description.contains(pattern) {
                        return false;
                    }
                }
                
                if let Some(line) = exp.line_number {
                    let actual_line = act.line_number;
                    let diff = if actual_line > line {
                        actual_line - line
                    } else {
                        line - actual_line
                    };
                    if diff > 1 {
                        return false;
                    }
                }
                
                true
            });
            
            if !matched {
                errors.push(format!(
                    "Missing expected violation: {} ({}){}",
                    exp.rule_name,
                    exp.severity,
                    exp.line_number.map(|l| format!(" at line ~{}", l)).unwrap_or_default()
                ));
            }
        }
        
        if errors.is_empty() {
            Ok(())
        } else {
            Err(format!("Expected violations not matched:\n{}", errors.join("\n")))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    fn create_test_violation(rule_name: &str, line: usize) -> RuleViolation {
        RuleViolation {
            rule_name: rule_name.to_string(),
            description: "Test violation".to_string(),
            severity: ViolationSeverity::Warning,
            line_number: line,
            column_number: 0,
            variable_name: "test_var".to_string(),
            suggestion: "Fix it".to_string(),
        }
    }
    
    #[test]
    fn test_assert_has_violation() {
        let violations = vec![create_test_violation("test-rule", 10)];
        assert!(RuleAssertions::assert_has_violation(&violations, "test-rule").is_ok());
        assert!(RuleAssertions::assert_has_violation(&violations, "other-rule").is_err());
    }
    
    #[test]
    fn test_assert_violation_count() {
        let violations = vec![
            create_test_violation("rule-1", 10),
            create_test_violation("rule-2", 20),
        ];
        assert!(RuleAssertions::assert_violation_count(&violations, 2).is_ok());
        assert!(RuleAssertions::assert_violation_count(&violations, 3).is_err());
    }
}
