//! Soroban Authentication & Footprint Rules
//!
//! Issues #895, #896, #898, #894 - Auth flow, Redundant auth, Signature verification, and Footprint size rules.

use super::SorobanLintRule;
use crate::{RuleViolation, ViolationSeverity};

/// Rule #895: Analyze complex Soroban authentication flows
pub struct AuthFlowRule;

impl SorobanLintRule for AuthFlowRule {
    fn id(&self) -> &'static str {
        "soroban-auth-flow"
    }

    fn name(&self) -> &'static str {
        "Soroban Authentication Flow Analyzer"
    }

    fn description(&self) -> &'static str {
        "Analyzes authentication flows and warns against complex or multi-step auth chains"
    }

    fn severity(&self) -> ViolationSeverity {
        ViolationSeverity::High
    }

    fn check(&self, source: &str, file_path: &str) -> Option<Vec<RuleViolation>> {
        let mut violations = Vec::new();
        let lines: Vec<&str> = source.lines().collect();

        for (i, line) in lines.iter().enumerate() {
            if line.contains("pub fn") {
                let func_window = lines
                    .iter()
                    .skip(i)
                    .take(30)
                    .copied()
                    .collect::<Vec<_>>()
                    .join("\n");

                let auth_count = func_window.matches("require_auth").count();
                if auth_count >= 3 {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: format!(
                            "Function contains complex authentication flow with {} require_auth checks",
                            auth_count
                        ),
                        suggestion: "Consolidate authentication checks at function entry point to avoid complex execution paths."
                            .to_string(),
                        line_number: i + 1,
                        column_number: 0,
                        variable_name: file_path.to_string(),
                        severity: self.severity(),
                    });
                }
            }
        }

        if violations.is_empty() {
            None
        } else {
            Some(violations)
        }
    }
}

/// Rule #896: Detect unnecessary repeated authentication checks
pub struct RedundantAuthRule;

impl SorobanLintRule for RedundantAuthRule {
    fn id(&self) -> &'static str {
        "soroban-redundant-auth"
    }

    fn name(&self) -> &'static str {
        "Detect Unnecessary Authentication Checks"
    }

    fn description(&self) -> &'static str {
        "Detects redundant require_auth() calls on identical targets within the same execution context"
    }

    fn severity(&self) -> ViolationSeverity {
        ViolationSeverity::Medium
    }

    fn check(&self, source: &str, file_path: &str) -> Option<Vec<RuleViolation>> {
        let mut violations = Vec::new();
        let lines: Vec<&str> = source.lines().collect();

        for (i, line) in lines.iter().enumerate() {
            if line.contains("require_auth()") {
                let window = lines
                    .iter()
                    .skip(i + 1)
                    .take(15)
                    .copied()
                    .collect::<Vec<_>>()
                    .join("\n");

                let target_part = line.split('.').next().unwrap_or("").trim();

                if !target_part.is_empty() && window.contains(&format!("{}.require_auth()", target_part)) {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: format!(
                            "Redundant require_auth() check detected on target '{}'",
                            target_part
                        ),
                        suggestion: "Remove duplicate require_auth() invocation as target is already authenticated in this scope."
                            .to_string(),
                        line_number: i + 1,
                        column_number: 0,
                        variable_name: file_path.to_string(),
                        severity: self.severity(),
                    });
                }
            }
        }

        if violations.is_empty() {
            None
        } else {
            Some(violations)
        }
    }
}

/// Rule #898: Analyze signature verification patterns
pub struct SignatureVerificationRule;

