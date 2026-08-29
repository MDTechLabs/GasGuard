//! Rule: Detect Inefficient Bytes Allocation
//!
//! Repeated construction of `Bytes` objects (e.g. `Bytes::from_array`,
//! `Bytes::from_slice`, `bytes!`) inside functions or loops adds unnecessary
//! allocation overhead on every invocation.  In Soroban, host-object
//! allocations are metered; each redundant construction burns CPU and memory
//! budget that could be avoided by hoisting the value to a constant or
//! reusing a previously constructed instance.
//!
//! ## What this rule detects
//!
//! * Multiple `Bytes::from_array(…)` / `Bytes::from_slice(…)` calls in the
//!   same function body.
//! * `bytes!(…)` macro invocations that appear more than once with the same
//!   literal content (repeated construction of identical byte sequences).
//! * Any `Bytes` construction inside a loop body (`for`, `while`, `loop`).
//!
//! ## Suggested fix
//!
//! Hoist the `Bytes` value outside the loop / function, store it in a local
//! variable before the first use, and pass a reference or clone only when
//! the SDK requires ownership.

use crate::soroban::rule_engine::SorobanRule;
use crate::soroban::{SorobanContract, SorobanFunction, SorobanImpl};
use crate::{RuleViolation, ViolationSeverity};

// ---------------------------------------------------------------------------
// Patterns that indicate a Bytes construction
// ---------------------------------------------------------------------------

/// All source-level patterns that construct a new `Bytes` host object.
const BYTES_CTOR_PATTERNS: &[&str] = &[
    "Bytes::from_array(",
    "Bytes::from_slice(",
    "Bytes::new(",
    "bytes!(",
    "BytesN::from_array(",
    "BytesN::new(",
];

/// Keywords that indicate the start of a loop body.
const LOOP_KEYWORDS: &[&str] = &["for ", "while ", "loop {"];

// ---------------------------------------------------------------------------
// Rule struct
// ---------------------------------------------------------------------------

/// Detects unnecessary `Bytes` / `BytesN` allocations in Soroban contracts.
pub struct InefficientBytesAllocationRule {
    enabled: bool,
}

impl Default for InefficientBytesAllocationRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

// ---------------------------------------------------------------------------
// SorobanRule implementation
// ---------------------------------------------------------------------------

impl SorobanRule for InefficientBytesAllocationRule {
    fn id(&self) -> &str {
        "soroban-inefficient-bytes-allocation"
    }

    fn name(&self) -> &str {
        "Inefficient Bytes Allocation"
    }

    fn description(&self) -> &str {
        "Detects repeated Bytes/BytesN construction that increases execution overhead. \
         Each host-object allocation is metered in Soroban; constructing the same \
         byte sequence multiple times wastes CPU and memory budget."
    }

    fn severity(&self) -> ViolationSeverity {
        ViolationSeverity::Medium
    }

    fn is_enabled(&self) -> bool {
        self.enabled
    }

    fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }

    fn apply(&self, contract: &SorobanContract) -> Vec<RuleViolation> {
        let mut violations = Vec::new();

        for implementation in &contract.implementations {
            violations.extend(self.check_implementation(implementation));
        }

        violations
    }
}

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

impl InefficientBytesAllocationRule {
    /// Analyse every function in an `impl` block.
    fn check_implementation(&self, implementation: &SorobanImpl) -> Vec<RuleViolation> {
        let mut violations = Vec::new();

        for function in &implementation.functions {
            violations.extend(self.check_function(function));
        }

        violations
    }

