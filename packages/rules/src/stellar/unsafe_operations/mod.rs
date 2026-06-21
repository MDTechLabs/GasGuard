//! Unsafe Operations Detection Rule
//!
//! Detects potentially unsafe operations in Soroban contracts that may
//! introduce security vulnerabilities or unexpected behavior.

use crate::stellar::linting::SorobanLintRule;
use crate::{RuleViolation, ViolationSeverity};

/// Rule to detect unsafe operations in Soroban contracts
pub struct UnsafeOperationsRule;

impl UnsafeOperationsRule {
    fn detect_panic_operations(source: &str, file_path: &str) -> Vec<RuleViolation> {
        let mut violations = Vec::new();
        let lines: Vec<&str> = source.lines().collect();

        for (i, line) in lines.iter().enumerate() {
            if line.contains(".unwrap(") && !line.contains("//")
            {
                violations.push(RuleViolation {
                    rule_name: "unsafe-unwrap".to_string(),
                    description: "Use of `.unwrap()` may cause contract panic on error".to_string(),
                    severity: ViolationSeverity::High,
                    line_number: i + 1,
                    column_number: 0,
                    variable_name: file_path.to_string(),
                    suggestion: "Replace `.unwrap()` with pattern matching or `.unwrap_or()` / `.unwrap_or_else()` with a safe fallback. Example: `value.unwrap_or(Default::default())`".to_string(),
                });
            }

            if line.contains(".expect(") && !line.contains("//")
            {
                violations.push(RuleViolation {
                    rule_name: "unsafe-expect".to_string(),
                    description: "Use of `.expect()` may cause contract panic with custom message".to_string(),
                    severity: ViolationSeverity::High,
                    line_number: i + 1,
                    column_number: 0,
                    variable_name: file_path.to_string(),
                    suggestion: "Replace `.expect()` with pattern matching. Example: `match value { Some(v) => v, None => return Err(Error::NotFound) }`".to_string(),
                });
            }

            let panic_patterns = ["panic!()", "unreachable!()", "todo!()", "unimplemented!()"];
            for pattern in &panic_patterns {
                if line.contains(pattern) && !line.contains("//")
                {
                    violations.push(RuleViolation {
                        rule_name: "unsafe-panic".to_string(),
                        description: format!("Use of `{}` will cause contract panic", pattern),
                        severity: ViolationSeverity::Critical,
                        line_number: i + 1,
                        column_number: 0,
                        variable_name: file_path.to_string(),
                        suggestion: "Avoid panic in contract code. Return proper error types instead. Example: `return Err(Error::Unexpected)`".to_string(),
                    });
                }
            }
        }

        violations
    }

    fn detect_unsafe_blocks(source: &str, file_path: &str) -> Vec<RuleViolation> {
        let mut violations = Vec::new();
        let lines: Vec<&str> = source.lines().collect();

        for (i, line) in lines.iter().enumerate() {
            let trimmed = line.trim();
            if trimmed == "unsafe {" || trimmed.starts_with("unsafe {") {
                violations.push(RuleViolation {
                    rule_name: "unsafe-block".to_string(),
                    description: "Use of `unsafe` block bypasses Rust safety guarantees".to_string(),
                    severity: ViolationSeverity::Critical,
                    line_number: i + 1,
                    column_number: 0,
                    variable_name: file_path.to_string(),
                    suggestion: "Avoid unsafe blocks in Soroban contracts. If absolutely necessary, isolate in a minimal helper and document safety invariants thoroughly.".to_string(),
                });
            }
        }

        violations
    }

    fn detect_unprotected_invoke(source: &str, file_path: &str) -> Vec<RuleViolation> {
        let mut violations = Vec::new();
        let lines: Vec<&str> = source.lines().collect();

        for (i, line) in lines.iter().enumerate() {
            if line.contains("invoke_contract") || line.contains("env.invoke()") {
                let context_start = i.saturating_sub(15);
                let context: Vec<&str> = lines.iter().skip(context_start).take(20).copied().collect();
                let context_str = context.join("\n");

                let has_auth = context_str.contains("require_auth")
                    || context_str.contains("require_auth_for")
                    || context_str.contains("check_auth")
                    || context_str.contains("authorize");

                if !has_auth {
                    violations.push(RuleViolation {
                        rule_name: "unprotected-invoke".to_string(),
                        description: "Contract invocation without prior authorization check".to_string(),
                        severity: ViolationSeverity::Critical,
                        line_number: i + 1,
                        column_number: 0,
                        variable_name: file_path.to_string(),
                        suggestion: "Add `require_auth()` or `require_auth_for()` before invoking external contracts to ensure proper authorization.".to_string(),
                    });
                }
            }
        }

        violations
    }

