use crate::optimization::storage::detect_mapping_iteration;
use crate::rule_engine::{Rule, RuleViolation};
use gasguard_ast::UnifiedAST;
use syn::Item;

pub struct MappingIterationRule;

impl Rule for MappingIterationRule {
    fn name(&self) -> &str {
        "mapping-iteration-workaround"
    }

    fn description(&self) -> &str {
        "Detects iteration over a helper array used as keys for mapping access, which is highly gas-inefficient."
    }

    fn check(&self, _ast: &[Item]) -> Vec<RuleViolation> {
        // Fallback for syn-based generic interface if needed.
        // The main implementation relies on UnifiedAST via analyze().
        Vec::new()
    }
}

impl MappingIterationRule {
    pub fn analyze(&self, ast: &UnifiedAST) -> Vec<RuleViolation> {
        detect_mapping_iteration(ast)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mapping_iteration_rule() {
        let rule = MappingIterationRule;
        assert_eq!(rule.name(), "mapping-iteration-workaround");
        assert!(rule.description().contains("iteration"));
    }
}
