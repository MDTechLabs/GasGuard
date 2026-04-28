//! Test runner for Rust rules

use std::time::Instant;
use gasguard_rules::RuleViolation;
use crate::fixture::{RuleFixture, TestResult, ExpectedViolation};

/// Test runner for executing rule fixtures
pub struct RuleTestRunner {
    verbose: bool,
}

impl RuleTestRunner {
    pub fn new(verbose: bool) -> Self {
        Self { verbose }
    }
    
    /// Run a single test fixture with a rule function
    pub fn run_fixture<F>(&self, fixture: &RuleFixture, rule_fn: F) -> TestResult
    where
        F: Fn(&str) -> Vec<RuleViolation>,
    {
        let start_time = Instant::now();
        
        match std::panic::catch_unwind(|| {
            rule_fn(&fixture.input)
        }) {
            Ok(actual_violations) => {
                let (matched, missed, unexpected) = 
                    self.match_violations(&fixture.expected_violations, &actual_violations);
                
                let execution_time_ms = start_time.elapsed().as_millis();
                let passed = missed.is_empty() && unexpected.is_empty();
                
                if self.verbose {
                    self.log_result(fixture, passed, &matched, &missed, &unexpected, execution_time_ms);
                }
                
                TestResult {
                    fixture: fixture.clone(),
                    passed,
                    actual_violations,
                    matched_expected: matched,
                    missed_expected: missed,
                    unexpected_violations: unexpected,
                    execution_time_ms,
                    error: None,
                }
            }
            Err(e) => {
                let execution_time_ms = start_time.elapsed().as_millis();
                let error_msg = if let Some(s) = e.downcast_ref::<String>() {
                    s.clone()
                } else if let Some(s) = e.downcast_ref::<&str>() {
                    s.to_string()
                } else {
                    "Unknown panic".to_string()
                };
                
                TestResult {
                    fixture: fixture.clone(),
                    passed: false,
                    actual_violations: Vec::new(),
                    matched_expected: Vec::new(),
                    missed_expected: fixture.expected_violations.clone(),
                    unexpected_violations: Vec::new(),
                    execution_time_ms,
                    error: Some(error_msg),
                }
            }
        }
    }
    
    /// Run multiple fixtures
    pub fn run_fixtures<F>(&self, fixtures: &[RuleFixture], rule_fn: F) -> Vec<TestResult>
    where
        F: Fn(&str) -> Vec<RuleViolation>,
    {
        fixtures.iter()
            .map(|f| self.run_fixture(f, &rule_fn))
            .collect()
    }
    
    /// Generate test report
    pub fn generate_report(&self, results: &[TestResult]) -> String {
        let total = results.len();
        let passed = results.iter().filter(|r| r.passed).count();
        let failed = total - passed;
        
        let mut report = String::new();
        report.push_str(&"\n".repeat(1));
        report.push_str(&"=".repeat(60));
        report.push_str("\nRULE TEST REPORT\n");
        report.push_str(&"=".repeat(60));
        report.push_str("\n\n");
        
        report.push_str(&format!("Total: {} | Passed: {} | Failed: {}\n\n", total, passed, failed));
        
        for result in results {
            let status = if result.passed { "✓ PASS" } else { "✗ FAIL" };
            report.push_str(&format!(
                "{} {} ({}ms)\n",
                status,
                result.fixture.name,
                result.execution_time_ms
            ));
            
            if !result.passed {
                if !result.missed_expected.is_empty() {
                    report.push_str(&format!(
                        "  Missed {} expected violation(s)\n",
                        result.missed_expected.len()
                    ));
                }
                if !result.unexpected_violations.is_empty() {
                    report.push_str(&format!(
                        "  Found {} unexpected violation(s)\n",
                        result.unexpected_violations.len()
                    ));
                }
                if let Some(ref error) = result.error {
                    report.push_str(&format!("  Error: {}\n", error));
                }
            }
        }
        
        report.push_str(&"=".repeat(60));
        report.push('\n');
        
        report
    }
    
    /// Match expected violations with actual violations
    fn match_violations(
        &self,
        expected: &[ExpectedViolation],
        actual: &[RuleViolation],
    ) -> (Vec<ExpectedViolation>, Vec<ExpectedViolation>, Vec<RuleViolation>) {
        let mut matched = Vec::new();
        let mut missed = Vec::new();
        let mut matched_indices = std::collections::HashSet::new();
        
        for exp in expected {
            let mut found = false;
            
            for (i, act) in actual.iter().enumerate() {
                if matched_indices.contains(&i) {
                    continue;
                }
                
                if self.matches_expected(act, exp) {
                    matched.push(exp.clone());
                    matched_indices.insert(i);
                    found = true;
                    break;
                }
            }
            
            if !found {
                missed.push(exp.clone());
            }
        }
        
        let unexpected: Vec<RuleViolation> = actual.iter()
            .enumerate()
            .filter(|(i, _)| !matched_indices.contains(i))
            .map(|(_, v)| v.clone())
            .collect();
        
        (matched, missed, unexpected)
    }
    
    /// Check if an actual violation matches an expected violation
    fn matches_expected(&self, actual: &RuleViolation, expected: &ExpectedViolation) -> bool {
        if actual.rule_name != expected.rule_name {
            return false;
        }
        
        if let Some(ref pattern) = expected.message_pattern {
            if !actual.description.contains(pattern) {
                return false;
            }
        }
        
        if let Some(line) = expected.line_number {
            if (actual.line_number as isize - line as isize).abs() > 1 {
                return false;
            }
        }
        
        true
    }
    
    /// Log test result details
    fn log_result(
        &self,
        fixture: &RuleFixture,
        passed: bool,
        matched: &[ExpectedViolation],
        missed: &[ExpectedViolation],
        unexpected: &[RuleViolation],
        execution_time_ms: u128,
    ) {
        let status = if passed { "✓ PASS" } else { "✗ FAIL" };
        println!("\n{} {} ({}ms)", status, fixture.name, execution_time_ms);
        
        if !matched.is_empty() {
            println!("  ✓ Matched {} expected violation(s)", matched.len());
        }
        
        if !missed.is_empty() {
            println!("  ✗ Missed {} expected violation(s):", missed.len());
            for m in missed {
                println!("    - Rule: {}, Severity: {}", m.rule_name, m.severity);
            }
        }
        
        if !unexpected.is_empty() {
            println!("  ✗ Found {} unexpected violation(s):", unexpected.len());
            for u in unexpected {
                println!("    - Rule: {}, Line: {}", u.rule_name, u.line_number);
            }
        }
    }
}
