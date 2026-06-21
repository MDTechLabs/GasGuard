//! Detect Inconsistent Error Handling
//!
//! Flags mixed error handling patterns (e.g., panic!(), Result, custom enums) in the same codebase.
//! Inconsistent errors reduce maintainability and auditability.

use crate::rule_engine::{Rule, RuleViolation, ViolationSeverity};
use syn::{Expr, Item, Macro, Stmt};

pub struct InconsistentErrorHandlingRule;

impl Rule for InconsistentErrorHandlingRule {
    fn name(&self) -> &str {
        "inconsistent-error-handling"
    }

    fn description(&self) -> &str {
        "Detects mixed error handling styles (panic!(), Result, custom enums) that reduce maintainability."
    }

    fn check(&self, ast: &[Item]) -> Vec<RuleViolation> {
        let mut violations = Vec::new();
        let mut found_patterns = std::collections::HashSet::new();

        // First pass: identify all error handling patterns used
        for item in ast {
            self.extract_patterns_from_item(item, &mut found_patterns);
        }

        // If more than one pattern is found, flag inconsistencies.
        // Note: Result and CustomEnum are allowed to co-exist as they are commonly used together.
        let mut is_inconsistent = found_patterns.len() > 1;
        if found_patterns.len() == 2
            && found_patterns.contains("Result")
            && found_patterns.contains("CustomEnum")
        {
            is_inconsistent = false;
        }

        if is_inconsistent {
            let patterns: Vec<_> = found_patterns.into_iter().collect();
            violations.push(RuleViolation {
                rule_name: self.name().to_string(),
                description: format!(
                    "Inconsistent error handling detected: found patterns {:?}",
                    patterns
                ),
                severity: ViolationSeverity::Medium,
                line_number: 1,
                column_number: 0,
                variable_name: "error_handling".to_string(),
                suggestion: "Standardize error handling across the codebase. Choose one pattern (e.g., custom Result enum with thiserror) and use it consistently."
                    .to_string(),
            });
        }

        violations
    }
}

impl InconsistentErrorHandlingRule {
    fn extract_patterns_from_item(
        &self,
        item: &Item,
        patterns: &mut std::collections::HashSet<String>,
    ) {
        match item {
            Item::Fn(func) => {
                // Check return type for Result
                if let syn::ReturnType::Type(_, ty) = &func.sig.output {
                    if let syn::Type::Path(type_path) = ty.as_ref() {
                        if let Some(segment) = type_path.path.segments.last() {
                            if segment.ident == "Result" {
                                patterns.insert("Result".to_string());
                            }
                        }
                    }
                }
                // Check function body
                for stmt in &func.block.stmts {
                    self.extract_patterns_from_stmt(stmt, patterns);
                }
            }
            Item::Impl(impl_block) => {
                for item in &impl_block.items {
                    if let syn::ImplItem::Fn(method) = item {
                        // Check return type for Result
                        if let syn::ReturnType::Type(_, ty) = &method.sig.output {
                            if let syn::Type::Path(type_path) = ty.as_ref() {
                                if let Some(segment) = type_path.path.segments.last() {
                                    if segment.ident == "Result" {
                                        patterns.insert("Result".to_string());
                                    }
                                }
                            }
                        }
                        // Check method body
                        for stmt in &method.block.stmts {
                            self.extract_patterns_from_stmt(stmt, patterns);
                        }
                    }
                }
            }
            Item::Enum(enum_item) => {
                // Check if enum looks like an error enum (e.g., has variants with names like Error, Invalid, etc.)
                let enum_name = enum_item.ident.to_string().to_lowercase();
                if enum_name.contains("error") {
                    patterns.insert("CustomEnum".to_string());
                }
            }
            _ => {}
        }
    }

    fn extract_patterns_from_stmt(
        &self,
        stmt: &Stmt,
        patterns: &mut std::collections::HashSet<String>,
    ) {
        match stmt {
            Stmt::Expr(expr, _) => self.extract_patterns_from_expr(expr, patterns),
            Stmt::Local(local) => {
                if let Some(init) = &local.init {
                    self.extract_patterns_from_expr(&init.expr, patterns);
                }
            }
            Stmt::Macro(stmt_macro) => {
                self.check_macro(&stmt_macro.mac, patterns);
            }
            _ => {}
        }
    }

    fn extract_patterns_from_expr(
        &self,
        expr: &Expr,
        patterns: &mut std::collections::HashSet<String>,
    ) {
        match expr {
            Expr::Macro(macro_expr) => {
                self.check_macro(&macro_expr.mac, patterns);
            }
            Expr::If(if_expr) => {
                self.extract_patterns_from_expr(&if_expr.cond, patterns);
                for stmt in &if_expr.then_branch.stmts {
                    self.extract_patterns_from_stmt(stmt, patterns);
                }
                if let Some((_, else_branch)) = &if_expr.else_branch {
                    self.extract_patterns_from_expr(else_branch, patterns);
                }
            }
            Expr::Match(match_expr) => {
                self.extract_patterns_from_expr(&match_expr.expr, patterns);
                for arm in &match_expr.arms {
                    self.extract_patterns_from_expr(&arm.body, patterns);
                }
            }
            Expr::Block(block) => {
                for stmt in &block.block.stmts {
                    self.extract_patterns_from_stmt(stmt, patterns);
                }
            }
            Expr::MethodCall(method_call) => {
                for arg in &method_call.args {
                    self.extract_patterns_from_expr(arg, patterns);
                }
            }
            Expr::Call(call) => {
                for arg in &call.args {
                    self.extract_patterns_from_expr(arg, patterns);
                }
            }
            _ => {}
        }
    }

    fn check_macro(&self, mac: &Macro, patterns: &mut std::collections::HashSet<String>) {
        if let Some(segment) = mac.path.segments.last() {
            let ident = segment.ident.to_string();
            match ident.as_str() {
                "panic" | "panic!" | "unreachable" | "unreachable!" | "todo" | "todo!"
                | "unimplemented" | "unimplemented!" => {
                    patterns.insert("Panic".to_string());
                }
                _ => {}
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use syn::parse_file;

    fn check(code: &str) -> Vec<RuleViolation> {
        let ast = parse_file(code).expect("parse failed");
        InconsistentErrorHandlingRule.check(&ast.items)
    }

    #[test]
    fn detects_mixed_patterns() {
        let code = r#"
            pub enum Error {
                InvalidInput,
            }

            pub fn uses_result() -> Result<(), Error> {
                Ok(())
            }

            pub fn uses_panic() {
                panic!("oops");
            }
        "#;
        assert!(!check(code).is_empty());
    }

    #[test]
    fn no_violation_for_consistent_pattern() {
        let code = r#"
            pub enum Error {
                InvalidInput,
            }

            pub fn foo() -> Result<(), Error> {
                Ok(())
            }

            pub fn bar() -> Result<(), Error> {
                Ok(())
            }
        "#;
        assert!(check(code).is_empty());
    }
}