    /// Analyse a single function for inefficient `Bytes` allocation patterns.
    fn check_function(&self, function: &SorobanFunction) -> Vec<RuleViolation> {
        let mut violations = Vec::new();
        let src = &function.raw_definition;

        // ── 1. Repeated construction (≥ 2 calls in the same function) ──────
        let total_ctor_calls: usize = BYTES_CTOR_PATTERNS
            .iter()
            .map(|pat| src.matches(pat).count())
            .sum();

        if total_ctor_calls >= 2 {
            violations.push(RuleViolation {
                rule_name: self.id().to_string(),
                description: format!(
                    "Function '{}' constructs Bytes/BytesN {} time(s). \
                     Repeated allocation increases execution overhead.",
                    function.name, total_ctor_calls
                ),
                suggestion: "Construct the Bytes value once, store it in a local variable, \
                             and reuse it throughout the function. \
                             Example: `let data = Bytes::from_array(&env, &[1, 2, 3]); \
                             // reuse `data` instead of re-constructing`"
                    .to_string(),
                line_number: function.line_number,
                column_number: 0,
                variable_name: function.name.clone(),
                severity: self.severity(),
            });
        }

        // ── 2. Bytes construction inside a loop ──────────────────────────────
        if self.has_bytes_in_loop(src) {
            violations.push(RuleViolation {
                rule_name: self.id().to_string(),
                description: format!(
                    "Function '{}' constructs Bytes/BytesN inside a loop. \
                     Each iteration allocates a new host object, multiplying overhead.",
                    function.name
                ),
                suggestion: "Hoist the Bytes construction above the loop. \
                             If the content varies per iteration, consider building \
                             a single buffer and mutating it, or pre-allocating with \
                             `Bytes::new(&env)` and appending only the changing parts."
                    .to_string(),
                line_number: function.line_number,
                column_number: 0,
                variable_name: function.name.clone(),
                severity: ViolationSeverity::High,
            });
        }

        violations
    }

