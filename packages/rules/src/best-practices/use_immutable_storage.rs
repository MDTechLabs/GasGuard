use crate::soroban::{SorobanContract, SorobanRule};
use crate::{RuleViolation, ViolationSeverity};

pub struct UseImmutableStorageRule {
    enabled: bool,
}

impl Default for UseImmutableStorageRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for UseImmutableStorageRule {
    fn id(&self) -> &str {
        "use-immutable-storage"
    }

    fn name(&self) -> &str {
        "Use Immutable Storage for Read-Only Data"
    }

    fn description(&self) -> &str {
        "Detects storage writes in view/pure functions that should use immutable storage"
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
                let func_name = function.name.to_lowercase();

                if func_name.starts_with("get_") || func_name.starts_with("is_") || func_name.starts_with("has_") {
                    let raw = &function.raw_definition;
                    if raw.contains(".set(") || raw.contains(".store(") {
                        violations.push(RuleViolation {
                            rule_name: self.id().to_string(),
                            description: format!("View function '{}' performs a storage write", function.name),
                            suggestion: "Use immutable storage (env.storage().immutable()) for read-only data that never changes, or move the write to a separate set_ function.".to_string(),
                            line_number: function.line_number,
                            column_number: 0,
                            variable_name: function.name.clone(),
                            severity: self.severity(),
                        });
                    }
                }
            }
        }

        violations
    }
}