impl SorobanLintRule for SignatureVerificationRule {
    fn id(&self) -> &'static str {
        "soroban-signature-verification"
    }

    fn name(&self) -> &'static str {
        "Soroban Signature Verification Analyzer"
    }

    fn description(&self) -> &'static str {
        "Detects signature verifications in loops or repeated verification on identical payloads"
    }

    fn severity(&self) -> ViolationSeverity {
        ViolationSeverity::High
    }

    fn check(&self, source: &str, file_path: &str) -> Option<Vec<RuleViolation>> {
        let mut violations = Vec::new();
        let lines: Vec<&str> = source.lines().collect();

        for (i, line) in lines.iter().enumerate() {
            if line.contains("for ") || line.contains("while ") {
                let window = lines
                    .iter()
                    .skip(i)
                    .take(15)
                    .copied()
                    .collect::<Vec<_>>()
                    .join("\n");

                if window.contains("ed25519_verify") || window.contains("verify_signature") || window.contains("crypto()") {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: "Signature verification detected inside a loop".to_string(),
                        suggestion: "Batch signature verifications or verify signatures outside the loop body to save CPU and gas."
                            .to_string(),
                        line_number: i + 1,
                        column_number: 0,
                        variable_name: file_path.to_string(),
                        severity: self.severity(),
                    });
                }
            }
        }

        if violations.is_empty() {
            None
        } else {
            Some(violations)
        }
    }
}

/// Rule #894: Warn on large storage footprint size
pub struct FootprintSizeRule;

impl SorobanLintRule for FootprintSizeRule {
    fn id(&self) -> &'static str {
        "soroban-footprint-size"
    }

    fn name(&self) -> &'static str {
        "Soroban Footprint Size Warning Rule"
    }

    fn description(&self) -> &'static str {
        "Warns when contract operations produce an unusually large storage footprint (reads/writes)"
    }

    fn severity(&self) -> ViolationSeverity {
        ViolationSeverity::Medium
    }

    fn check(&self, source: &str, file_path: &str) -> Option<Vec<RuleViolation>> {
        let mut violations = Vec::new();
        let lines: Vec<&str> = source.lines().collect();

        for (i, line) in lines.iter().enumerate() {
            if line.contains("pub fn") {
                let func_window = lines
                    .iter()
                    .skip(i)
                    .take(40)
                    .copied()
                    .collect::<Vec<_>>()
                    .join("\n");

                let storage_writes = func_window.matches(".set(").count() + func_window.matches(".put(").count();
                if storage_writes > 5 {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: format!(
                            "Function performs {} storage write operations creating a large footprint",
                            storage_writes
                        ),
                        suggestion: "Pack state fields into a single struct or split state writes across batched calls to limit footprint size."
                            .to_string(),
                        line_number: i + 1,
                        column_number: 0,
                        variable_name: file_path.to_string(),
                        severity: self.severity(),
                    });
                }
            }
        }

        if violations.is_empty() {
            None
        } else {
            Some(violations)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_auth_flow_rule_detects_complex_auth() {
        let source = r#"
pub fn complex_fn() {
    user.require_auth();
    admin.require_auth();
    owner.require_auth();
}
"#;
        let rule = AuthFlowRule;
        let violations = rule.check(source, "test.rs");
        assert!(violations.is_some());
    }

    #[test]
    fn test_redundant_auth_rule_detects_duplicate() {
        let source = r#"
pub fn duplicate_fn() {
    user.require_auth();
    let x = 1;
    user.require_auth();
}
"#;
        let rule = RedundantAuthRule;
        let violations = rule.check(source, "test.rs");
        assert!(violations.is_some());
    }

    #[test]
    fn test_signature_verification_rule_in_loop() {
        let source = r#"
pub fn loop_sig() {
    for sig in sigs.iter() {
        env.crypto().ed25519_verify(&pk, &msg, &sig);
    }
}
"#;
        let rule = SignatureVerificationRule;
        let violations = rule.check(source, "test.rs");
        assert!(violations.is_some());
    }

    #[test]
    fn test_footprint_size_rule_detects_heavy_writes() {
        let source = r#"
pub fn heavy_writes() {
    s.set(1); s.set(2); s.set(3); s.set(4); s.set(5); s.set(6);
}
"#;
        let rule = FootprintSizeRule;
        let violations = rule.check(source, "test.rs");
        assert!(violations.is_some());
    }
}
