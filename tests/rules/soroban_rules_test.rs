//! Example: Testing Soroban Rules with GasGuard Testing Framework
//!
//! This demonstrates how to use the Rust testing framework for Soroban rules

use gasguard_testing::{RuleFixture, TestSuite, RuleTestRunner, RuleAssertions};
use gasguard_rules::soroban::{SorobanRuleEngine, UnusedStateVariablesRule};

#[test]
fn test_unused_state_variables_with_fixture() {
    // Load fixture from JSON
    let fixture = RuleFixture::from_file("tests/rules/fixtures/soroban-unused-variable.json")
        .expect("Failed to load fixture");
    
    // Create rule engine
    let engine = SorobanRuleEngine::new();
    
    // Create test runner
    let runner = RuleTestRunner::new(true);
    
    // Run the test
    let result = runner.run_fixture(&fixture, |source| {
        let mut engine = SorobanRuleEngine::new();
        engine.add_rule(UnusedStateVariablesRule::default());
        
        match engine.analyze(source, "test.rs") {
            Ok(violations) => violations,
            Err(_) => Vec::new(),
        }
    });
    
    assert!(result.passed, "Test should pass: {:?}", result.error);
}

#[test]
fn test_assertion_helpers() {
    use gasguard_rules::{RuleViolation, ViolationSeverity};
    
    let violations = vec![
        RuleViolation {
            rule_name: "test-rule".to_string(),
            description: "Test violation".to_string(),
            severity: ViolationSeverity::Warning,
            line_number: 10,
            column_number: 0,
            variable_name: "test_var".to_string(),
            suggestion: "Fix it".to_string(),
        }
    ];
    
    // Test assertions
    assert!(RuleAssertions::assert_has_violation(&violations, "test-rule").is_ok());
    assert!(RuleAssertions::assert_has_violation(&violations, "other-rule").is_err());
    assert!(RuleAssertions::assert_violation_count(&violations, 1).is_ok());
    assert!(RuleAssertions::assert_violation_at_line(&violations, "test-rule", 10, 0).is_ok());
}

#[test]
fn test_fixture_serialization() {
    let fixture = RuleFixture {
        id: "test-1".to_string(),
        name: "Test Fixture".to_string(),
        description: "A test fixture".to_string(),
        input: "fn main() {}".to_string(),
        expected_violations: vec![],
        metadata: None,
    };
    
    // Save to file
    fixture.to_file("/tmp/test-fixture.json")
        .expect("Failed to save fixture");
    
    // Load from file
    let loaded = RuleFixture::from_file("/tmp/test-fixture.json")
        .expect("Failed to load fixture");
    
    assert_eq!(loaded.id, fixture.id);
    assert_eq!(loaded.name, fixture.name);
}

#[test]
fn test_batch_fixtures() {
    // Load all fixtures from directory
    let fixtures_dir = "tests/rules/fixtures";
    
    if std::path::Path::new(fixtures_dir).exists() {
        let entries = std::fs::read_dir(fixtures_dir)
            .expect("Failed to read fixtures directory");
        
        let mut fixture_count = 0;
        
        for entry in entries {
            let entry = entry.expect("Failed to read entry");
            let path = entry.path();
            
            if path.extension().and_then(|s| s.to_str()) == Some("json") {
                match RuleFixture::from_file(path.to_str().unwrap()) {
                    Ok(fixture) => {
                        println!("Loaded fixture: {} - {}", fixture.id, fixture.name);
                        fixture_count += 1;
                    }
                    Err(e) => {
                        eprintln!("Failed to load fixture: {:?}", e);
                    }
                }
            }
        }
        
        assert!(fixture_count > 0, "Should load at least one fixture");
    }
}

#[test]
fn test_runner_report_generation() {
    use gasguard_rules::{RuleViolation, ViolationSeverity};
    
    let fixture = RuleFixture {
        id: "test-report".to_string(),
        name: "Report Test".to_string(),
        description: "Test report generation".to_string(),
        input: "fn main() {}".to_string(),
        expected_violations: vec![],
        metadata: None,
    };
    
    let runner = RuleTestRunner::new(false);
    
    // Run fixture
    let result = runner.run_fixture(&fixture, |_source| {
        vec![
            RuleViolation {
                rule_name: "test-rule".to_string(),
                description: "Test violation".to_string(),
                severity: ViolationSeverity::Warning,
                line_number: 1,
                column_number: 0,
                variable_name: "var".to_string(),
                suggestion: "Fix it".to_string(),
            }
        ]
    });
    
    // Generate report
    let report = runner.generate_report(&[result]);
    
    assert!(report.contains("RULE TEST REPORT"));
    assert!(report.contains("Total:"));
}
