use crate::optimization::arrays::detect_dynamic_array_deletions;
use crate::rule_engine::{Rule, RuleViolation};
use gasguard_ast::UnifiedAST;
use syn::Item;

pub struct DynamicArrayDeletionRule;

impl Rule for DynamicArrayDeletionRule {
    fn name(&self) -> &str {
        "dynamic-array-deletion"
    }

    fn description(&self) -> &str {
        "Detects expensive deletions from dynamic arrays that shift elements instead of using swap-and-pop."
    }

    fn check(&self, _ast: &[Item]) -> Vec<RuleViolation> {
        Vec::new()
    }
}

impl DynamicArrayDeletionRule {
    pub fn analyze(&self, ast: &UnifiedAST) -> Vec<RuleViolation> {
        detect_dynamic_array_deletions(ast)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dynamic_array_deletion_rule() {
        let rule = DynamicArrayDeletionRule;
        assert_eq!(rule.name(), "dynamic-array-deletion");
        assert!(rule.description().contains("swap-and-pop"));
    }
}
