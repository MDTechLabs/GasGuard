//! Detect Hardcoded Addresses (Issue #310)
//!
//! Flags hardcoded wallet and contract addresses embedded directly in source code.
//! Hardcoded addresses reduce upgradeability and portability: rotating a key or
//! migrating a dependency requires a full redeployment rather than a configuration
//! change.
//!
//! Detection strategy:
//! - Scan every top-level AST item's token stream for 20-byte (40 hex-char)
//!   Ethereum-style addresses of the form `0x[0-9a-fA-F]{40}`.
//! - Each unique address is reported once per item to avoid duplicate violations.
//! - Suggests moving addresses to constructor parameters or an on-chain
//!   configuration registry.

use crate::rule_engine::{Rule, RuleViolation, ViolationSeverity};
use quote::ToTokens;
use regex::Regex;
use std::collections::HashSet;
use syn::Item;

pub struct HardcodedAddressesRule;

impl Rule for HardcodedAddressesRule {
    fn name(&self) -> &str {
        "hardcoded-addresses"
    }

    fn description(&self) -> &str {
        "Detects hardcoded wallet or contract addresses in source code. Hardcoded \
         addresses reduce upgradeability and portability, requiring a full \
         redeployment to rotate keys or update dependencies."
    }

    fn check(&self, ast: &[Item]) -> Vec<RuleViolation> {
        let address_re = Regex::new(r"(?i)\b0x[0-9a-f]+\b").expect("invalid regex");

        let mut violations = Vec::new();
        // Track addresses seen globally to avoid duplicate violations across items.
        let mut reported: HashSet<String> = HashSet::new();

        for item in ast {
            let token_str = item.to_token_stream().to_string();
            // Deduplicate within this item too.
            let mut seen_in_item: HashSet<String> = HashSet::new();

            for m in address_re.find_iter(&token_str) {
                let addr = m.as_str().to_lowercase();
                if addr.len() != 42 {
                    continue;
                }
                if reported.contains(&addr) {
                    continue;
                }
                if seen_in_item.insert(addr.clone()) {
                    reported.insert(addr.clone());
                    violations.push(RuleViolation {
                        rule_name: self.name().to_string(),
                        description: format!(
                            "Hardcoded address `{}` detected. Embedding addresses \
                             directly in source code reduces upgradeability and \
                             portability of the contract.",
                            addr
                        ),
                        severity: ViolationSeverity::High,
                        line_number: 0,
                        column_number: 0,
                        variable_name: addr.clone(),
                        suggestion: "Replace the hardcoded address with a configurable \
                             parameter: pass it as a constructor argument, store it in \
                             an owner-controlled setter, or read it from an on-chain \
                             configuration registry."
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
        HardcodedAddressesRule.check(&ast.items)
    }

    #[test]
    fn flags_hardcoded_address_in_const() {
        let code = r#"
            const TREASURY: &str = "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12";
        "#;
        let violations = check(code);
        assert!(
            !violations.is_empty(),
            "Expected a violation for a hardcoded address constant"
        );
    }

    #[test]
    fn flags_hardcoded_address_in_function_body() {
        let code = r#"
            fn get_owner() -> &'static str {
                "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
            }
        "#;
        let violations = check(code);
        assert!(!violations.is_empty());
    }

    #[test]
    fn flags_hardcoded_address_in_let_binding() {
        let code = r#"
            fn setup() {
                let admin = "0x1111111111111111111111111111111111111111";
            }
        "#;
        let violations = check(code);
        assert!(!violations.is_empty());
    }

    #[test]
    fn no_violation_for_short_hex_values() {
        // A 32-char hex string is not a valid 20-byte address.
        let code = r#"
            const HASH: &str = "0xdeadbeefdeadbeefdeadbeefdeadbeef";
        "#;
        assert!(
            check(code).is_empty(),
            "A 16-byte hex value should not be flagged as an address"
        );
    }

    #[test]
    fn no_violation_for_longer_hash() {
        // A 64-char hex string (32-byte hash) should not match.
        let code = r#"
            const TX_HASH: &str =
                "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab";
        "#;
        assert!(
            check(code).is_empty(),
            "A 32-byte hex hash should not be flagged as a 20-byte address"
        );
    }

    #[test]
    fn deduplicates_same_address_across_items() {
        let code = r#"
            const A: &str = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
            const B: &str = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        "#;
        let violations = check(code);
        assert_eq!(
            violations.len(),
            1,
            "The same address should only be reported once"
        );
    }

    #[test]
    fn reports_multiple_distinct_addresses() {
        let code = r#"
            const ADDR_A: &str = "0x1111111111111111111111111111111111111111";
            const ADDR_B: &str = "0x2222222222222222222222222222222222222222";
        "#;
        let violations = check(code);
        assert_eq!(
            violations.len(),
            2,
            "Two distinct addresses should each be reported"
        );
    }

    #[test]
    fn violation_severity_is_high() {
        let code = r#"
            const OWNER: &str = "0xffffffffffffffffffffffffffffffffffffffff";
        "#;
        let violations = check(code);
        assert!(
            violations
                .iter()
                .all(|v| matches!(v.severity, ViolationSeverity::High)),
            "Hardcoded address violations should have High severity"
        );
    }

    #[test]
    fn no_violation_for_non_address_string() {
        let code = r#"
            fn greet() -> &'static str {
                "hello world"
            }
        "#;
        assert!(check(code).is_empty());
    }
}
