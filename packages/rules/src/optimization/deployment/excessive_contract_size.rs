//! Detect Excessive Contract Size (Issue #307)
//!
//! Identifies contracts whose estimated bytecode size is approaching or exceeding
//! the EVM deployment limit (EIP-170: 24,576 bytes). Large contracts incur higher
//! deployment gas costs and may fail to deploy entirely.
//!
//! Since full compilation is not performed during static analysis, bytecode size is
//! approximated by counting AST tokens and applying a bytes-per-token multiplier.
//! This is a conservative heuristic — actual compiled bytecode may differ.

use crate::rule_engine::{Rule, RuleViolation, ViolationSeverity};
use quote::ToTokens;
use syn::Item;

/// EVM bytecode deployment limit in bytes (EIP-170).
const EVM_BYTECODE_LIMIT: usize = 24_576;

/// Fraction of the limit at which a warning is issued.
const WARN_FRACTION: f64 = 0.75;

/// Conservative estimate of compiled bytes produced per source token.
/// Accounts for opcodes, operands, and ABI encoding overhead.
const ESTIMATED_BYTES_PER_TOKEN: usize = 2;

pub struct ExcessiveContractSizeRule;

impl Rule for ExcessiveContractSizeRule {
    fn name(&self) -> &str {
        "excessive-contract-size"
    }

    fn description(&self) -> &str {
        "Identifies contracts approaching or exceeding the 24,576-byte EVM deployment \
         limit (EIP-170). Large contracts increase deployment gas costs and may fail \
         to deploy."
    }

    fn check(&self, ast: &[Item]) -> Vec<RuleViolation> {
        let mut violations = Vec::new();

        let total_tokens: usize = ast
            .iter()
            .map(|item| count_tokens(item.to_token_stream()))
            .sum();

        let estimated_bytes = total_tokens * ESTIMATED_BYTES_PER_TOKEN;
        let warn_limit = (EVM_BYTECODE_LIMIT as f64 * WARN_FRACTION) as usize;

        if estimated_bytes >= EVM_BYTECODE_LIMIT {
            violations.push(RuleViolation {
                rule_name: self.name().to_string(),
                description: format!(
                    "Estimated contract bytecode size (~{} bytes) meets or exceeds the \
                     EVM 24,576-byte deployment limit (EIP-170). The contract may fail \
                     to deploy.",
                    estimated_bytes
                ),
                severity: ViolationSeverity::Critical,
                line_number: 0,
                column_number: 0,
                variable_name: String::new(),
                suggestion: "Split the contract into smaller modules, extract reusable \
                    logic into separate library contracts, or remove dead code to reduce \
                    bytecode size below the 24,576-byte limit."
                    .to_string(),
            });
        } else if estimated_bytes >= warn_limit {
            violations.push(RuleViolation {
                rule_name: self.name().to_string(),
                description: format!(
                    "Estimated contract bytecode size (~{} bytes) is approaching the \
                     EVM 24,576-byte deployment limit (EIP-170) — {:.1}% of the limit \
                     used. Future additions may cause deployment failures.",
                    estimated_bytes,
                    (estimated_bytes as f64 / EVM_BYTECODE_LIMIT as f64) * 100.0
                ),
                severity: ViolationSeverity::Warning,
                line_number: 0,
                column_number: 0,
                variable_name: String::new(),
                suggestion: "Consider extracting reusable logic into library contracts \
                    or helper modules to keep the contract well below the 24,576-byte \
                    deployment limit."
                    .to_string(),
            });
        }

        violations
    }
}

/// Helper function to recursively count tokens including nested groups
fn count_tokens(ts: proc_macro2::TokenStream) -> usize {
    ts.into_iter()
        .map(|tt| match tt {
            proc_macro2::TokenTree::Group(g) => 1 + count_tokens(g.stream()),
            _ => 1,
        })
        .sum()
}

/// Returns an estimated bytecode size in bytes for the given AST items.
///
/// This is exposed for use by callers that need a size estimate without
/// triggering a full rule violation (e.g. reporting dashboards).
pub fn estimate_bytecode_size(ast: &[Item]) -> usize {
    let total_tokens: usize = ast
        .iter()
        .map(|item| count_tokens(item.to_token_stream()))
        .sum();
    total_tokens * ESTIMATED_BYTES_PER_TOKEN
}

#[cfg(test)]
mod tests {
    use super::*;
    use syn::parse_file;

    fn check(code: &str) -> Vec<RuleViolation> {
        let ast = parse_file(code).expect("parse failed");
        ExcessiveContractSizeRule.check(&ast.items)
    }

    #[test]
    fn no_violation_for_small_contract() {
        let code = r#"
            struct Token;
            impl Token {
                pub fn transfer(to: u64, amount: u64) -> bool {
                    amount > 0
                }
            }
        "#;
        assert!(check(code).is_empty());
    }

    #[test]
    fn estimate_size_grows_with_code() {
        let small = r#"fn a() {}"#;
        let large = r#"
            fn a() { let x = 1; let y = 2; let z = x + y; }
            fn b() { let x = 1; let y = 2; let z = x + y; }
            fn c() { let x = 1; let y = 2; let z = x + y; }
            fn d() { let x = 1; let y = 2; let z = x + y; }
            fn e() { let x = 1; let y = 2; let z = x + y; }
        "#;

        let small_ast = parse_file(small).unwrap();
        let large_ast = parse_file(large).unwrap();

        assert!(
            estimate_bytecode_size(&large_ast.items) > estimate_bytecode_size(&small_ast.items)
        );
    }

    #[test]
    fn warning_threshold_is_below_critical() {
        let warn_limit = (EVM_BYTECODE_LIMIT as f64 * WARN_FRACTION) as usize;
        assert!(warn_limit < EVM_BYTECODE_LIMIT);
    }

    #[test]
    fn critical_violation_reported_for_oversized_contract() {
        // Build a contract large enough to exceed the estimated limit.
        // Each repetition contributes tokens, so we repeat a non-trivial block.
        let block = r#"
            pub fn compute_fee(amount: u64, rate: u64, base: u64, offset: u64) -> u64 {
                let intermediate = amount * rate;
                let adjusted = intermediate / base;
                let result = adjusted + offset;
                result
            }
        "#;
        // Repeat enough times to exceed EVM_BYTECODE_LIMIT / ESTIMATED_BYTES_PER_TOKEN tokens.
        let reps = (EVM_BYTECODE_LIMIT / ESTIMATED_BYTES_PER_TOKEN) / 30 + 1;
        let mut code = String::new();
        for i in 0..reps {
            code.push_str(&block.replace("compute_fee", &format!("compute_fee_{}", i)));
        }

        let violations = check(&code);
        assert!(
            violations
                .iter()
                .any(|v| matches!(v.severity, ViolationSeverity::Critical)),
            "Expected a Critical violation for an oversized contract"
        );
    }

    #[test]
    fn estimate_bytecode_size_returns_nonzero_for_nonempty_ast() {
        let code = r#"fn foo() -> u64 { 42 }"#;
        let ast = parse_file(code).unwrap();
        assert!(estimate_bytecode_size(&ast.items) > 0);
    }
}
