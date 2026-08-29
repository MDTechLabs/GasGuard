//! Soroban interface & call-safety rules
//!
//! This module implements the interface analysis and call-safety rules tracked by
//! issues #861-#864 under the "Stellar Wave" scope:
//!
//! - `soroban-unvalidated-contract-address`: detects contract addresses that are
//!   used without appropriate validation (#861).
//! - `soroban-unsafe-call-target`: detects dynamically selected contract call
//!   targets that are insufficiently constrained (#862).
//! - `soroban-interface-consistency`: analyzes public function interfaces for
//!   consistency and efficiency (#863).
//! - `soroban-inefficient-interface-params`: detects unnecessarily large or
//!   complex interface parameters (#864).
//!
//! The rules work on the AST-like structures produced by [`crate::soroban::SorobanParser`]
//! and align with the conventions used by the other rules in
//! `packages/rules/src/soroban/rule_engine.rs`.

use super::{SorobanContract, SorobanParam, SorobanRule};
use crate::{RuleViolation, ViolationSeverity};

/// Composite / container types that are expensive to serialize when passed across
/// a contract interface boundary.
const EXPENSIVE_INTERFACE_TYPES: &[&str] = &[
    "String", "Vec", "Map", "Set", "Bytes", "BytesN", "Option", "Result", "Address",
];

/// Container types whose presence on a public function signature indicates
/// potentially large / complex parameters.
const CONTAINER_TYPES: &[&str] = &["Vec", "Map", "Set", "Bytes", "BytesN"];

/// Contract-call entry points in the Soroban SDK. A target address that reaches
/// one of these without prior validation is a possible unsafe call target.
const INVOKE_PATTERNS: &[&str] = &[
    "invoke_contract",
    "invoke_contract_checked",
    "invoke_function",
    "call::<",
];

/// A violation helper that reduces boilerplate across the rules in this file.
fn violation(
    rule_name: &str,
    description: impl Into<String>,
    suggestion: impl Into<String>,
    variable_name: impl Into<String>,
    line_number: usize,
    severity: ViolationSeverity,
) -> RuleViolation {
    RuleViolation {
        rule_name: rule_name.to_string(),
        description: description.into(),
        suggestion: suggestion.into(),
        line_number,
        column_number: 0,
        variable_name: variable_name.into(),
        severity,
    }
}

/// True when a type signature refers to a composite / container type that is
/// expensive to (de)serialize on the Soroban ledger.
fn is_expensive_composite(type_name: &str) -> bool {
    EXPENSIVE_INTERFACE_TYPES
        .iter()
        .any(|t| type_name.contains(t) || type_name.contains(&t.to_lowercase()))
}

/// True when a type is an unbounded container (Vec/Map/Set/Bytes/BytesN).
fn is_container_type(type_name: &str) -> bool {
    CONTAINER_TYPES.iter().any(|t| type_name.contains(t))
}

/// True when the given parameter name is used verbatim in the `source`.
fn param_used(param: &SorobanParam, source: &str) -> bool {
    source.matches(param.name.as_str()).count() > 0
}

/// Detects contract addresses used without appropriate validation (#861).
///
/// Contract calls to addresses that originate from externally supplied input and
/// are used without an allow-list / validation step can cause calls to unintended
/// contracts. This rule flags `Address`-typed call targets that reach an invoke
/// pattern without a prior validation construct in the containing function.
pub struct UnvalidatedContractAddressRule {
    enabled: bool,
}

impl Default for UnvalidatedContractAddressRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for UnvalidatedContractAddressRule {
    fn id(&self) -> &str {
        "soroban-unvalidated-contract-address"
    }

    fn name(&self) -> &str {
        "Unvalidated Contract Address"
    }

    fn description(&self) -> &str {
        "Detects contract addresses used without appropriate validation"
    }

    fn severity(&self) -> ViolationSeverity {
        ViolationSeverity::High
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
            for function in &implementation.functions {
                // Only care about functions that actually invoke other contracts.
                if !INVOKE_PATTERNS
                    .iter()
                    .any(|p| function.raw_definition.contains(p))
                {
                    continue;
                }

                let source = &function.raw_definition;
                // Reject an empty allow-list / validation construct that precedes a call.
                let has_validation = source.contains("require_auth")
                    || source.contains("require_auth_for")
                    || source.contains("address_check")
                    || source.contains("is_contract")
                    || source.contains("expect_auth");

                for param in &function.params {
                    if param.type_name.contains("Address")
                        && param_used(param, source)
                        && !has_validation
                    {
                        violations.push(violation(
                            self.id(),
                            format!(
                                "Function '{}' invokes a contract at Address parameter '{}' without prior validation",
                                function.name, param.name
                            ),
                            "Validate the address against an allow-list or verify it is a contract before invoking it",
                            param.name.clone(),
                            function.line_number,
                            self.severity(),
                        ));
                    }
                }
            }
        }

