//! Test fixture definitions for Rust rules

use serde::{Deserialize, Serialize};
use gasguard_rules::RuleViolation;

/// A single test fixture for a rule
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuleFixture {
    /// Unique identifier for this fixture
    pub id: String,
    
    /// Human-readable name
    pub name: String,
    
    /// Description of what this test validates
    pub description: String,
    
    /// Input source code to analyze
    pub input: String,
    
    /// Expected violations (can be empty for negative tests)
    pub expected_violations: Vec<ExpectedViolation>,
    
    /// Optional metadata
    pub metadata: Option<serde_json::Value>,
}

/// Expected violation in a test fixture
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExpectedViolation {
    /// Rule name that should trigger
    pub rule_name: String,
    
    /// Expected severity level
    pub severity: String,
    
    /// Expected message pattern (can be partial match)
    pub message_pattern: Option<String>,
    
    /// Expected line number (if applicable)
    pub line_number: Option<usize>,
}

/// Test suite containing multiple fixtures
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestSuite {
    /// Rule name being tested
    pub rule_name: String,
    
    /// Suite name
    pub name: String,
    
    /// Description
    pub description: String,
    
    /// Test fixtures
    pub fixtures: Vec<RuleFixture>,
}

/// Test case result after running a fixture
#[derive(Debug)]
pub struct TestResult {
    /// Fixture that was tested
    pub fixture: RuleFixture,
    
    /// Whether the test passed
    pub passed: bool,
    
    /// Actual violations from the rule
    pub actual_violations: Vec<RuleViolation>,
    
    /// Matched expected violations
    pub matched_expected: Vec<ExpectedViolation>,
    
    /// Unmatched expected violations (false negatives)
    pub missed_expected: Vec<ExpectedViolation>,
    
    /// Unexpected violations (false positives)
    pub unexpected_violations: Vec<RuleViolation>,
    
    /// Test execution time in ms
    pub execution_time_ms: u128,
    
    /// Error message if test failed
    pub error: Option<String>,
}

impl RuleFixture {
    /// Load fixture from JSON file
    pub fn from_file(path: &str) -> Result<Self, String> {
        let content = std::fs::read_to_string(path)
            .map_err(|e| format!("Failed to read file {}: {}", path, e))?;
        
        let fixture: RuleFixture = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse JSON: {}", e))?;
        
        Ok(fixture)
    }
    
    /// Save fixture to JSON file
    pub fn to_file(&self, path: &str) -> Result<(), String> {
        let content = serde_json::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize: {}", e))?;
        
        std::fs::write(path, content)
            .map_err(|e| format!("Failed to write file: {}", e))?;
        
        Ok(())
    }
}

impl TestSuite {
    /// Load test suite from JSON file
    pub fn from_file(path: &str) -> Result<Self, String> {
        let content = std::fs::read_to_string(path)
            .map_err(|e| format!("Failed to read file {}: {}", path, e))?;
        
        let suite: TestSuite = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse JSON: {}", e))?;
        
        Ok(suite)
    }
    
    /// Save test suite to JSON file
    pub fn to_file(&self, path: &str) -> Result<(), String> {
        let content = serde_json::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize: {}", e))?;
        
        std::fs::write(path, content)
            .map_err(|e| format!("Failed to write file: {}", e))?;
        
        Ok(())
    }
}
