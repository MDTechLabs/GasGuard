//! Detect Duplicate Require Statements
//!
//! Identifies repeated validation conditions within the same function scope.
//! Duplicate requires waste gas and should be consolidated.

use crate::rule_engine::{Rule, RuleViolation, ViolationSeverity};
use quote::ToTokens;
use std::collections::HashMap;
use syn::{Item, Stmt};

pub struct DuplicateRequireStatementsRule;

impl Rule for DuplicateRequireStatementsRule {
    fn name(&self) -> &str {
        "duplicate-require-statements"
    }

    fn description(&self) -> &str {
        "Detects repeated require/assert conditions within the same function. \
         Duplicate validation checks waste gas and should be consolidated."
    }

    fn check(&self, ast: &[Item]) -> Vec<RuleViolation> {
        let mut violations = Vec::new();
        for item in ast {
            if let Item::Fn(func) = item {
                self.check_stmts(&func.block.stmts, &mut violations);
            }
            if let Item::Impl(impl_block) = item {
                for impl_item in &impl_block.items {
                    if let syn::ImplItem::Fn(method) = impl_item {
                        self.check_stmts(&method.block.stmts, &mut violations);
                    }
                }
            }
        }
        violations
    }
}

impl DuplicateRequireStatementsRule {
    fn check_stmts(&self, stmts: &[Stmt], violations: &mut Vec<RuleViolation>) {
        let mut seen: HashMap<String, usize> = HashMap::new();

        for stmt in stmts {
            if let Some(condition) = self.extract_require_condition(stmt) {
                let count = seen.entry(condition.clone()).or_insert(0);
                *count += 1;
                if *count == 2 {
                    violations.push(RuleViolation {
                        rule_name: self.name().to_string(),
                        description: format!(
                            "Condition `{}` is checked more than once in the same function. \
                             Duplicate require/assert statements waste gas.",
                            condition
                        ),
                        severity: ViolationSeverity::Medium,
                        line_number: 0,
                        column_number: 0,
                        variable_name: condition.clone(),
                        suggestion: format!(
                            "Consolidate the duplicate check for `{}` into a single \
                             require/assert statement.",
                            condition
                        ),
                    });
                }
            }
        }
    }

    /// Extracts the condition string from a `require!(cond, ...)` or `assert!(cond, ...)` macro call.
    fn extract_require_condition(&self, stmt: &Stmt) -> Option<String> {
        let expr = match stmt {
            Stmt::Expr(e, _) => e,
            _ => return None,
        };

        if let syn::Expr::Macro(mac) = expr {
            let name = mac.mac.path.to_token_stream().to_string();
            if name == "require" || name == "assert" || name == "assert_eq" {
                let tokens = mac.mac.tokens.to_string();
                // Use the first argument (the condition) as the key
                let condition = tokens
                    .split(',')
                    .next()
                    .map(|s| s.trim().to_string())
                    .unwrap_or(tokens);
                return Some(condition);
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use syn::parse_file;

    fn check(code: &str) -> Vec<RuleViolation> {
        let ast = parse_file(code).expect("parse failed");
        DuplicateRequireStatementsRule.check(&ast.items)
    }

    #[test]
    fn flags_duplicate_require() {
        let code = r#"
            fn transfer(amount: u64) {
                require!(amount > 0, "zero amount");
                require!(amount > 0, "zero amount again");
            }
        "#;
        assert!(!check(code).is_empty());
    }

    #[test]
    fn no_violation_for_unique_conditions() {
        let code = r#"
            fn transfer(amount: u64, to: Address) {
                require!(amount > 0, "zero amount");
                require!(to != Address::zero(), "zero address");
            }
        "#;
        assert!(check(code).is_empty());
    }

    #[test]
    fn flags_duplicate_assert() {
        let code = r#"
            fn validate(x: u64) {
                assert!(x > 0, "must be positive");
                assert!(x > 0, "must be positive again");
            }
        "#;
        assert!(!check(code).is_empty());
    }
}