        violations
    }
}

/// Detects dynamically selected contract call targets (#862).
///
/// Targets selected at runtime (rather than hard-coded constants) can introduce
/// unexpected execution paths. This rule tracks which public parameters flow into
/// invoke patterns and flags those that are not sufficiently constrained.
pub struct UnsafeCallTargetRule {
    enabled: bool,
}

impl Default for UnsafeCallTargetRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for UnsafeCallTargetRule {
    fn id(&self) -> &str {
        "soroban-unsafe-call-target"
    }

    fn name(&self) -> &str {
        "Unsafe Call Target"
    }

    fn description(&self) -> &str {
        "Detects dynamically selected contract call targets with insufficient validation"
    }

    fn severity(&self) -> ViolationSeverity {
        ViolationSeverity::High
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
            for function in &implementation.functions {
                let source = &function.raw_definition;
                if !INVOKE_PATTERNS.iter().any(|p| source.contains(p)) {
                    continue;
                }

                // A call target is "safe enough" when the function restricts its
                // behavior with an allow-list or an explicit authorization guard.
                let is_constrained = source.contains("require_auth")
                    || source.contains("require_auth_for")
                    || source.contains("is_contract")
                    || source.contains("address_check")
                    || source.contains("trusted")
                    || source.contains("allow");

                let dynamic_params: Vec<&SorobanParam> = function
                    .params
                    .iter()
                    .filter(|p| {
                        param_used(p, source)
                            && (p.type_name.contains("Address") || p.type_name.contains("BytesN"))
                    })
                    .collect();

                if dynamic_params.is_empty() {
                    continue;
                }

                // A require_auth / allow-list guard constrains the target regardless
                // of how many parameters the function takes, so skip constrained paths.
                if is_constrained {
                    continue;
                }

                for param in dynamic_params {
                    violations.push(violation(
                        self.id(),
                        format!(
                            "Function '{}' calls contract at runtime-selected parameter '{}'",
                            function.name, param.name
                        ),
                        "Constrain the call target with an allow-list or a require_auth guard before the invoke",
                        param.name.clone(),
                        function.line_number,
                        self.severity(),
                    ));
                }
            }
        }

        violations
    }
}

/// Analyzes Soroban contract interfaces for consistency and efficiency (#863).
///
/// Extracts the public surface (functions, parameters, return types) and flags
/// inconsistent patterns such as a missing return type on functions that modify
/// balances, enum-based dispatch, or errors returned via `panic!` instead of a
/// `Result`.
pub struct InterfaceConsistencyRule {
    enabled: bool,
}

impl Default for InterfaceConsistencyRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for InterfaceConsistencyRule {
    fn id(&self) -> &str {
        "soroban-interface-consistency"
    }

    fn name(&self) -> &str {
        "Interface Consistency"
    }

    fn description(&self) -> &str {
        "Analyzes contract interfaces for consistency and efficiency"
    }

    fn severity(&self) -> ViolationSeverity {
        ViolationSeverity::Info
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
            for function in &implementation.functions {
                // Functions that move value between parties should return a Result.
                let is_transfer = function.name.contains("transfer")
                    || function.name.contains("withdraw")
                    || function.name.contains("deposit")
                    || function.name.contains("mint")
                    || function.name.contains("burn")
                    || function.name.contains("claim");

                if is_transfer
                    && (function.return_type.is_none()
                        || !function.return_type.as_ref().unwrap().contains("Result"))
                {
                    violations.push(violation(
                        self.id(),
                        format!(
                            "Interface method '{}' mutates state but does not return a Result",
                            function.name
                        ),
                        "Return Result<T, Error> so callers can handle failures consistently",
                        function.name.clone(),
                        function.line_number,
                        ViolationSeverity::Medium,
                    ));
                }

                // A public interface that declares a return type but uses `panic!`
                // for error handling is less auditable than returning a Result.
                if function.return_type.is_some()
                    && function.raw_definition.contains("panic!")
                    && !function.return_type.as_ref().unwrap().contains("Result")
                {
                    violations.push(violation(
                        self.id(),
                        format!(
                            "Interface method '{}' relies on panic! for error handling",
                            function.name
                        ),
                        "Return Result<T, Error> instead of panicking to keep the interface auditable",
                        function.name.clone(),
                        function.line_number,
                        ViolationSeverity::Medium,
                    ));
                }
            }
        }

