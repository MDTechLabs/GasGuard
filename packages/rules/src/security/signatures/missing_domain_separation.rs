//! Detect Missing Signature Domain Separation (EIP-712)
//!
//! Flags use of ECDSA signatures without proper domain separation.
//! Missing domain separation enables replay attacks across chains or contexts.
//!
//! Detection strategy:
//! - Scan for signature verification patterns (ecrecover, ECDSA.recover, etc.)
//! - Check if they include EIP-712 domain separation (DOMAIN_TYPEHASH, domainSeparator)
//! - Flag cases where domain separation is incomplete or missing
//! - Suggest implementing proper EIP-712 domain separation

use crate::rule_engine::{Rule, RuleViolation, ViolationSeverity};
use quote::ToTokens;
use syn::Item;

pub struct MissingDomainSeparationRule;

impl MissingDomainSeparationRule {
    /// Check if a code string contains signature verification patterns
    fn has_signature_verification(code: &str) -> bool {
        // Common Solidity signature verification patterns
        let patterns = vec![
            "ecrecover",
            "ECDSA.recover",
            "signature",
            "_recover",
            "recoverSigner",
        ];

        patterns.iter().any(|pattern| code.contains(pattern))
    }

    /// Check if code has EIP-712 domain separation implemented
    fn has_domain_separation(code: &str) -> bool {
        let domain_patterns = vec![
            "DOMAIN_TYPEHASH",
            "domainSeparator",
            "domain_separator",
            "DOMAIN_SEPARATOR",
            "EIP712DOMAIN",
        ];

        domain_patterns.iter().any(|pattern| code.contains(pattern))
    }

    /// Check for incomplete EIP-712 domain configuration
    fn check_incomplete_eip712(code: &str) -> Vec<String> {
        let mut issues = Vec::new();

        // Missing DOMAIN_TYPEHASH
        if code.contains("ecrecover") && !code.contains("DOMAIN_TYPEHASH") {
            issues.push("Missing DOMAIN_TYPEHASH constant".to_string());
        }

        // Missing domain separator computation
        if code.contains("ecrecover")
            && !code.contains("DOMAIN_SEPARATOR")
            && !code.contains("domainSeparator")
            && !code.contains("domain_separator")
        {
            issues.push("Missing domainSeparator variable or computation".to_string());
        }

        // Missing or incomplete EIP-712 type hash for message
        if code.contains("keccak256(abi.encode") && !code.contains("TYPEHASH") {
            issues.push("Incomplete EIP-712 message type configuration".to_string());
        }

        // Check for chainId inclusion in domain separator
        if code.contains("DOMAIN_SEPARATOR")
            && !code.contains("block.chainid")
            && !code.contains("chainid()")
        {
            issues.push("Domain separator may not include chain ID (potential cross-chain replay vulnerability)"
                .to_string());
        }

        issues
    }
}

impl Rule for MissingDomainSeparationRule {
    fn name(&self) -> &str {
        "missing-domain-separation"
    }

    fn description(&self) -> &str {
        "Detects signatures lacking proper EIP-712 domain separation. Missing domain \
         separation enables replay attacks across different chains or contract contexts."
    }

    fn check(&self, ast: &[Item]) -> Vec<RuleViolation> {
        let mut violations = Vec::new();

        for item in ast {
            let token_str = item.to_token_stream().to_string();

            // Only check items that contain signature verification
            if !Self::has_signature_verification(&token_str) {
                continue;
            }

            // Check if domain separation is completely missing
            if !Self::has_domain_separation(&token_str) {
                violations.push(RuleViolation {
                    rule_name: self.name().to_string(),
                    description: "Signature verification detected without EIP-712 domain \
                                  separation. This enables replay attacks."
                        .to_string(),
                    severity: ViolationSeverity::Critical,
                    line_number: 0,
                    column_number: 0,
                    variable_name: "signature_verification".to_string(),
                    suggestion: "Implement EIP-712 domain separation by: \
                                  1. Define DOMAIN_TYPEHASH constant \
                                  2. Compute domainSeparator including chainId \
                                  3. Include domainSeparator in message hash \
                                  4. Verify signature against the domain-separated hash. \
                                  See https://eips.ethereum.org/EIPS/eip-712"
                        .to_string(),
                });
            } else {
                // Check for incomplete domain separation
                let issues = Self::check_incomplete_eip712(&token_str);
                for issue in issues {
                    violations.push(RuleViolation {
                        rule_name: self.name().to_string(),
                        description: format!("Incomplete EIP-712 domain separation: {}", issue),
                        severity: ViolationSeverity::High,
                        line_number: 0,
                        column_number: 0,
                        variable_name: "eip712_config".to_string(),
                        suggestion: "Ensure complete EIP-712 implementation: include chainId, \
                             address, and version in domain separator calculation."
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

    #[test]
    fn test_missing_domain_separation_detection() {
        let code_without_domain = r#"
            fn recoverSigner() {
                let x = "ecrecover";
            }
        "#;

        let rule = MissingDomainSeparationRule;
        let ast = syn::parse_file(code_without_domain).unwrap();
        let violations = rule.check(&ast.items);

        assert!(!violations.is_empty());
        assert!(violations[0].severity == ViolationSeverity::Critical);
    }

    #[test]
    fn test_domain_separation_detection() {
        let code_with_domain = r#"
            fn recoverSigner() {
                let ecrecover = "DOMAIN_TYPEHASH";
                let domainSeparator = "block.chainid";
            }
        "#;

        let rule = MissingDomainSeparationRule;
        let ast = syn::parse_file(code_with_domain).unwrap();
        let violations = rule.check(&ast.items);

        // Should have no critical violations for proper EIP-712
        let critical_violations: Vec<_> = violations
            .iter()
            .filter(|v| matches!(v.severity, ViolationSeverity::Critical))
            .collect();
        assert!(critical_violations.is_empty());
    }

    #[test]
    fn test_incomplete_domain_separation() {
        let code_incomplete_domain = r#"
            fn recoverSigner() {
                let ecrecover = "DOMAIN_TYPEHASH";
            }
        "#;

        let rule = MissingDomainSeparationRule;
        let ast = syn::parse_file(code_incomplete_domain).unwrap();
        let violations = rule.check(&ast.items);

        // Should detect missing domainSeparator computation
        let has_separator_issue = violations
            .iter()
            .any(|v| v.description.contains("Missing domainSeparator"));
        assert!(has_separator_issue);
    }

    #[test]
    fn test_chain_id_check() {
        let code_no_chainid = r#"
            fn recoverSigner() {
                let ecrecover = "DOMAIN_SEPARATOR";
            }
        "#;

        let rule = MissingDomainSeparationRule;
        let ast = syn::parse_file(code_no_chainid).unwrap();
        let violations = rule.check(&ast.items);

        let has_chainid_issue = violations
            .iter()
            .any(|v| v.description.contains("chain ID"));
        assert!(has_chainid_issue);
    }
}
