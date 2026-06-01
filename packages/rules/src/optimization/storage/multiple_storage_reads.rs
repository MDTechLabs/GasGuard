//! Detect Multiple Storage Reads
//!
//! Flags repeated reads from the same storage variable within a function.
//! Suggests caching the value in a local variable to reduce gas costs.

use crate::rule_engine::{Rule, RuleViolation, ViolationSeverity};
use syn::{Item, Stmt, Expr};
use std::collections::HashMap;

pub struct MultipleStorageReadsRule;

impl Rule for MultipleStorageReadsRule {
    fn name(&self) -> &str {
        "multiple-storage-reads"
    }

    fn description(&self) -> &str {
        "Detects repeated reads from the same storage slot. \
         Cache the value in a local variable to save gas."
    }

    fn check(&self, ast: &[Item]) -> Vec<RuleViolation> {
        let mut violations = Vec::new();
        for item in ast {
            if let Item::Fn(func) = item {
                self.check_stmts(&func.block.stmts, &mut violations);
            }
        }
        violations
    }
}

impl MultipleStorageReadsRule {
    fn check_stmts(&self, stmts: &[Stmt], violations: &mut Vec<RuleViolation>) {
        let mut read_counts: HashMap<String, usize> = HashMap::new();
        for stmt in stmts {
            if let Stmt::Expr(Expr::MethodCall(call), _) = stmt {
                let method = call.method.to_string();
                if method == "get" || method == "read" {
                    let key = format!("{:?}", call.receiver);
                    *read_counts.entry(key.clone()).or_insert(0) += 1;
                    if read_counts[&key] == 2 {
                        violations.push(RuleViolation {
                            rule_name: self.name().to_string(),
                            description: "Storage slot read more than once in the same function."
                                .to_string(),
                            severity: ViolationSeverity::Medium,
                            line_number: 0,
                            column_number: 0,
                            variable_name: key,
                            suggestion: "Cache the storage value in a local `let` binding."
                                .to_string(),
                        });
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use syn::parse_file;

    #[test]
    fn no_violation_single_read() {
        let ast = parse_file("fn f() { let x = s.get(&k); }").expect("parse");
        assert!(MultipleStorageReadsRule.check(&ast.items).is_empty());
    }
}