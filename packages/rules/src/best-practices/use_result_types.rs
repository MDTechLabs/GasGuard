use crate::soroban::{SorobanContract, SorobanRule};
use crate::{RuleViolation, ViolationSeverity};

pub struct UseResultTypesRule {
    enabled: bool,
}

impl Default for UseResultTypesRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for UseResultTypesRule {
    fn id(&self) -> &str {
        "use-result-types"
    }

    fn name(&self) -> &str {
        "Use Result Return Types"
    }

    fn description(&self) -> &str {
        "Detects functions that use fallible operations without returning Result"
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
                let raw = &function.raw_definition;
                let has_fallible = raw.contains(".unwrap()")
                    || raw.contains(".expect(")
                    || raw.contains(".get(")
                    || raw.contains(".load(");

                if !has_fallible {
                    continue;
                }

                let returns_result = function.return_type.as_deref()
                    .map(|t| t.contains("Result"))
                    .unwrap_or(false);

                if !returns_result {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: format!("Function '{}' uses fallible operations but does not return Result", function.name),
                        suggestion: "Return Result<T, Error> to properly propagate errors to callers".to_string(),
                        line_number: function.line_number,
                        column_number: 0,
                        variable_name: function.name.clone(),
                        severity: self.severity(),
                    });
                }
            }
        }

        violations
    }
}