        violations
    }
}

/// Detects unnecessarily large or complex interface parameters (#864).
///
/// Large composite arguments increase serialization and resource costs on the
/// ledger. This rule inspects public function parameters for container / composite
/// types and flags them, while also detecting repeated parameter definitions.
pub struct InefficientInterfaceParamsRule {
    enabled: bool,
}

impl Default for InefficientInterfaceParamsRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for InefficientInterfaceParamsRule {
    fn id(&self) -> &str {
        "soroban-inefficient-interface-params"
    }

    fn name(&self) -> &str {
        "Inefficient Interface Parameters"
    }

    fn description(&self) -> &str {
        "Detects unnecessarily large or complex contract interface parameters"
    }

    fn severity(&self) -> ViolationSeverity {
        ViolationSeverity::Info
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
            for function in &implementation.functions {
                let composite_params: Vec<&SorobanParam> = function
                    .params
                    .iter()
                    .filter(|p| is_expensive_composite(&p.type_name))
                    .collect();

                for param in composite_params {
                    if is_container_type(&param.type_name) {
                        violations.push(violation(
                            self.id(),
                            format!(
                                "Parameter '{}' in '{}' is an unbounded container type '{}'",
                                param.name, function.name, param.type_name
                            ),
                            "Prefer bounded scalar types or pass data in smaller chunks to reduce serialization cost",
                            param.name.clone(),
                            function.line_number,
                            self.severity(),
                        ));
                    }
                }

                // Detect repeated / duplicated parameter names (a serialization & ABI hazard).
                let mut seen = std::collections::HashMap::new();
                for param in &function.params {
                    let count = seen.entry(param.name.clone()).or_insert(0usize);
                    *count += 1;
                }
                for (name, count) in seen {
                    if count > 1 {
                        violations.push(violation(
                            self.id(),
                            format!(
                                "Parameter '{}' in '{}' is declared {} times",
                                name, function.name, count
                            ),
                            "Rename duplicate parameters to keep the interface unambiguous",
                            name,
                            function.line_number,
                            ViolationSeverity::Medium,
                        ));
                    }
                }
            }
        }

        violations
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::soroban::SorobanParser;

    fn parse(source: &str) -> SorobanContract {
        SorobanParser::parse_contract(source, "test.rs").expect("contract should parse")
    }

    #[test]
    fn test_unvalidated_contract_address_detected() {
        let source = r#"
use soroban_sdk::{contract, contractimpl, Env, Address, Symbol};

#[contract]
pub struct Router;

#[contractimpl]
impl Router {
    pub fn swap(env: Env, target: Address) {
        // ❌ Uses the externally supplied address without validation
        env.invoke_contract(&target, &Symbol::new(&env, "swap"), ());
    }
}
"#;
        let contract = parse(source);
        let violations = UnvalidatedContractAddressRule::default().apply(&contract);
        assert!(
            violations
                .iter()
                .any(|v| v.rule_name == "soroban-unvalidated-contract-address"),
            "expected an unvalidated-address finding, got {:?}",
            violations
        );
    }

    #[test]
    fn test_unvalidated_contract_address_with_allowlist_ok() {
        let source = r#"
use soroban_sdk::{contract, contractimpl, Env, Address, Symbol};

#[contract]
pub struct Router;

#[contractimpl]
impl Router {
    pub fn swap(env: Env, target: Address) {
        target.require_auth_for(Symbol::new(&env, "swap"));
        // ✅ Validated before invoke; no finding expected.
        env.invoke_contract(&target, &Symbol::new(&env, "swap"), ());
    }
}
"#;
        let contract = parse(source);
        let violations = UnvalidatedContractAddressRule::default().apply(&contract);
        assert!(
            !violations
                .iter()
                .any(|v| v.rule_name == "soroban-unvalidated-contract-address"),
            "expected no unvalidated-address finding, got {:?}",
            violations
        );
    }

