use crate::soroban::{SorobanContract, SorobanRule};
use crate::{RuleViolation, ViolationSeverity};

pub struct UseInitializationFunctionsRule {
    enabled: bool,
}

impl Default for UseInitializationFunctionsRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for UseInitializationFunctionsRule {
    fn id(&self) -> &str {
        "use-initialization-functions"
    }

    fn name(&self) -> &str {
        "Use Initialization Functions"
    }

    fn description(&self) -> &str {
        "Detects contracts that write to storage without a proper constructor"
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
        let has_constructor = contract.implementations.iter().any(|imp| {
            imp.functions.iter().any(|f| f.is_constructor)
        });

        if has_constructor {
            return Vec::new();
        }

        let has_storage_init = contract.source.contains(".set(")
            || contract.source.contains(".store(");

        if !has_storage_init {
            return Vec::new();
        }

        vec![RuleViolation {
            rule_name: self.id().to_string(),
            description: format!("Contract '{}' writes to storage but has no constructor function", contract.name),
            suggestion: "Add a __constructor or new() function to initialize state at deployment time".to_string(),
            line_number: 1,
            column_number: 0,
            variable_name: contract.name.clone(),
            severity: self.severity(),
        }]
    }
}