    fn detect_unchecked_arithmetic(source: &str, file_path: &str) -> Vec<RuleViolation> {
        let mut violations = Vec::new();
        let lines: Vec<&str> = source.lines().collect();

        for (i, line) in lines.iter().enumerate() {
            if line.contains("pub fn") {
                let func_lines: Vec<&str> = lines.iter().skip(i).take(30).copied().collect();
                let func_str = func_lines.join("\n");

                let has_arithmetic = func_str.contains(" + ") || func_str.contains(" - ")
                    || func_str.contains(" * ") || func_str.contains(" / ");

                if has_arithmetic {
                    let has_checked = func_str.contains("checked_")
                        || func_str.contains("overflowing_")
                        || func_str.contains("saturating_")
                        || func_str.contains(".wrapping_");

                    let has_u256 = func_str.contains("u256") || func_str.contains("i256")
                        || func_str.contains("BigInt");

                    if !has_checked && !has_u256 {
                        violations.push(RuleViolation {
                            rule_name: "unchecked-arithmetic".to_string(),
                            description: "Function uses raw arithmetic operations that may overflow".to_string(),
                            severity: ViolationSeverity::High,
                            line_number: i + 1,
                            column_number: 0,
                            variable_name: file_path.to_string(),
                            suggestion: "Use checked arithmetic methods: `a.checked_add(b).ok_or(Error::Overflow)?` or `a.saturating_add(b)` to prevent overflow panics.".to_string(),
                        });
                    }
                }
            }
        }

        violations
    }

    fn detect_unbounded_loops(source: &str, file_path: &str) -> Vec<RuleViolation> {
        let mut violations = Vec::new();
        let lines: Vec<&str> = source.lines().collect();

        for (i, line) in lines.iter().enumerate() {
            let trimmed = line.trim();
            if trimmed == "loop {" || trimmed.starts_with("loop ") {
                let context: Vec<&str> = lines.iter().skip(i).take(20).copied().collect();
                let context_str = context.join("\n");

                let has_break = context_str.contains("break") || context_str.contains("return");

                if !has_break {
                    violations.push(RuleViolation {
                        rule_name: "unbounded-loop".to_string(),
                        description: "Unbounded `loop` without break condition may cause gas exhaustion".to_string(),
                        severity: ViolationSeverity::High,
                        line_number: i + 1,
                        column_number: 0,
                        variable_name: file_path.to_string(),
                        suggestion: "Add a `break` condition or use bounded iteration (e.g., `for i in 0..max_iterations`). Consider Soroban's CPU instruction limit.".to_string(),
                    });
                }
            }
        }

        violations
    }
}

