//! Detect Missing Circuit Breakers
//!
//! Flags contracts that lack emergency stop mechanisms (circuit breakers).
//! Without a pause system, the severity of security incidents increases.
//!
//! Detection strategy:
//! - Scan all AST items for common circuit breaker keywords.
//! - Flag cases where no pause logic is found in the entire contract.

use crate::rule_engine::{Rule, RuleViolation, ViolationSeverity};
use quote::ToTokens;
use syn::Item;

pub struct MissingCircuitBreakerRule;

impl MissingCircuitBreakerRule {
    /// Check if code contains pause-related logic by looking for common keywords
    fn has_pause_logic(code: &str) -> bool {
        let code_lower = code.to_lowercase();
        let keywords = vec![
            "pause",
            "paused",
            "is_paused",
            "whennotpaused",
            "pausable",
            "circuit_breaker",
            "circuitbreaker",
            "emergency",
            "halt",
            "stopped",
            "is_stopped",
        ];

        keywords.iter().any(|&keyword| code_lower.contains(keyword))
    }
}

impl Rule for MissingCircuitBreakerRule {
    fn name(&self) -> &str {
        "missing-circuit-breaker"
    }

    fn description(&self) -> &str {
        "Detects contracts lacking emergency stop mechanisms (circuit breakers). \
         Without a pause system, the severity of security incidents increases since admins cannot halt operations during an exploit."
    }

    fn check(&self, ast: &[Item]) -> Vec<RuleViolation> {
        let mut has_circuit_breaker = false;

        for item in ast {
            let token_str = item.to_token_stream().to_string();
            
            if Self::has_pause_logic(&token_str) {
                has_circuit_breaker = true;
                break;
            }
        }

        let mut violations = Vec::new();

        if !has_circuit_breaker {
            violations.push(RuleViolation {
                rule_name: self.name().to_string(),
                description: "Contract lacks an emergency stop mechanism (circuit breaker). \
                              This increases incident severity as operations cannot be halted during an exploit."
                    .to_string(),
                severity: ViolationSeverity::High,
                line_number: 0,
                column_number: 0,
                variable_name: "contract".to_string(),
                suggestion: "Implement a circuit breaker pattern (e.g., Pausable, is_paused state, or emergency halt function) \
                             to allow halting operations in case of an emergency."
                    .to_string(),
            });
        }

        violations
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use syn::parse_file;

    #[test]
    fn test_missing_circuit_breaker() {
        let code = r#"
            pub struct Token;
            impl Token {
                pub fn transfer() {
                    // Just a transfer
                }
            }
        "#;
        let ast = parse_file(code).unwrap();
        let rule = MissingCircuitBreakerRule;
        let violations = rule.check(&ast.items);

        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].severity, ViolationSeverity::High);
        assert!(violations[0].description.contains("emergency stop mechanism"));
    }

    #[test]
    fn test_has_circuit_breaker_rust() {
        let code = r#"
            pub struct Token;
            impl Token {
                fn require_not_paused(env: &Env) {
                    let is_paused: bool = env.storage().instance().get(&DataKey::Paused).unwrap_or(false);
                    if is_paused {
                        panic!("Contract is paused");
                    }
                }
                
                pub fn transfer() {
                    // transfer logic
                }
            }
        "#;
        let ast = parse_file(code).unwrap();
        let rule = MissingCircuitBreakerRule;
        let violations = rule.check(&ast.items);

        assert_eq!(violations.len(), 0);
    }

    #[test]
    fn test_has_circuit_breaker_solidity_pattern() {
        let code = r#"
            pub struct Token;
            impl Token {
                pub fn transfer() {
                    require(!paused, "Pausable: paused");
                }
            }
        "#;
        let ast = parse_file(code).unwrap();
        let rule = MissingCircuitBreakerRule;
        let violations = rule.check(&ast.items);

        assert_eq!(violations.len(), 0);
    }
    
    #[test]
    fn test_has_circuit_breaker_emergency_keyword() {
        let code = r#"
            pub struct Token;
            impl Token {
                pub fn trigger_emergency_stop() {
                    // stop everything
                }
            }
        "#;
        let ast = parse_file(code).unwrap();
        let rule = MissingCircuitBreakerRule;
        let violations = rule.check(&ast.items);

        assert_eq!(violations.len(), 0);
    }
}
