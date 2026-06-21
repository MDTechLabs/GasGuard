use crate::optimization::storage::{
    detect_packing_opportunities, get_type_size, is_packable_type, VariableInfo,
};
/// Solidity State Variable Packing Rule
///
/// This rule analyzes contract state variables and detects opportunities to pack them more efficiently.
use crate::rule_engine::{Rule, RuleViolation, ViolationSeverity};
use gasguard_ast::{Language, UnifiedAST};
use syn::Item;

pub struct StateVariablePackingRule;

impl Rule for StateVariablePackingRule {
    fn name(&self) -> &str {
        "state-variable-packing"
    }

    fn description(&self) -> &str {
        "Detects opportunities to pack state variables into fewer storage slots for gas optimization"
    }

    fn check(&self, _ast: &[Item]) -> Vec<RuleViolation> {
        // Note: This is a placeholder for the syn-based interface
        // The main implementation should be used with UnifiedAST
        Vec::new()
    }
}

impl StateVariablePackingRule {
    /// Analyze a UnifiedAST for packing opportunities
    pub fn analyze(&self, ast: &UnifiedAST) -> Vec<RuleViolation> {
        let mut violations = Vec::new();

        if ast.language != Language::Solidity {
            return violations;
        }

        for contract in &ast.contracts {
            let variables: Vec<VariableInfo> = contract
                .state_variables
                .iter()
                .map(|var| VariableInfo {
                    name: var.name.clone(),
                    type_name: var.type_name.clone(),
                    size_bytes: get_type_size(&var.type_name),
                    line_number: var.line_number,
                })
                .collect();

            let opportunities = detect_packing_opportunities(variables.clone());

            for opportunity in opportunities {
                let var_names: Vec<String> = opportunity
                    .variables
                    .iter()
                    .map(|v| v.name.clone())
                    .collect();

                let line_number = opportunity
                    .variables
                    .first()
                    .map(|v| v.line_number)
                    .unwrap_or(1);

                violations.push(RuleViolation {
                    rule_name: self.name().to_string(),
                    description: format!(
                        "Variables {} can be packed into a struct to save {} bytes per slot",
                        var_names.join(", "),
                        opportunity.wasted_bytes
                    ),
                    severity: ViolationSeverity::Low,
                    line_number,
                    column_number: 1,
                    variable_name: var_names[0].clone(),
                    suggestion: opportunity.suggestion,
                });
            }
        }

        violations
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_state_variable_packing_rule() {
        let rule = StateVariablePackingRule;
        assert_eq!(rule.name(), "state-variable-packing");
        assert!(rule.description().contains("pack"));
    }
}
