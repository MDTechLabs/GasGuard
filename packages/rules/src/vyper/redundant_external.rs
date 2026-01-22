use crate::rule_engine::{RuleViolation, ViolationSeverity};
use crate::vyper::parser::{VyperContract, VyperFunction};
use std::collections::HashSet;

/// Rule for detecting redundant @external decorators on internal Vyper functions
///
/// This rule identifies functions that are marked as @external but should be @internal:
/// 1. Functions with _ prefix naming convention (indicates internal use)
/// 2. Functions that are only called internally via self.function()
pub struct RedundantExternalDecoratorRule;

/// Vyper-specific rule trait for analyzing Vyper contracts
pub trait VyperRule {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn check(&self, contract: &VyperContract) -> Vec<RuleViolation>;
}

impl VyperRule for RedundantExternalDecoratorRule {
    fn name(&self) -> &str {
        "vyper-redundant-external"
    }

    fn description(&self) -> &str {
        "Detects internal functions that are accidentally marked as @external, which leads to higher gas consumption and potential security gaps."
    }

    fn check(&self, contract: &VyperContract) -> Vec<RuleViolation> {
        let mut violations = Vec::new();

        // Get all functions that are called internally
        let internally_called = contract.get_internally_called_functions();

        // Get all function names that are defined with @external
        let external_functions: HashSet<String> = contract
            .functions
            .iter()
            .filter(|f| VyperContract::function_has_decorator(f, "external"))
            .map(|f| f.name.clone())
            .collect();

        for func in &contract.functions {
            // Check if function has @external decorator
            if !VyperContract::function_has_decorator(func, "external") {
                continue;
            }

            // Detection 1: Internal naming convention with @external
            if VyperContract::is_internal_naming_convention(&func.name) {
                violations.push(self.create_naming_violation(func));
            }
            // Detection 2: Function only called internally but marked @external
            else if self.is_only_called_internally(
                &func.name,
                &internally_called,
                &external_functions,
            ) {
                violations.push(self.create_internal_usage_violation(func));
            }
        }

        violations
    }
}

impl RedundantExternalDecoratorRule {
    /// Create a violation for functions with internal naming convention but @external decorator
    fn create_naming_violation(&self, func: &VyperFunction) -> RuleViolation {
        RuleViolation {
            rule_name: self.name().to_string(),
            description: format!(
                "Function '{}' is marked @external but uses internal naming convention (_prefix). \
                This may expose internal logic unnecessarily and increase gas costs.",
                func.name
            ),
            severity: ViolationSeverity::Warning,
            line_number: func.line_number,
            column_number: func.column_number,
            variable_name: func.name.clone(),
            suggestion: format!(
                "Consider changing @external to @internal for function '{}'. \
                Internal functions save gas by not generating external interface code and improve security by not exposing internal logic.",
                func.name
            ),
        }
    }

    /// Create a violation for functions only called internally but marked @external
    fn create_internal_usage_violation(&self, func: &VyperFunction) -> RuleViolation {
        RuleViolation {
            rule_name: self.name().to_string(),
            description: format!(
                "Function '{}' is marked @external but appears to only be called internally (via self.{}()). \
                This wastes gas and may expose internal logic unnecessarily.",
                func.name, func.name
            ),
            severity: ViolationSeverity::Warning,
            line_number: func.line_number,
            column_number: func.column_number,
            variable_name: func.name.clone(),
            suggestion: format!(
                "Consider changing @external to @internal for function '{}' if it's not meant to be called externally. \
                Internal functions are more gas-efficient and don't expose the function in the contract's ABI.",
                func.name
            ),
        }
    }

    /// Check if a function is only called internally and not intended for external use
    fn is_only_called_internally(
        &self,
        func_name: &str,
        internally_called: &HashSet<String>,
        _external_functions: &HashSet<String>,
    ) -> bool {
        // Function must be called internally at least once
        if !internally_called.contains(func_name) {
            return false;
        }

        // Skip common entry points that are legitimately external
        let common_external = ["__init__", "__default__", "initialize", "setup"];
        if common_external.contains(&func_name) {
            return false;
        }

        // If a function is called internally AND marked external, it might be redundant
        // This is a heuristic - the function might still need external access
        // We only flag it if it looks like a helper function
        self.looks_like_helper_function(func_name)
    }