    #[test]
    fn test_unsafe_call_target_detected() {
        let source = r#"
use soroban_sdk::{contract, contractimpl, Env, Address, Symbol};

#[contract]
pub struct Router;

#[contractimpl]
impl Router {
    // ❌ Runtime-selected target with no allow-list / authorization guard.
    pub fn route(env: Env, target: Address, selector: Symbol) {
        env.invoke_contract(&target, &selector, ());
    }
}
"#;
        let contract = parse(source);
        let violations = UnsafeCallTargetRule::default().apply(&contract);
        assert!(
            violations
                .iter()
                .any(|v| v.rule_name == "soroban-unsafe-call-target"),
            "expected an unsafe-call-target finding, got {:?}",
            violations
        );
    }

    #[test]
    fn test_unsafe_call_target_constrained_ok() {
        let source = r#"
use soroban_sdk::{contract, contractimpl, Env, Address, Symbol};

#[contract]
pub struct Router;

#[contractimpl]
impl Router {
    // ✅ Authorized target: the guard constrains the runtime-selected call.
    pub fn route(env: Env, target: Address, selector: Symbol) {
        target.require_auth();
        env.invoke_contract(&target, &selector, ());
    }
}
"#;
        let contract = parse(source);
        let violations = UnsafeCallTargetRule::default().apply(&contract);
        // No violations should be emitted for the authorized single-target case.
        assert!(
            !violations
                .iter()
                .any(|v| v.rule_name == "soroban-unsafe-call-target"),
            "expected no unsafe-call-target finding, got {:?}",
            violations
        );
    }

    #[test]
    fn test_interface_consistency_missing_result_detected() {
        let source = r#"
use soroban_sdk::{contract, contractimpl, Env, Address, Vec};

#[contract]
pub struct Vault;

#[contractimpl]
impl Vault {
    // ❌ Mutates state but returns a bare value instead of Result<T, Error>.
    pub fn withdraw(env: Env, user: Address) -> Vec<i128> {
        env.events().publish((),
        ());
        Vec::new(&env)
    }
}
"#;
        let contract = parse(source);
        let violations = InterfaceConsistencyRule::default().apply(&contract);
        assert!(
            violations.iter().any(|v| {
                v.rule_name == "soroban-interface-consistency" && v.variable_name == "withdraw"
            }),
            "expected an interface-consistency finding on withdraw, got {:?}",
            violations
        );
    }

    #[test]
    fn test_interface_consistency_result_ok() {
        let source = r#"
use soroban_sdk::{contract, contractimpl, Env, Address};

#[contract]
pub struct Vault;

#[contractimpl]
impl Vault {
    // ✅ Returns Result<T, Error> with proper error handling.
    pub fn withdraw(env: Env, user: Address) -> Result<(), VaultError> {
        user.require_auth();
        Ok(())
    }
}
"#;
        let contract = parse(source);
        let violations = InterfaceConsistencyRule::default().apply(&contract);
        assert!(
            !violations.iter().any(|v| v.variable_name == "withdraw"),
            "expected no finding on withdraw, got {:?}",
            violations
        );
    }

    #[test]
    fn test_inefficient_interface_params_detected() {
        let source = r#"
use soroban_sdk::{contract, contractimpl, Env, Vec, Bytes};

#[contract]
pub struct Batch;

#[contractimpl]
impl Batch {
    // ❌ Unbounded composite params (Vec, Bytes) drive up serialization cost.
    pub fn execute(env: Env, ops: Vec<u8>, payload: Bytes) {
        env.events().publish((), ());
    }
}
"#;
        let contract = parse(source);
        let violations = InefficientInterfaceParamsRule::default().apply(&contract);
        assert!(
            violations
                .iter()
                .any(|v| v.rule_name == "soroban-inefficient-interface-params"),
            "expected an inefficient-interface-params finding, got {:?}",
            violations
        );
    }

    #[test]
    fn test_inefficient_interface_params_scalar_ok() {
        let source = r#"
use soroban_sdk::{contract, contractimpl, Env};

#[contract]
pub struct Counter;

#[contractimpl]
impl Counter {
    // ✅ Bounded scalar params; no finding expected.
    pub fn add(env: Env, a: u64, b: u64) -> u64 {
        a + b
    }
}
"#;
        let contract = parse(source);
        let violations = InefficientInterfaceParamsRule::default().apply(&contract);
        assert!(
            !violations
                .iter()
                .any(|v| v.rule_name == "soroban-inefficient-interface-params"),
            "expected no inefficient-interface-params finding, got {:?}",
            violations
        );
    }
}
