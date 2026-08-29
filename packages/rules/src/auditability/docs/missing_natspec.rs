//! Detect Missing NatSpec Documentation
//!
//! Flags public/external functions that lack NatSpec (`///` or `/** */`) comments.
//! Poor documentation reduces auditability and maintainability.

use crate::rule_engine::{Rule, RuleViolation, ViolationSeverity};
use syn::{Item, Visibility};

pub struct MissingNatspecRule;

impl Rule for MissingNatspecRule {
    fn name(&self) -> &str {
        "missing-natspec"
    }

    fn description(&self) -> &str {
        "Detects public functions missing NatSpec documentation comments."
    }

    fn check(&self, ast: &[Item]) -> Vec<RuleViolation> {
        let mut violations = Vec::new();
        for item in ast {
            if let Item::Fn(func) = item {
                let is_public = matches!(func.vis, Visibility::Public(_));
                let has_doc = func.attrs.iter().any(|a| a.path().is_ident("doc"));
                if is_public && !has_doc {
                    violations.push(RuleViolation {
                        rule_name: self.name().to_string(),
                        description: format!(
                            "Public function `{}` is missing NatSpec documentation.",
                            func.sig.ident
                        ),
                        severity: ViolationSeverity::Low,
                        line_number: 0,
                        column_number: 0,
                        variable_name: func.sig.ident.to_string(),
                        suggestion: "Add `/// @notice`, `/// @param`, and `/// @return` \
                            NatSpec comments above the function."
                            .to_string(),
                    });
                }
            }
        }
        violations
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use syn::parse_file;

    fn check(code: &str) -> Vec<RuleViolation> {
        let ast = parse_file(code).expect("parse failed");
        MissingNatspecRule.check(&ast.items)
    }

    #[test]
    fn flags_undocumented_public_fn() {
        assert!(!check("pub fn transfer() {}").is_empty());
    }

    #[test]
    fn no_violation_for_documented_fn() {
        assert!(check("/// @notice transfers tokens\npub fn transfer() {}").is_empty());
    }

    #[test]
    fn no_violation_for_private_fn() {
        assert!(check("fn internal_helper() {}").is_empty());
    }
}
