use crate::optimization::encoding::detect_abi_encoding_inefficiencies;
use crate::rule_engine::{Rule, RuleViolation};
use gasguard_ast::{Language, UnifiedAST};
use syn::Item;

pub struct AbiEncodingRule;

impl Rule for AbiEncodingRule {
    fn name(&self) -> &str {
        "abi-encoding-inefficiency"
    }

    fn description(&self) -> &str {
        "Detects inefficient use of abi.encode that could be replaced with abi.encodePacked"
    }

    fn check(&self, _ast: &[Item]) -> Vec<RuleViolation> {
        // Handled via analyze
        Vec::new()
    }
}

impl AbiEncodingRule {
    pub fn analyze(&self, ast: &UnifiedAST) -> Vec<RuleViolation> {
        if ast.language != Language::Solidity {
            return Vec::new();
        }

        detect_abi_encoding_inefficiencies(ast)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_abi_encoding_rule_info() {
        let rule = AbiEncodingRule;
        assert_eq!(rule.name(), "abi-encoding-inefficiency");
        assert!(rule.description().contains("abi.encode"));
    }
}