    /// Heuristic to determine if a function looks like a helper/utility function
    fn looks_like_helper_function(&self, func_name: &str) -> bool {
        let helper_patterns = [
            "helper",
            "util",
            "compute",
            "calculate",
            "validate",
            "check",
            "get_",
            "set_",
            "update_",
            "process_",
            "handle_",
        ];

        let lower_name = func_name.to_lowercase();
        helper_patterns
            .iter()
            .any(|pattern| lower_name.contains(pattern))
    }
}

/// Vyper rule engine for running Vyper-specific rules
pub struct VyperRuleEngine {
    rules: Vec<Box<dyn VyperRule>>,
}

impl VyperRuleEngine {
    pub fn new() -> Self {
        Self { rules: Vec::new() }
    }

    pub fn with_default_rules() -> Self {
        let mut engine = Self::new();
        engine.add_rule(Box::new(RedundantExternalDecoratorRule));
        engine
    }

    pub fn add_rule(&mut self, rule: Box<dyn VyperRule>) {
        self.rules.push(rule);
    }

    pub fn analyze(&self, source: &str) -> Result<Vec<RuleViolation>, String> {
        let contract = VyperContract::parse(source)?;

        let mut violations = Vec::new();
        for rule in &self.rules {
            violations.extend(rule.check(&contract));
        }

        Ok(violations)
    }
}

impl Default for VyperRuleEngine {
    fn default() -> Self {
        Self::with_default_rules()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_external_on_internal_naming() {
        let source = r#"
# @version ^0.3.0

@external
def _internal_helper() -> uint256:
    return 42

@external
def public_function() -> uint256:
    return self._internal_helper()
"#;
        let engine = VyperRuleEngine::with_default_rules();
        let violations = engine.analyze(source).unwrap();

        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].variable_name, "_internal_helper");
        assert!(violations[0]
            .description
            .contains("internal naming convention"));
    }

    #[test]
    fn test_no_violation_on_proper_internal() {
        let source = r#"
# @version ^0.3.0

@internal
def _helper() -> uint256:
    return 42

@external
def public_function() -> uint256:
    return self._helper()
"#;
        let engine = VyperRuleEngine::with_default_rules();
        let violations = engine.analyze(source).unwrap();

        assert_eq!(violations.len(), 0);
    }

    #[test]
    fn test_no_violation_on_legitimate_external() {
        let source = r#"
# @version ^0.3.0

@external
def deposit(amount: uint256):
    pass

@external
def withdraw(amount: uint256):
    pass

@external
@view
def balance() -> uint256:
    return 0
"#;
        let engine = VyperRuleEngine::with_default_rules();
        let violations = engine.analyze(source).unwrap();

        assert_eq!(violations.len(), 0);
    }

    #[test]
    fn test_detect_helper_function_called_internally() {
        let source = r#"
# @version ^0.3.0

@external
def calculate_fee(amount: uint256) -> uint256:
    return amount * 3 / 1000

@external
def process_payment(amount: uint256):
    fee: uint256 = self.calculate_fee(amount)
"#;
        let engine = VyperRuleEngine::with_default_rules();
        let violations = engine.analyze(source).unwrap();

        // calculate_fee is called internally and looks like a helper
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].variable_name, "calculate_fee");
    }

    #[test]
    fn test_multiple_violations() {
        let source = r#"
# @version ^0.3.0

@external
def _private_logic():
    pass

@external
def _another_internal():
    pass

@external
def public_api():
    self._private_logic()
    self._another_internal()
"#;
        let engine = VyperRuleEngine::with_default_rules();
        let violations = engine.analyze(source).unwrap();

        assert_eq!(violations.len(), 2);
        let names: Vec<&str> = violations
            .iter()
            .map(|v| v.variable_name.as_str())
            .collect();
        assert!(names.contains(&"_private_logic"));
        assert!(names.contains(&"_another_internal"));
    }

    #[test]
    fn test_dunder_methods_not_flagged() {
        let source = r#"
# @version ^0.3.0

@external
def __init__():
    pass

@external
def __default__():
    pass
"#;
        let engine = VyperRuleEngine::with_default_rules();
        let violations = engine.analyze(source).unwrap();

        // Dunder methods should not be flagged
        assert_eq!(violations.len(), 0);
    }
}