impl SorobanLintRule for UnsafeOperationsRule {
    fn id(&self) -> &'static str {
        "soroban-unsafe-operations"
    }

    fn name(&self) -> &'static str {
        "Soroban Unsafe Operations"
    }

    fn description(&self) -> &'static str {
        "Detects potentially unsafe operations including panic-prone code, unchecked arithmetic, unsafe blocks, unauthorized contract invocations, and unbounded loops."
    }

    fn severity(&self) -> ViolationSeverity {
        ViolationSeverity::Critical
    }

    fn check(&self, source: &str, file_path: &str) -> Option<Vec<RuleViolation>> {
        let mut violations = Vec::new();

        violations.extend(Self::detect_panic_operations(source, file_path));
        violations.extend(Self::detect_unsafe_blocks(source, file_path));
        violations.extend(Self::detect_unprotected_invoke(source, file_path));
        violations.extend(Self::detect_unchecked_arithmetic(source, file_path));
        violations.extend(Self::detect_unbounded_loops(source, file_path));

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
    fn test_detects_unwrap() {
        let rule = UnsafeOperationsRule;
        let source = r#"
use soroban_sdk::{contract, contractimpl, Env};

#[contractimpl]
impl MyContract {
    pub fn do_something(env: Env) {
        let value = storage.get(&env, &key).unwrap();
    }
}
"#;
        let violations = rule.check(source, "test.rs");
        assert!(violations.is_some());
        let violations = violations.unwrap();
        assert!(violations.iter().any(|v| v.rule_name == "unsafe-unwrap"));
    }

    #[test]
    fn test_detects_expect() {
        let rule = UnsafeOperationsRule;
        let source = r#"
use soroban_sdk::{contract, contractimpl, Env};

#[contractimpl]
impl MyContract {
    pub fn do_something(env: Env) {
        let value = some_result.expect("should exist");
    }
}
"#;
        let violations = rule.check(source, "test.rs");
        assert!(violations.is_some());
        let violations = violations.unwrap();
        assert!(violations.iter().any(|v| v.rule_name == "unsafe-expect"));
    }

    #[test]
    fn test_detects_panic() {
        let rule = UnsafeOperationsRule;
        let source = r#"
use soroban_sdk::{contract, contractimpl, Env};

#[contractimpl]
impl MyContract {
    pub fn do_something(env: Env) {
        panic!("unexpected");
    }
}
"#;
        let violations = rule.check(source, "test.rs");
        assert!(violations.is_some());
        let violations = violations.unwrap();
        assert!(violations.iter().any(|v| v.rule_name == "unsafe-panic"));
    }

    #[test]
    fn test_detects_unreachable() {
        let rule = UnsafeOperationsRule;
        let source = r#"
use soroban_sdk::{contract, contractimpl, Env};

#[contractimpl]
impl MyContract {
    pub fn do_something(env: Env) {
        unreachable!();
    }
}
"#;
        let violations = rule.check(source, "test.rs");
        assert!(violations.is_some());
        let violations = violations.unwrap();
        assert!(violations.iter().any(|v| v.rule_name == "unsafe-panic"));
    }

    #[test]
    fn test_detects_unsafe_block() {
        let rule = UnsafeOperationsRule;
        let source = r#"
use soroban_sdk::{contract, contractimpl, Env};

#[contractimpl]
impl MyContract {
    pub fn do_something(env: Env) {
        unsafe {
            let ptr = &raw_val as *const u64;
        }
    }
}
"#;
        let violations = rule.check(source, "test.rs");
        assert!(violations.is_some());
        let violations = violations.unwrap();
        assert!(violations.iter().any(|v| v.rule_name == "unsafe-block"));
    }

    #[test]
    fn test_detects_unprotected_invoke() {
        let rule = UnsafeOperationsRule;
        let source = r#"
use soroban_sdk::{contract, contractimpl, Env, Address};

#[contractimpl]
impl MyContract {
    pub fn call_other(env: Env, contract: Address, amount: u64) {
        env.invoke_contract(&contract, "transfer", (amount,));
    }
}
"#;
        let violations = rule.check(source, "test.rs");
        assert!(violations.is_some());
        let violations = violations.unwrap();
        assert!(violations.iter().any(|v| v.rule_name == "unprotected-invoke"));
    }

    #[test]
    fn test_does_not_flag_protected_invoke() {
        let rule = UnsafeOperationsRule;
        let source = r#"
use soroban_sdk::{contract, contractimpl, Env, Address};

#[contractimpl]
impl MyContract {
    pub fn call_other(env: Env, contract: Address, amount: u64) {
        contract.require_auth();
        env.invoke_contract(&contract, "transfer", (amount,));
    }
}
"#;
        let violations = rule.check(source, "test.rs");
        if let Some(viols) = violations {
            let invoke_violations: Vec<_> = viols.iter().filter(|v| v.rule_name == "unprotected-invoke").collect();
            assert!(invoke_violations.is_empty());
        }
    }

    #[test]
    fn test_detects_unchecked_arithmetic() {
        let rule = UnsafeOperationsRule;
        let source = r#"
use soroban_sdk::{contract, contractimpl, Env};

#[contractimpl]
impl MyContract {
    pub fn add_values(env: Env, a: u64, b: u64) -> u64 {
        a + b
    }
}
"#;
        let violations = rule.check(source, "test.rs");
        assert!(violations.is_some());
        let violations = violations.unwrap();
        assert!(violations.iter().any(|v| v.rule_name == "unchecked-arithmetic"));
    }

    #[test]
    fn test_does_not_flag_checked_arithmetic() {
        let rule = UnsafeOperationsRule;
        let source = r#"
use soroban_sdk::{contract, contractimpl, Env};

#[contractimpl]
impl MyContract {
    pub fn add_values(env: Env, a: u64, b: u64) -> u64 {
        a.checked_add(b).unwrap_or(0)
    }
}
"#;
        let violations = rule.check(source, "test.rs");
        if let Some(viols) = violations {
            let arith_violations: Vec<_> = viols.iter().filter(|v| v.rule_name == "unchecked-arithmetic").collect();
            assert!(arith_violations.is_empty());
        }
    }

    #[test]
    fn test_safe_contract_no_violations() {
        let rule = UnsafeOperationsRule;
        let source = r#"
use soroban_sdk::{contract, contractimpl, Env, Address};

#[contractimpl]
impl MyContract {
    pub fn safe_op(env: Env, a: u64, b: u64) -> u64 {
        a.checked_add(b).unwrap_or(0)
    }
}
"#;
        let violations = rule.check(source, "test.rs");
        assert!(violations.is_none());
    }
}