    /// Returns `true` when a `Bytes` constructor call appears inside a loop
    /// body in the given source snippet.
    ///
    /// Strategy: scan line-by-line, track whether we are inside a loop block
    /// via brace depth, and flag any constructor pattern found there.
    fn has_bytes_in_loop(&self, src: &str) -> bool {
        let mut loop_brace_depth: i32 = 0; // depth at which the loop opened
        let mut current_depth: i32 = 0;
        let mut inside_loop = false;

        for line in src.lines() {
            let trimmed = line.trim();

            // Detect loop start
            let starts_loop = LOOP_KEYWORDS
                .iter()
                .any(|kw| trimmed.starts_with(kw) || trimmed.contains(kw));

            // Count braces on this line
            let open_braces = trimmed.chars().filter(|&c| c == '{').count() as i32;
            let close_braces = trimmed.chars().filter(|&c| c == '}').count() as i32;

            if starts_loop && !inside_loop {
                inside_loop = true;
                loop_brace_depth = current_depth + open_braces;
            }

            current_depth += open_braces - close_braces;

            // Check if we have exited the loop block
            if inside_loop && current_depth < loop_brace_depth {
                inside_loop = false;
            }

            // Flag any Bytes construction found while inside a loop
            if inside_loop {
                let has_ctor = BYTES_CTOR_PATTERNS.iter().any(|pat| trimmed.contains(pat));
                if has_ctor {
                    return true;
                }
            }
        }

        false
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::soroban::parser::SorobanParser;

    fn rule() -> InefficientBytesAllocationRule {
        InefficientBytesAllocationRule::default()
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    fn violations_for(source: &str) -> Vec<RuleViolation> {
        let contract = SorobanParser::parse_contract(source, "test.rs").expect("parse failed");
        rule().apply(&contract)
    }

    fn has_violation(violations: &[RuleViolation], fn_name: &str) -> bool {
        violations.iter().any(|v| {
            v.rule_name == "soroban-inefficient-bytes-allocation" && v.variable_name == fn_name
        })
    }

    // ── rule metadata ────────────────────────────────────────────────────────

    #[test]
    fn test_rule_metadata() {
        let r = rule();
        assert_eq!(r.id(), "soroban-inefficient-bytes-allocation");
        assert_eq!(r.name(), "Inefficient Bytes Allocation");
        assert!(r.is_enabled());
        assert!(matches!(r.severity(), ViolationSeverity::Medium));
    }

    #[test]
    fn test_rule_can_be_disabled() {
        let mut r = rule();
        r.set_enabled(false);
        assert!(!r.is_enabled());
    }

    // ── repeated construction ────────────────────────────────────────────────

    #[test]
    fn test_detects_repeated_bytes_from_array() {
        let source = r#"
#[contracttype]
pub struct MyContract {
    pub admin: soroban_sdk::Address,
}

#[contractimpl]
impl MyContract {
    pub fn compare(env: soroban_sdk::Env) -> bool {
        let a = Bytes::from_array(&env, &[1u8, 2, 3]);
        let b = Bytes::from_array(&env, &[1u8, 2, 3]);
        a == b
    }
}
"#;
        let violations = violations_for(source);
        assert!(
            has_violation(&violations, "compare"),
            "Expected violation for repeated Bytes::from_array, got: {:?}",
            violations
        );
    }

    #[test]
    fn test_detects_repeated_bytes_macro() {
        let source = r#"
#[contracttype]
pub struct MyContract {
    pub admin: soroban_sdk::Address,
}

#[contractimpl]
impl MyContract {
    pub fn hash_twice(env: soroban_sdk::Env) -> bool {
        let x = bytes!(&env, 0xdeadbeef);
        let y = bytes!(&env, 0xdeadbeef);
        x == y
    }
}
"#;
        let violations = violations_for(source);
        assert!(
            has_violation(&violations, "hash_twice"),
            "Expected violation for repeated bytes! macro, got: {:?}",
            violations
        );
    }

    #[test]
    fn test_detects_mixed_repeated_constructors() {
        let source = r#"
#[contracttype]
pub struct MyContract {
    pub admin: soroban_sdk::Address,
}

#[contractimpl]
impl MyContract {
    pub fn process(env: soroban_sdk::Env) -> u32 {
        let a = Bytes::from_slice(&env, &[0u8; 32]);
        let b = Bytes::new(&env);
        a.len() + b.len()
    }
}
"#;
        let violations = violations_for(source);
        assert!(
            has_violation(&violations, "process"),
            "Expected violation for mixed Bytes constructors, got: {:?}",
            violations
        );
    }

    // ── single construction (no violation) ───────────────────────────────────

    #[test]
    fn test_no_violation_for_single_construction() {
        let source = r#"
#[contracttype]
pub struct MyContract {
    pub admin: soroban_sdk::Address,
}

#[contractimpl]
impl MyContract {
    pub fn build(env: soroban_sdk::Env) -> Bytes {
        Bytes::from_array(&env, &[1u8, 2, 3])
    }
}
"#;
        let violations = violations_for(source);
        assert!(
            !has_violation(&violations, "build"),
            "Should not flag a single Bytes construction, got: {:?}",
            violations
        );
    }

    #[test]
    fn test_no_violation_when_no_bytes_used() {
        let source = r#"
#[contracttype]
pub struct MyContract {
    pub admin: soroban_sdk::Address,
}

#[contractimpl]
impl MyContract {
    pub fn add(a: u64, b: u64) -> u64 {
        a + b
    }
}
"#;
        let violations = violations_for(source);
        assert!(
            !has_violation(&violations, "add"),
            "Should not flag a function with no Bytes usage, got: {:?}",
            violations
        );
    }

    // ── bytes inside loop ────────────────────────────────────────────────────

    #[test]
    fn test_detects_bytes_construction_inside_for_loop() {
        let source = r#"
#[contracttype]
pub struct MyContract {
    pub admin: soroban_sdk::Address,
}

#[contractimpl]
impl MyContract {
    pub fn batch(env: soroban_sdk::Env, n: u32) -> u32 {
        let mut count = 0u32;
        for _i in 0..n {
            let chunk = Bytes::from_array(&env, &[0u8; 8]);
            count += chunk.len();
        }
        count
    }
}
"#;
        let violations = violations_for(source);
        // Should flag both "repeated" (loop runs ≥1 time) and "inside loop"
        let loop_violation = violations.iter().any(|v| {
            v.rule_name == "soroban-inefficient-bytes-allocation"
                && v.variable_name == "batch"
                && v.description.contains("inside a loop")
        });
        assert!(
            loop_violation,
            "Expected loop-allocation violation for 'batch', got: {:?}",
            violations
        );
    }

    #[test]
    fn test_detects_bytes_construction_inside_while_loop() {
        let source = r#"
#[contracttype]
pub struct MyContract {
    pub admin: soroban_sdk::Address,
}

#[contractimpl]
impl MyContract {
    pub fn stream(env: soroban_sdk::Env, mut n: u32) -> u32 {
        let mut total = 0u32;
        while n > 0 {
            let buf = Bytes::new(&env);
            total += buf.len();
            n -= 1;
        }
        total
    }
}
"#;
        let violations = violations_for(source);
        let loop_violation = violations.iter().any(|v| {
            v.rule_name == "soroban-inefficient-bytes-allocation"
                && v.variable_name == "stream"
                && v.description.contains("inside a loop")
        });
        assert!(
            loop_violation,
            "Expected loop-allocation violation for 'stream', got: {:?}",
            violations
        );
    }

    // ── suggestion content ───────────────────────────────────────────────────

    #[test]
    fn test_suggestion_mentions_reuse() {
        let source = r#"
#[contracttype]
pub struct MyContract {
    pub admin: soroban_sdk::Address,
}

#[contractimpl]
impl MyContract {
    pub fn double_alloc(env: soroban_sdk::Env) -> bool {
        let a = Bytes::from_array(&env, &[1u8]);
        let b = Bytes::from_array(&env, &[2u8]);
        a.len() == b.len()
    }
}
"#;
        let violations = violations_for(source);
        let v = violations
            .iter()
            .find(|v| v.variable_name == "double_alloc")
            .expect("Expected a violation for double_alloc");

        assert!(
            v.suggestion.to_lowercase().contains("reuse")
                || v.suggestion.to_lowercase().contains("local variable"),
            "Suggestion should mention reuse or local variable, got: {}",
            v.suggestion
        );
    }

    // ── severity ─────────────────────────────────────────────────────────────

    #[test]
    fn test_loop_violation_is_high_severity() {
        let source = r#"
#[contracttype]
pub struct MyContract {
    pub admin: soroban_sdk::Address,
}

#[contractimpl]
impl MyContract {
    pub fn loopy(env: soroban_sdk::Env, n: u32) -> u32 {
        let mut s = 0u32;
        for _i in 0..n {
            let b = Bytes::from_array(&env, &[9u8]);
            s += b.len();
        }
        s
    }
}
"#;
        let violations = violations_for(source);
        let loop_v = violations
            .iter()
            .find(|v| v.variable_name == "loopy" && v.description.contains("inside a loop"))
            .expect("Expected loop violation");

        assert!(
            matches!(loop_v.severity, ViolationSeverity::High),
            "Loop allocation violation should be High severity"
        );
    }

    #[test]
    fn test_repeated_violation_is_medium_severity() {
        let source = r#"
#[contracttype]
pub struct MyContract {
    pub admin: soroban_sdk::Address,
}

#[contractimpl]
impl MyContract {
    pub fn twice(env: soroban_sdk::Env) -> bool {
        let a = Bytes::from_array(&env, &[1u8]);
        let b = Bytes::from_array(&env, &[2u8]);
        a == b
    }
}
"#;
        let violations = violations_for(source);
        let rep_v = violations
            .iter()
            .find(|v| v.variable_name == "twice" && v.description.contains("time(s)"))
            .expect("Expected repeated-allocation violation");

        assert!(
            matches!(rep_v.severity, ViolationSeverity::Medium),
            "Repeated allocation violation should be Medium severity"
        );
    }
}
