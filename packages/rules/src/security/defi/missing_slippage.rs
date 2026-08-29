//! Detect Missing Slippage Validation
//!
//! # Overview
//! This module implements the `MissingSlippageValidationRule`, which flags Decentralized Finance (DeFi) 
//! operations that lack slippage protections. In Automated Market Makers (AMMs) and DEX environments, 
//! operations such as token swaps or liquidity modifications are vulnerable to price volatility.
//! 
//! # Rationale
//! Without parameters specifying an acceptable limit (e.g., a minimum amount received), a user's transaction 
//! could be manipulated by MEV searchers (e.g., via sandwich attacks or front-running), resulting in a 
//! substantial loss of funds. This rule ensures that developers implement proper parameter-level checks for limits.

use crate::rule_engine::{Rule, RuleViolation, ViolationSeverity};
use syn::{FnArg, ImplItem, Item, Pat, PatType, Signature};

/// Rule for detecting missing slippage protection in DeFi contracts.
///
/// This rule iterates over Abstract Syntax Tree (AST) items (both standalone functions and methods in `impl` blocks).
/// It looks for common DeFi terminology in function names and validates that their signatures contain 
/// parameters explicitly intended to manage slippage (e.g., `min_out`, `limit`).
pub struct MissingSlippageValidationRule;

impl MissingSlippageValidationRule {
    /// Determines whether a given function name signifies a DeFi trading or liquidity operation.
    ///
    /// # Logic
    /// We use a heuristic-based lexical analysis, checking if the function name (in lowercase) 
    /// contains predefined keywords indicative of DeFi interactions.
    ///
    /// # Justification
    /// Standardizing naming conventions allows static analysis to catch most typical DeFi patterns 
    /// (`swap`, `add_liquidity`, etc.) without requiring complex behavioral or flow analysis.
    fn is_defi_operation(name: &str) -> bool {
        let name = name.to_lowercase();
        name.contains("swap")
            || name.contains("trade")
            || name.contains("exchange")
            || name.contains("add_liquidity")
            || name.contains("remove_liquidity")
            || name.contains("buy")
            || name.contains("sell")
    }

    /// Determines whether the function's parameter list includes slippage protection limits.
    ///
    /// # Logic
    /// Iterates through each argument in the function signature. If an argument is a standard typed pattern 
    /// (`FnArg::Typed`), it extracts the identifier name and checks it against a list of known slippage keywords 
    /// (e.g., `min_amount`, `min_out`, `slippage`).
    ///
    /// # Justification
    /// Slippage must be passed as an argument by the caller. If none of the function's parameters imply a limit, 
    /// the function body cannot securely validate slippage against user-defined constraints.
    fn has_slippage_parameter(sig: &Signature) -> bool {
        for arg in &sig.inputs {
            if let FnArg::Typed(PatType { pat, .. }) = arg {
                if let Pat::Ident(pat_ident) = &**pat {
                    let param_name = pat_ident.ident.to_string().to_lowercase();
                    if param_name.contains("min_amount")
                        || param_name.contains("min_out")
                        || param_name.contains("limit")
                        || param_name.contains("slippage")
                        || param_name.contains("min_recv")
                        || param_name.contains("amount_out_min")
                    {
                        return true;
                    }
                }
            }
        }
        false
    }
}

impl Rule for MissingSlippageValidationRule {
    fn name(&self) -> &str {
        "missing-slippage-validation"
    }

    fn description(&self) -> &str {
        "Detects DeFi operations (e.g., swaps or liquidity provision) lacking slippage limit parameters. \
         Without slippage limits, transactions are vulnerable to front-running and sandwich attacks, \
         potentially resulting in user fund loss."
    }

    fn check(&self, ast: &[Item]) -> Vec<RuleViolation> {
        let mut violations = Vec::new();

        for item in ast {
            match item {
                Item::Fn(item_fn) => {
                    let fn_name = item_fn.sig.ident.to_string();
                    if Self::is_defi_operation(&fn_name) && !Self::has_slippage_parameter(&item_fn.sig) {
                        violations.push(RuleViolation {
                            rule_name: self.name().to_string(),
                            description: format!("Function '{}' lacks a slippage protection parameter (e.g., min_amount_out).", fn_name),
                            severity: ViolationSeverity::High,
                            line_number: 0,
                            column_number: 0,
                            variable_name: fn_name.clone(),
                            suggestion: "Add a slippage limit parameter to protect against front-running and sandwich attacks.".to_string(),
                        });
                    }
                }
                Item::Impl(item_impl) => {
                    for impl_item in &item_impl.items {
                        if let ImplItem::Fn(impl_fn) = impl_item {
                            let fn_name = impl_fn.sig.ident.to_string();
                            if Self::is_defi_operation(&fn_name) && !Self::has_slippage_parameter(&impl_fn.sig) {
                                violations.push(RuleViolation {
                                    rule_name: self.name().to_string(),
                                    description: format!("Function '{}' lacks a slippage protection parameter (e.g., min_amount_out).", fn_name),
                                    severity: ViolationSeverity::High,
                                    line_number: 0,
                                    column_number: 0,
                                    variable_name: fn_name.clone(),
                                    suggestion: "Add a slippage limit parameter to protect against front-running and sandwich attacks.".to_string(),
                                });
                            }
                        }
                    }
                }
                _ => {}
            }
        }

        violations
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use syn::parse_file;

    #[test]
    fn test_missing_slippage_in_swap() {
        let code = r#"
            pub struct Dex;
            impl Dex {
                pub fn swap(amount_in: u64, path: Vec<Address>) {
                    // swap logic without slippage check
                }
            }
        "#;
        let ast = parse_file(code).unwrap();
        let rule = MissingSlippageValidationRule;
        let violations = rule.check(&ast.items);

        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].severity, ViolationSeverity::High);
        assert_eq!(violations[0].variable_name, "swap");
        assert!(violations[0].description.contains("lacks a slippage protection parameter"));
    }

    #[test]
    fn test_has_slippage_in_swap() {
        let code = r#"
            pub struct Dex;
            impl Dex {
                pub fn swap(amount_in: u64, min_amount_out: u64, path: Vec<Address>) {
                    // swap logic with slippage check
                }
            }
        "#;
        let ast = parse_file(code).unwrap();
        let rule = MissingSlippageValidationRule;
        let violations = rule.check(&ast.items);

        assert_eq!(violations.len(), 0);
    }

    #[test]
    fn test_missing_slippage_in_add_liquidity() {
        let code = r#"
            pub fn add_liquidity(token_a: Address, token_b: Address, amount_a: u64, amount_b: u64) {
                // add liquidity logic
            }
        "#;
        let ast = parse_file(code).unwrap();
        let rule = MissingSlippageValidationRule;
        let violations = rule.check(&ast.items);

        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].variable_name, "add_liquidity");
    }

    #[test]
    fn test_not_a_defi_operation() {
        let code = r#"
            pub fn transfer(to: Address, amount: u64) {
                // simple transfer
            }
        "#;
        let ast = parse_file(code).unwrap();
        let rule = MissingSlippageValidationRule;
        let violations = rule.check(&ast.items);

        assert_eq!(violations.len(), 0);
    }
}
