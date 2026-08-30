//! Soroban-specific rule engine
//!
//! This module provides a specialized rule engine for analyzing Soroban smart contracts
//! with rules tailored to Soroban's unique characteristics and gas optimization patterns.

use super::{
    memory::InefficientBytesAllocationRule, InefficientInterfaceParamsRule,
    InterfaceConsistencyRule, SorobanAnalyzer, SorobanContract, SorobanFunction,
    SorobanParser, SorobanResult, UnsafeCallTargetRule,
    UnvalidatedContractAddressRule,
};
use crate::soroban::storage::{SorobanLedgerReadCostRule, SorobanLedgerWriteCostRule};
use crate::{RuleViolation, ViolationSeverity};
use std::collections::HashMap;

/// Soroban-specific rule engine
pub struct SorobanRuleEngine {
    /// Active rules in the engine
    rules: HashMap<String, Box<dyn SorobanRule>>,
    /// Whether to enable all rules by default
    enable_all_by_default: bool,
}

impl SorobanRuleEngine {
    /// Create a new Soroban rule engine with default rules
    pub fn with_default_rules() -> Self {
        let mut engine = Self::new();
        engine.add_default_rules();
        engine
    }

    /// Create a new empty Soroban rule engine
    pub fn new() -> Self {
        Self {
            rules: HashMap::new(),
            enable_all_by_default: true,
        }
    }

    /// Add a rule to the engine
    pub fn add_rule<R: SorobanRule + 'static>(&mut self, rule: R) -> &mut Self {
        self.rules.insert(rule.id().to_string(), Box::new(rule));
        self
    }

    /// Add all default Soroban rules
    fn add_default_rules(&mut self) {
        self.add_rule(UnusedStateVariablesRule::default())
            .add_rule(InefficientStorageAccessRule::default())
            .add_rule(UnboundedLoopRule::default())
            .add_rule(ExpensiveStringOperationsRule::default())
            .add_rule(MissingConstructorRule::default())
            .add_rule(AdminPatternRule::default())
            .add_rule(InefficientIntegerTypesRule::default())
            .add_rule(MissingErrorHandlingRule::default())
            .add_rule(InefficientBytesAllocationRule::default())
            .add_rule(SorobanLedgerReadCostRule::default())
            .add_rule(SorobanLedgerWriteCostRule::default())
            .add_rule(EmergencyWithdrawalRule::default())
            .add_rule(GovernanceVotingRule::default())
            .add_rule(ClaimExpirationRule::default())    // #117
            .add_rule(AntiFrontRunningRule::default())   // #118
            .add_rule(SecureRandomnessRule::default())   // #119
            .add_rule(UpgradeVersionTrackingRule::default()) // #123
            // Stellar Wave interface & call-safety rules (#861, #862, #863, #864)
            .add_rule(UnvalidatedContractAddressRule::default()) // #861
            .add_rule(UnsafeCallTargetRule::default())           // #862
            .add_rule(InterfaceConsistencyRule::default())      // #863
            .add_rule(InefficientInterfaceParamsRule::default()); // #864
    }

    /// Analyze Soroban contract source code
    pub fn analyze(&self, source: &str, file_path: &str) -> SorobanResult<Vec<RuleViolation>> {
        // Parse the contract
        let contract = SorobanParser::parse_contract(source, file_path)?;

        // Run analysis
        let violations = SorobanAnalyzer::analyze_contract(&contract);

        // Apply active rules
        let mut all_violations = violations;
        for rule in self.rules.values() {
            if rule.is_enabled() {
                all_violations.extend(rule.apply(&contract));
            }
        }

        Ok(all_violations)
    }

    /// Get all registered rules
    pub fn get_rules(&self) -> Vec<&dyn SorobanRule> {
        self.rules.values().map(|r| r.as_ref()).collect()
    }

    /// Enable or disable a specific rule
    pub fn set_rule_enabled(&mut self, rule_id: &str, enabled: bool) {
        if let Some(rule) = self.rules.get_mut(rule_id) {
            rule.set_enabled(enabled);
        }
    }
}

/// Trait for Soroban-specific rules
pub trait SorobanRule: Send + Sync {
    /// Unique identifier for the rule
    fn id(&self) -> &str;

    /// Human-readable name of the rule
    fn name(&self) -> &str;

    /// Description of what the rule checks for
    fn description(&self) -> &str;

    /// Severity level of violations from this rule
    fn severity(&self) -> ViolationSeverity;

    /// Whether this rule is currently enabled
    fn is_enabled(&self) -> bool;

    /// Enable or disable the rule
    fn set_enabled(&mut self, enabled: bool);

    /// Apply the rule to a parsed Soroban contract
    fn apply(&self, contract: &SorobanContract) -> Vec<RuleViolation>;
}

/// Rule for detecting unused state variables
pub struct UnusedStateVariablesRule {
    enabled: bool,
}

impl Default for UnusedStateVariablesRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for UnusedStateVariablesRule {
    fn id(&self) -> &str {
        "soroban-unused-state-variables"
    }

    fn name(&self) -> &str {
        "Unused State Variables"
    }

    fn description(&self) -> &str {
        "Detects state variables that are declared but never used"
    }

    fn severity(&self) -> ViolationSeverity {
        ViolationSeverity::Warning
    }

    fn is_enabled(&self) -> bool {
        self.enabled
    }

    fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }

    fn apply(&self, contract: &SorobanContract) -> Vec<RuleViolation> {
        let mut violations = Vec::new();

        for contract_type in &contract.contract_types {
            for field in &contract_type.fields {
                // Simple heuristic: Definition + Initialization = 2 occurrences.
                let occurrences = contract.source.matches(&field.name).count();
                if occurrences <= 2 {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: format!(
                            "State variable '{}' appears to be unused",
                            field.name
                        ),
                        suggestion: format!(
                            "Remove unused state variable '{}' to save ledger storage costs",
                            field.name
                        ),
                        line_number: field.line_number,
                        column_number: 0,
                        variable_name: field.name.clone(),
                        severity: self.severity(),
                    });
                }
            }
        }

        violations
    }
}

/// Rule for detecting inefficient storage access patterns
pub struct InefficientStorageAccessRule {
    enabled: bool,
}

impl Default for InefficientStorageAccessRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for InefficientStorageAccessRule {
    fn id(&self) -> &str {
        "soroban-inefficient-storage"
    }

    fn name(&self) -> &str {
        "Inefficient Storage Access"
    }

    fn description(&self) -> &str {
        "Detects multiple reads/writes to the same storage key without caching"
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
            for function in &implementation.functions {
                let func_source = &function.raw_definition;

                // Count storage operations
                let get_count = func_source.matches(".get(").count();
                let set_count = func_source.matches(".set(").count();
                let load_count = func_source.matches(".load(").count();
                let store_count = func_source.matches(".store(").count();

                let total_ops = get_count + set_count + load_count + store_count;

                // If there are many storage operations, flag for review
                if total_ops > 3 {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: format!("Function '{}' performs {} storage operations - consider caching", function.name, total_ops),
                        suggestion: "Cache frequently accessed storage values in local variables to reduce ledger interactions".to_string(),
                        line_number: function.line_number,
                        column_number: 0,
                        variable_name: function.name.clone(),
                        severity: self.severity(),
                    });
                }
            }
        }

        violations
    }
}

/// Rule for detecting unbounded loops
pub struct UnboundedLoopRule {
    enabled: bool,
}

impl Default for UnboundedLoopRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for UnboundedLoopRule {
    fn id(&self) -> &str {
        "soroban-unbounded-loop"
    }

    fn name(&self) -> &str {
        "Unbounded Loop Detection"
    }

    fn description(&self) -> &str {
        "Detects loops without clear termination conditions that could exhaust CPU limits"
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
                let func_source = &function.raw_definition;

                // Look for potentially unbounded loops
                if (func_source.contains("loop {")
                    || func_source.contains("while ")
                    || func_source.contains("for "))
                    && !(func_source.contains(".len()")
                        || func_source.contains("range(")
                        || func_source.contains(".."))
                {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: format!("Function '{}' contains potentially unbounded loop", function.name),
                        suggestion: "Ensure loops have clear termination conditions to prevent CPU limit exhaustion".to_string(),
                        line_number: function.line_number,
                        column_number: 0,
                        variable_name: function.name.clone(),
                        severity: self.severity(),
                    });
                }
            }
        }

        violations
    }
}

/// Rule for detecting expensive string operations
pub struct ExpensiveStringOperationsRule {
    enabled: bool,
}

impl Default for ExpensiveStringOperationsRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for ExpensiveStringOperationsRule {
    fn id(&self) -> &str {
        "soroban-expensive-strings"
    }

    fn name(&self) -> &str {
        "Expensive String Operations"
    }

    fn description(&self) -> &str {
        "Detects expensive string operations that increase gas/storage costs"
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
            for function in &implementation.functions {
                let func_source = &function.raw_definition;

                if func_source.contains(".to_string()")
                    || func_source.contains("String::from(")
                    || func_source.contains("format!(")
                {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: format!("Function '{}' uses expensive string operations", function.name),
                        suggestion: "Consider using Symbol or Bytes for fixed data, or minimize string operations to reduce gas costs".to_string(),
                        line_number: function.line_number,
                        column_number: 0,
                        variable_name: function.name.clone(),
                        severity: self.severity(),
                    });
                }
            }
        }

        violations
    }
}

/// Rule for detecting missing constructors
pub struct MissingConstructorRule {
    enabled: bool,
}

impl Default for MissingConstructorRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for MissingConstructorRule {
    fn id(&self) -> &str {
        "soroban-missing-constructor"
    }

    fn name(&self) -> &str {
        "Missing Constructor"
    }

    fn description(&self) -> &str {
        "Detects contracts without constructor functions for initialization"
    }

    fn severity(&self) -> ViolationSeverity {
        ViolationSeverity::Warning
    }

    fn is_enabled(&self) -> bool {
        self.enabled
    }

    fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }

    fn apply(&self, contract: &SorobanContract) -> Vec<RuleViolation> {
        let has_constructor = contract
            .implementations
            .iter()
            .any(|imp| imp.functions.iter().any(|f| f.is_constructor));

        if !has_constructor {
            vec![RuleViolation {
                rule_name: self.id().to_string(),
                description: "Contract lacks a constructor function for initialization".to_string(),
                suggestion: "Add a 'new' function that initializes the contract state properly"
                    .to_string(),
                line_number: 1,
                column_number: 0,
                variable_name: contract.name.clone(),
                severity: self.severity(),
            }]
        } else {
            Vec::new()
        }
    }
}

/// Rule for suggesting admin pattern
pub struct AdminPatternRule {
    enabled: bool,
}

impl Default for AdminPatternRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for AdminPatternRule {
    fn id(&self) -> &str {
        "soroban-admin-pattern"
    }

    fn name(&self) -> &str {
        "Admin Pattern Suggestion"
    }

    fn description(&self) -> &str {
        "Suggests adding admin/owner pattern for access control"
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
        let has_admin = contract.contract_types.iter().any(|ct| {
            ct.fields.iter().any(|f| {
                f.name.contains("admin")
                    || f.name.contains("owner")
                    || f.type_name.contains("Address")
            })
        });

        if !has_admin {
            vec![RuleViolation {
                rule_name: self.id().to_string(),
                description: "Consider adding an admin/owner field for access control".to_string(),
                suggestion: "Add an 'admin: Address' field to your contract state for administrative functions".to_string(),
                line_number: 1,
                column_number: 0,
                variable_name: contract.name.clone(),
                severity: self.severity(),
            }]
        } else {
            Vec::new()
        }
    }
}

/// Rule for detecting inefficient integer types
pub struct InefficientIntegerTypesRule {
    enabled: bool,
}

impl Default for InefficientIntegerTypesRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for InefficientIntegerTypesRule {
    fn id(&self) -> &str {
        "soroban-inefficient-integers"
    }

    fn name(&self) -> &str {
        "Inefficient Integer Types"
    }

    fn description(&self) -> &str {
        "Detects use of unnecessarily large integer types"
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

        for contract_type in &contract.contract_types {
            for field in &contract_type.fields {
                if field.type_name == "u128" || field.type_name == "i128" {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: format!("Field '{}' uses {} which may be unnecessarily large", field.name, field.type_name),
                        suggestion: "Consider using a smaller integer type like u64 or u32 if the range permits".to_string(),
                        line_number: field.line_number,
                        column_number: 0,
                        variable_name: field.name.clone(),
                        severity: self.severity(),
                    });
                }
            }
        }

        violations
    }
}

/// Rule for detecting missing error handling
pub struct MissingErrorHandlingRule {
    enabled: bool,
}

impl Default for MissingErrorHandlingRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for MissingErrorHandlingRule {
    fn id(&self) -> &str {
        "soroban-missing-error-handling"
    }

    fn name(&self) -> &str {
        "Missing Error Handling"
    }

    fn description(&self) -> &str {
        "Detects functions that should return Result but don't"
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
            for function in &implementation.functions {
                // Functions that modify state should return Result
                if (function.name.contains("transfer")
                    || function.name.contains("mint")
                    || function.name.contains("burn")
                    || function.name.contains("set"))
                    && (function.return_type.is_none()
                        || !function.return_type.as_ref().unwrap().contains("Result"))
                {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: format!("Function '{}' should return Result for proper error handling", function.name),
                        suggestion: "Return Result<(), Error> to properly handle operation failures and provide better error reporting".to_string(),
                        line_number: function.line_number,
                        column_number: 0,
                        variable_name: function.name.clone(),
                        severity: self.severity(),
                    });
                }
            }
        }

        violations
    }
}

/// Rule for detecting emergency withdrawal functions without authorization
pub struct EmergencyWithdrawalRule {
    enabled: bool,
}

impl Default for EmergencyWithdrawalRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for EmergencyWithdrawalRule {
    fn id(&self) -> &str {
        "soroban-emergency-withdrawal"
    }

    fn name(&self) -> &str {
        "Emergency Withdrawal Check"
    }

    fn description(&self) -> &str {
        "Detects emergency withdrawal functions lacking proper authorization or whitelist checks"
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
                let func_name = function.name.to_lowercase();

                // Identify emergency withdrawal functions
                if func_name.contains("emergency")
                    || func_name.contains("withdraw_all")
                    || func_name.contains("rescue")
                {
                    let source = &function.raw_definition;

                    if !source.contains("require_auth")
                        && !source.contains("authorize")
                        && !source.contains("panic!")
                    {
                        violations.push(RuleViolation {
                            rule_name: self.id().to_string(),
                            description: format!("Emergency function '{}' lacks authorization check", function.name),
                            suggestion: "Implement restrictive access control for emergency functions to prevent unauthorized fund depletion".to_string(),
                            line_number: function.line_number,
                            column_number: 0,
                            variable_name: function.name.clone(),
                            severity: self.severity(),
                        });
                    }
                }
            }
        }

        violations
    }
}

/// Rule for detecting governance voting functions without authorization
pub struct GovernanceVotingRule {
    enabled: bool,
}

impl Default for GovernanceVotingRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for GovernanceVotingRule {
    fn id(&self) -> &str {
        "soroban-governance-voting"
    }

    fn name(&self) -> &str {
        "Governance Voting Check"
    }

    fn description(&self) -> &str {
        "Detects voting functions that may be missing authorization checks or are structurally insecure"
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
                let func_name = function.name.to_lowercase();

                // Identify voting functions
                if func_name.contains("vote")
                    || func_name.contains("propose")
                    || func_name.contains("ballot")
                {
                    let source = &function.raw_definition;

                    // Check for authorization: require_auth() or authorize()
                    // Strip comment lines before checking to avoid false negatives
                    let non_comment_source: String = source
                        .lines()
                        .filter(|l| {
                            let t = l.trim();
                            !t.starts_with("//") && !t.starts_with("/*") && !t.starts_with("*")
                        })
                        .collect::<Vec<_>>()
                        .join("\n");
                    if !non_comment_source.contains("require_auth")
                        && !non_comment_source.contains("authorize")
                    {
                        violations.push(RuleViolation {
                            rule_name: self.id().to_string(),
                            description: format!("Governance function '{}' lacks explicit authorization check", function.name),
                            suggestion: "Add 'caller.require_auth()' or 'env.authorize()' to ensure only authorized users can perform governance actions".to_string(),
                            line_number: function.line_number,
                            column_number: 0,
                            variable_name: function.name.clone(),
                            severity: self.severity(),
                        });
                    }

                    // Check for timestamp/expiration usage in proposals (heuristic)
                    if func_name.contains("propose")
                        && !source.contains("timestamp")
                        && !source.contains("expiration")
                    {
                        violations.push(RuleViolation {
                            rule_name: self.id().to_string(),
                            description: format!("Governance function '{}' may be missing proposal expiration logic", function.name),
                            suggestion: "Proposals should have an expiration timestamp to prevent indefinite open voting".to_string(),
                            line_number: function.line_number,
                            column_number: 0,
                            variable_name: function.name.clone(),
                            severity: ViolationSeverity::Warning,
                        });
                    }
                }
            }
        }
        
        violations
    }
}

// ── Issue #779: Redundant Event Emissions ────────────────────────────────────

/// Detects duplicate `env.events().publish(...)` calls within the same function.
pub struct RedundantEventEmissionsRule {
    enabled: bool,
}

impl Default for RedundantEventEmissionsRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for RedundantEventEmissionsRule {
    fn id(&self) -> &str { "soroban-redundant-event-emissions" }
    fn name(&self) -> &str { "Redundant Event Emissions" }
    fn description(&self) -> &str {
        "Detects identical event emissions in the same function that waste transaction resources"
    }
    fn severity(&self) -> ViolationSeverity { ViolationSeverity::Medium }
    fn is_enabled(&self) -> bool { self.enabled }
    fn set_enabled(&mut self, enabled: bool) { self.enabled = enabled; }

    fn apply(&self, contract: &SorobanContract) -> Vec<RuleViolation> {
        let mut violations = Vec::new();
        for implementation in &contract.implementations {
            for function in &implementation.functions {
                let source = &function.raw_definition;
                let count = source.matches("env.events().publish").count();
                if count > 1 {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: format!(
                            "Function '{}' emits {} events — check for duplicates with identical topics/payloads",
                            function.name, count
                        ),
                        suggestion: "Consolidate duplicate event emissions into a single publish call to reduce resource overhead.".to_string(),
                        line_number: function.line_number,
                        column_number: 0,
                        variable_name: function.name.clone(),
                        severity: self.severity(),
                    });
                }
            }
        }
        violations
    }
}

// ── Issue #780: Authorization Cost Analyzer ──────────────────────────────────

/// Detects repeated or loop-embedded authorization checks.
pub struct AuthorizationCostRule {
    enabled: bool,
}

impl Default for AuthorizationCostRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for AuthorizationCostRule {
    fn id(&self) -> &str { "soroban-authorization-cost" }
    fn name(&self) -> &str { "Authorization Cost Analyzer" }
    fn description(&self) -> &str {
        "Detects repeated or loop-embedded authorization checks that inflate execution costs"
    }
    fn severity(&self) -> ViolationSeverity { ViolationSeverity::Medium }
    fn is_enabled(&self) -> bool { self.enabled }
    fn set_enabled(&mut self, enabled: bool) { self.enabled = enabled; }

    fn apply(&self, contract: &SorobanContract) -> Vec<RuleViolation> {
        let mut violations = Vec::new();
        for implementation in &contract.implementations {
            for function in &implementation.functions {
                let source = &function.raw_definition;
                let auth_count = source.matches("require_auth").count()
                    + source.matches("require_auth_for_args").count();

                // Flag functions with more than one distinct auth call
                if auth_count > 2 {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: format!(
                            "Function '{}' contains {} authorization checks — consider caching",
                            function.name, auth_count
                        ),
                        suggestion: "Perform a single authorization check at the top of the function and cache the result.".to_string(),
                        line_number: function.line_number,
                        column_number: 0,
                        variable_name: function.name.clone(),
                        severity: self.severity(),
                    });
                }

                // Flag auth inside loops
                let loop_keywords = ["for ", "while ", "loop {"];
                let has_loop = loop_keywords.iter().any(|kw| source.contains(kw));
                if has_loop && auth_count >= 1 {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: format!(
                            "Function '{}' performs authorization inside a loop",
                            function.name
                        ),
                        suggestion: "Move the authorization check outside the loop to avoid repeating it per iteration.".to_string(),
                        line_number: function.line_number,
                        column_number: 0,
                        variable_name: function.name.clone(),
                        severity: ViolationSeverity::High,
                    });
                }
            }
        }
        violations
    }
}

// ── Issue #781: Resource Budget Estimator ────────────────────────────────────

/// Reports an aggregated resource impact score based on detected pattern density.
pub struct ResourceBudgetEstimatorRule {
    enabled: bool,
    /// Threshold: if a function has more than this many storage + loop ops, warn.
    impact_threshold: usize,
}

impl Default for ResourceBudgetEstimatorRule {
    fn default() -> Self {
        Self { enabled: true, impact_threshold: 5 }
    }
}

impl SorobanRule for ResourceBudgetEstimatorRule {
    fn id(&self) -> &str { "soroban-resource-budget" }
    fn name(&self) -> &str { "Resource Budget Estimator" }
    fn description(&self) -> &str {
        "Aggregates detected patterns to estimate relative CPU, memory, ledger, and fee pressure"
    }
    fn severity(&self) -> ViolationSeverity { ViolationSeverity::Info }
    fn is_enabled(&self) -> bool { self.enabled }
    fn set_enabled(&mut self, enabled: bool) { self.enabled = enabled; }

    fn apply(&self, contract: &SorobanContract) -> Vec<RuleViolation> {
        let mut violations = Vec::new();
        for implementation in &contract.implementations {
            for function in &implementation.functions {
                let source = &function.raw_definition;

                let storage_ops = source.matches(".get(").count()
                    + source.matches(".set(").count()
                    + source.matches(".remove(").count();
                let loop_ops = source.matches("for ").count()
                    + source.matches("while ").count()
                    + source.matches("loop {").count();
                let event_ops = source.matches("events().publish").count();
                let auth_ops = source.matches("require_auth").count();

                let total = storage_ops + loop_ops + event_ops + auth_ops;
                if total >= self.impact_threshold {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: format!(
                            "Function '{}' has high resource pressure: {} storage op(s), {} loop(s), {} event(s), {} auth check(s)",
                            function.name, storage_ops, loop_ops, event_ops, auth_ops
                        ),
                        suggestion: "Review the function for combined CPU, ledger, and fee impact. Consider splitting into smaller, targeted operations.".to_string(),
                        line_number: function.line_number,
                        column_number: 0,
                        variable_name: function.name.clone(),
                        severity: self.severity(),
                    });
                }
            }
        }
        violations
    }
}

// ── Issue #782: Optimization Priority Engine ─────────────────────────────────

/// Assigns a priority tag to existing violations so callers can sort by impact.
/// This rule re-scores violations produced by other rules; here it surfaces
/// functions whose combined violation density is highest.
pub struct OptimizationPriorityRule {
    enabled: bool,
}

impl Default for OptimizationPriorityRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for OptimizationPriorityRule {
    fn id(&self) -> &str { "soroban-optimization-priority" }
    fn name(&self) -> &str { "Optimization Priority Engine" }
    fn description(&self) -> &str {
        "Ranks functions by optimization opportunity density to surface the highest-impact fixes first"
    }
    fn severity(&self) -> ViolationSeverity { ViolationSeverity::Info }
    fn is_enabled(&self) -> bool { self.enabled }
    fn set_enabled(&mut self, enabled: bool) { self.enabled = enabled; }

    fn apply(&self, contract: &SorobanContract) -> Vec<RuleViolation> {
        let mut violations = Vec::new();
        for implementation in &contract.implementations {
            // Build a simple density score per function
            let mut scored: Vec<(usize, &SorobanFunction)> = implementation
                .functions
                .iter()
                .map(|f| {
                    let src = &f.raw_definition;
                    let score = src.matches(".get(").count() * 2
                        + src.matches(".set(").count() * 2
                        + src.matches("for ").count() * 3
                        + src.matches("while ").count() * 3
                        + src.matches("require_auth").count() * 2
                        + src.matches("events().publish").count();
                    (score, f)
                })
                .collect();

            // Sort descending
            scored.sort_by(|a, b| b.0.cmp(&a.0));

            // Report the top function if its score is meaningful
            if let Some((score, top_fn)) = scored.first() {
                if *score >= 4 {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: format!(
                            "Function '{}' has the highest optimization priority in impl '{}' (score {})",
                            top_fn.name, implementation.target, score
                        ),
                        suggestion: "Address this function first: it has the greatest combined resource impact across storage, loops, events, and authorization.".to_string(),
                        line_number: top_fn.line_number,
                        column_number: 0,
                        variable_name: top_fn.name.clone(),
                        severity: self.severity(),
                    });
                }
            }
        }
        violations
    }
}

// ── Issue #783: Soroban Function Complexity Analyzer ─────────────────────────

/// Calculates cyclomatic complexity for Soroban functions and flags those
/// exceeding a configurable threshold.
pub struct SorobanFunctionComplexityRule {
    enabled: bool,
    /// Complexity threshold above which a warning is emitted.
    warning_threshold: usize,
    /// Complexity threshold above which a high-severity issue is emitted.
    high_threshold: usize,
}

impl Default for SorobanFunctionComplexityRule {
    fn default() -> Self {
        Self {
            enabled: true,
            warning_threshold: 7,
            high_threshold: 12,
        }
    }
}

impl SorobanRule for SorobanFunctionComplexityRule {
    fn id(&self) -> &str {
        "soroban-function-complexity"
    }

    fn name(&self) -> &str {
        "Soroban Function Complexity Analyzer"
    }

    fn description(&self) -> &str {
        "Calculates cyclomatic complexity and flags functions that are too complex, increasing audit cost and bug risk"
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
            for function in &implementation.functions {
                let complexity = Self::calculate_complexity(&function.raw_definition);

                if complexity >= self.high_threshold {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: format!(
                            "Function '{}' has very high cyclomatic complexity ({}) — refactor recommended",
                            function.name, complexity
                        ),
                        suggestion: "Break this function into smaller, single-responsibility functions to reduce complexity and improve testability".to_string(),
                        line_number: function.line_number,
                        column_number: 0,
                        variable_name: function.name.clone(),
                        severity: ViolationSeverity::High,
                    });
                } else if complexity >= self.warning_threshold {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: format!(
                            "Function '{}' has elevated cyclomatic complexity ({})",
                            function.name, complexity
                        ),
                        suggestion: "Consider simplifying control flow or extracting helper functions to reduce complexity".to_string(),
                        line_number: function.line_number,
                        column_number: 0,
                        variable_name: function.name.clone(),
                        severity: ViolationSeverity::Medium,
                    });
                }
            }
        }

        violations
    }
}

impl SorobanFunctionComplexityRule {
    /// Calculate cyclomatic complexity of a function body.
    /// Starts at 1 and increments for each decision point.
    fn calculate_complexity(source: &str) -> usize {
        let mut complexity: usize = 1;

        // Remove string literals and comments to avoid false positives
        let cleaned = Self::strip_strings_and_comments(source);

        // Count decision points
        complexity += Self::count_occurrences(&cleaned, "if ");
        complexity += Self::count_occurrences(&cleaned, "else if");
        complexity += Self::count_occurrences(&cleaned, "while ");
        complexity += Self::count_occurrences(&cleaned, "for ");
        complexity += Self::count_occurrences(&cleaned, "loop {");
        complexity += Self::count_occurrences(&cleaned, "match ");
        complexity += Self::count_occurrences(&cleaned, "&&");
        complexity += Self::count_occurrences(&cleaned, "||");
        complexity += Self::count_occurrences(&cleaned, "?");
        complexity += Self::count_occurrences(&cleaned, "unwrap_or");
        complexity += Self::count_occurrences(&cleaned, "unwrap_or_else");
        // Count match arms (patterns separated by =>)
        complexity += Self::count_occurrences(&cleaned, "=>");

        complexity
    }

    /// Strip string literals and comments from source to avoid counting
    /// keywords inside strings or comments.
    fn strip_strings_and_comments(source: &str) -> String {
        let mut result = String::with_capacity(source.len());
        let mut chars = source.chars().peekable();

        while let Some(ch) = chars.next() {
            match ch {
                // Skip line comments
                '/' if chars.peek() == Some(&'/') => {
                    while let Some(c) = chars.next() {
                        if c == '\n' {
                            result.push('\n');
                            break;
                        }
                    }
                }
                // Skip block comments
                '/' if chars.peek() == Some(&'*') => {
                    chars.next(); // consume '*'
                    while let Some(c) = chars.next() {
                        if c == '*' && chars.peek() == Some(&'/') {
                            chars.next();
                            break;
                        }
                    }
                }
                // Skip string literals
                '"' => {
                    while let Some(c) = chars.next() {
                        if c == '\\' {
                            chars.next(); // skip escaped char
                        } else if c == '"' {
                            break;
                        }
                    }
                    result.push('"');
                }
                _ => result.push(ch),
            }
        }

        result
    }

    /// Count non-overlapping occurrences of a pattern in text.
    fn count_occurrences(text: &str, pattern: &str) -> usize {
        if pattern.is_empty() {
            return 0;
        }
        text.match_indices(pattern).count()
    }
}

// ── Issue #784: Deep Soroban Control-Flow Nesting ────────────────────────────

/// Detects deeply nested control-flow structures that harm readability
/// and increase the risk of logic errors.
pub struct SorobanDeepNestingRule {
    enabled: bool,
    /// Maximum allowed nesting depth before flagging.
    max_depth: usize,
}

impl Default for SorobanDeepNestingRule {
    fn default() -> Self {
        Self {
            enabled: true,
            max_depth: 4,
        }
    }
}

impl SorobanRule for SorobanDeepNestingRule {
    fn id(&self) -> &str {
        "soroban-deep-nesting"
    }

    fn name(&self) -> &str {
        "Deep Soroban Control-Flow Nesting"
    }

    fn description(&self) -> &str {
        "Detects control-flow nesting beyond a safe threshold, which increases bug risk and audit difficulty"
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
            for function in &implementation.functions {
                let source = &function.raw_definition;
                let cleaned = SorobanFunctionComplexityRule::strip_strings_and_comments(source);
                let max_depth = Self::compute_max_nesting(&cleaned);

                if max_depth > self.max_depth {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: format!(
                            "Function '{}' has control-flow nesting depth of {} (max recommended: {})",
                            function.name, max_depth, self.max_depth
                        ),
                        suggestion: "Extract nested logic into helper functions or use early returns to flatten control flow".to_string(),
                        line_number: function.line_number,
                        column_number: 0,
                        variable_name: function.name.clone(),
                        severity: ViolationSeverity::Medium,
                    });
                }
            }
        }

        violations
    }
}

impl SorobanDeepNestingRule {
    /// Compute the maximum control-flow nesting depth in a function body.
    /// Tracks brace depth and identifies which brace levels contain control-flow keywords.
    fn compute_max_nesting(source: &str) -> usize {
        let control_keywords = ["if ", "for ", "while ", "loop {", "match "];
        let mut max_depth: usize = 0;
        let mut current_depth: usize = 0;
        let lines: Vec<&str> = source.lines().collect();

        for line in &lines {
            let trimmed = line.trim();

            // Skip empty lines
            if trimmed.is_empty() {
                continue;
            }

            // Count opening and closing braces on this line
            let open_braces = trimmed.matches('{').count();
            let close_braces = trimmed.matches('}').count();

            // Check if this line starts a control-flow construct
            let is_control = control_keywords.iter().any(|kw| trimmed.starts_with(kw))
                || (trimmed.starts_with("else") && trimmed.contains("if "))
                || trimmed.starts_with("else {");

            // Process closing braces first (they end the current scope)
            for _ in 0..close_braces {
                current_depth = current_depth.saturating_sub(1);
            }

            // If this is a control-flow line, record its nesting depth
            if is_control {
                // The depth is the current depth (inside the parent scope)
                if current_depth > max_depth {
                    max_depth = current_depth;
                }
                // The control structure itself adds one level for its body
                current_depth += 1;
            } else {
                // For non-control lines, opening braces increase depth
                for _ in 0..open_braces {
                    current_depth += 1;
                }
            }
        }

        max_depth
    }
}

// ── Issue #785: Repeated Soroban Computations ────────────────────────────────

/// Detects repeated identical computations within a function that could be
/// cached in a local variable to save CPU and ledger costs.
pub struct SorobanRepeatedComputationsRule {
    enabled: bool,
    /// Minimum occurrences before flagging.
    min_occurrences: usize,
    /// Minimum token length of an expression to consider.
    min_expr_length: usize,
}

impl Default for SorobanRepeatedComputationsRule {
    fn default() -> Self {
        Self {
            enabled: true,
            min_occurrences: 3,
            min_expr_length: 10,
        }
    }
}

impl SorobanRule for SorobanRepeatedComputationsRule {
    fn id(&self) -> &str {
        "soroban-repeated-computations"
    }

    fn name(&self) -> &str {
        "Repeated Soroban Computations"
    }

    fn description(&self) -> &str {
        "Detects identical expressions computed multiple times that could be cached to reduce CPU costs"
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
            for function in &implementation.functions {
                let source = &function.raw_definition;
                let repeated = Self::find_repeated_expressions(source, self.min_occurrences, self.min_expr_length);

                for expr in repeated {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: format!(
                            "Function '{}' repeats the computation `{}` multiple times — cache in a local variable",
                            function.name, expr
                        ),
                        suggestion: format!(
                            "Store the result of `{}` in a local variable and reuse it to avoid redundant computation",
                            expr
                        ),
                        line_number: function.line_number,
                        column_number: 0,
                        variable_name: function.name.clone(),
                        severity: ViolationSeverity::Medium,
                    });
                }
            }
        }

        violations
    }
}

impl SorobanRepeatedComputationsRule {
    /// Find expressions that appear multiple times in the function body.
    /// Extracts meaningful sub-expressions (method chains, function calls, field accesses).
    fn find_repeated_expressions(source: &str, min_occurrences: usize, min_length: usize) -> Vec<String> {
        let cleaned = SorobanFunctionComplexityRule::strip_strings_and_comments(source);
        let mut expr_counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();

        // Extract method chains and function calls as candidate expressions
        let lines: Vec<&str> = cleaned.lines().collect();

        for line in &lines {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with("//") {
                continue;
            }

            // Extract sub-expressions: look for patterns like `obj.method(...)` or `obj.field`
            let expressions = Self::extract_expressions(trimmed);

            for expr in expressions {
                if expr.len() >= min_length {
                    *expr_counts.entry(expr).or_insert(0) += 1;
                }
            }
        }

        expr_counts
            .into_iter()
            .filter(|(_, count)| *count >= min_occurrences)
            .map(|(expr, _)| expr)
            .collect()
    }

    /// Extract meaningful sub-expressions from a line of code.
    fn extract_expressions(line: &str) -> Vec<String> {
        let mut expressions = Vec::new();

        // Pattern: method chains like `env.storage().instance().get(&key)`
        // We extract progressively longer sub-chains
        let tokens: Vec<&str> = line.split_whitespace().collect();

        for token in &tokens {
            // Clean the token of trailing punctuation
            let clean = token.trim_end_matches(',').trim_end_matches(';').trim_end_matches(')');

            // Look for method chain patterns: word.word(...)
            if clean.contains('.') && clean.len() > 5 {
                // Extract the full chain
                expressions.push(clean.to_string());

                // Also extract sub-chains starting from each component
                let parts: Vec<&str> = clean.split('.').collect();
                if parts.len() >= 2 {
                    for i in 0..parts.len() - 1 {
                        let sub_chain = parts[i..].join(".");
                        if sub_chain.len() >= 8 {
                            expressions.push(sub_chain);
                        }
                    }
                }
            }
        }

        // Also extract parenthesized expressions
        let mut in_parens = false;
        let mut current_expr = String::new();
        for ch in line.chars() {
            if ch == '(' {
                if in_parens && !current_expr.is_empty() {
                    if current_expr.len() >= 8 {
                        expressions.push(current_expr.clone());
                    }
                }
                in_parens = true;
                current_expr.clear();
            } else if ch == ')' {
                if in_parens && current_expr.len() >= 8 {
                    expressions.push(current_expr.clone());
                }
                in_parens = false;
                current_expr.clear();
            } else if in_parens {
                current_expr.push(ch);
            }
        }

        expressions
    }
}

// ── Issue #786: Soroban Dead Code Detector ───────────────────────────────────

/// Detects unreachable code after terminating statements (return, panic!, break, continue).
pub struct SorobanDeadCodeRule {
    enabled: bool,
}

impl Default for SorobanDeadCodeRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for SorobanDeadCodeRule {
    fn id(&self) -> &str {
        "soroban-dead-code"
    }

    fn name(&self) -> &str {
        "Soroban Dead Code Detector"
    }

    fn description(&self) -> &str {
        "Detects unreachable code after return, panic!, break, or continue statements"
    }

    fn severity(&self) -> ViolationSeverity {
        ViolationSeverity::Warning
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
                let dead_code_lines = Self::find_dead_code(&function.raw_definition);

                for line_num in dead_code_lines {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: format!(
                            "Function '{}' contains unreachable code at line {} after a terminating statement",
                            function.name, line_num
                        ),
                        suggestion: "Remove unreachable code or restructure control flow to eliminate dead paths".to_string(),
                        line_number: line_num,
                        column_number: 0,
                        variable_name: function.name.clone(),
                        severity: ViolationSeverity::Warning,
                    });
                }
            }
        }

        violations
    }
}

impl SorobanDeadCodeRule {
    /// Find lines of dead code after terminating statements.
    /// Returns a list of absolute line numbers where dead code starts.
    fn find_dead_code(source: &str) -> Vec<usize> {
        let mut dead_lines = Vec::new();
        let lines: Vec<&str> = source.lines().collect();

        // Track brace depth to know when we're in the same block
        let mut brace_depth: usize = 0;
        let mut found_terminator: bool = false;
        let mut terminator_depth: usize = 0;

        for (idx, line) in lines.iter().enumerate() {
            let trimmed = line.trim();
            let line_num = idx + 1;

            // Skip empty lines and comments
            if trimmed.is_empty() || trimmed.starts_with("//") {
                continue;
            }

            // Count braces
            let open_braces = trimmed.matches('{').count();
            let close_braces = trimmed.matches('}').count();

            // Check if this line is a terminating statement
            let is_terminator = Self::is_terminating_statement(trimmed);

            if is_terminator && !found_terminator {
                found_terminator = true;
                terminator_depth = brace_depth;
                // Update brace depth after this line
                brace_depth = brace_depth + open_braces - close_braces;
                continue;
            }

            // If we previously found a terminator at this depth
            if found_terminator {
                if brace_depth == terminator_depth {
                    // We're in the same block after a terminator — this is dead code
                    // But only if it's not just a closing brace
                    if !trimmed.starts_with('}') && !trimmed.starts_with("/*") {
                        dead_lines.push(line_num);
                    }
                } else if brace_depth < terminator_depth {
                    // We've exited the block, reset
                    found_terminator = false;
                }
            }

            // Update brace depth
            brace_depth = brace_depth + open_braces - close_braces;
        }

        dead_lines
    }

    /// Check if a line contains a terminating statement.
    fn is_terminating_statement(line: &str) -> bool {
        let trimmed = line.trim();

        // return statement
        if trimmed.starts_with("return") {
            return true;
        }

        // panic! macro
        if trimmed.starts_with("panic!") || trimmed.starts_with("panic!(") {
            return true;
        }

        // break statement
        if trimmed.starts_with("break") {
            return true;
        }

        // continue statement
        if trimmed.starts_with("continue") {
            return true;
        }

        // A function call that ends the flow (like env.panic_with_error)
        if trimmed.contains("panic_with_error") {
            return true;
        }

        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_soroban_rule_engine_creation() {
        let engine = SorobanRuleEngine::with_default_rules();
        assert!(!engine.get_rules().is_empty());

        let rule_ids: Vec<_> = engine.get_rules().iter().map(|r| r.id()).collect();
        assert!(rule_ids.contains(&"soroban-unused-state-variables"));
        assert!(rule_ids.contains(&"soroban-inefficient-storage"));
        assert!(rule_ids.contains(&"soroban-governance-voting"));
        assert!(rule_ids.contains(&"soroban-emergency-withdrawal"));
    }

    #[test]
    fn test_unused_state_variables_rule() {
        let source = r#"
use soroban_sdk::{contract, contractimpl, contracttype, Address};

#[contracttype]
pub struct TestContract {
    pub admin: Address,
    pub unused_counter: u64,
}

#[contractimpl]
impl TestContract {
    pub fn new(admin: Address) -> Self {
        Self { admin, unused_counter: 0 }
    }
    
    pub fn get_admin(&self) -> Address {
        self.admin
    }
}
"#;

        let mut engine = SorobanRuleEngine::new();
        engine.add_rule(UnusedStateVariablesRule::default());

        let violations = engine.analyze(source, "test.rs").unwrap();

        let unused_found = violations.iter().any(|v| {
            v.rule_name == "soroban-unused-state-variables" && v.variable_name == "unused_counter"
        });
        assert!(unused_found);
    }

    #[test]
    fn test_governance_voting_rule() {
        let source = r#"
use soroban_sdk::{contract, contractimpl, Env, Address};

#[contract]
pub struct GovernanceContract;

#[contractimpl]
impl GovernanceContract {
    // ❌ Issue: Missing authorization check for voting
    pub fn vote(env: Env, voter: Address, proposal_id: u64, support: bool) {
        // voter should have require_auth() called here
        let mut current_votes: u64 = env.storage().instance().get(&proposal_id).unwrap_or(0);
        if support {
            current_votes += 1;
        }
        env.storage().instance().set(&proposal_id, &current_votes);
    }
}
"#;

        let rule = GovernanceVotingRule::default();
        let contract = SorobanParser::parse_contract(source, "governance.rs").unwrap();

        let violations = rule.apply(&contract);

        let vote_issue_found = violations
            .iter()
            .any(|v| v.rule_name == "soroban-governance-voting" && v.description.contains("vote"));
        assert!(vote_issue_found);
    }
}

/// Rule for detecting missing claim expiration logic (#117)
pub struct ClaimExpirationRule {
    enabled: bool,
}

impl Default for ClaimExpirationRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for ClaimExpirationRule {
    fn id(&self) -> &str {
        "soroban-claim-expiration"
    }

    fn name(&self) -> &str {
        "Claim Expiration Check"
    }

    fn description(&self) -> &str {
        "Detects claim-related functions that lack expiration/timeout logic"
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
            for function in &implementation.functions {
                let func_name = function.name.to_lowercase();

                if func_name.contains("claim")
                    || func_name.contains("settle")
                    || func_name.contains("redeem")
                {
                    let source = &function.raw_definition;
                    // Strip comment lines to avoid false negatives from comments mentioning keywords
                    let non_comment_source: String = source
                        .lines()
                        .filter(|l| {
                            let t = l.trim();
                            !t.starts_with("//") && !t.starts_with("/*") && !t.starts_with("*")
                        })
                        .collect::<Vec<_>>()
                        .join("\n");

                    if !non_comment_source.contains("timestamp")
                        && !non_comment_source.contains("expiration")
                        && !non_comment_source.contains("expiry")
                    {
                        violations.push(RuleViolation {
                            rule_name: self.id().to_string(),
                            description: format!("Claim function '{}' may be missing expiration logic", function.name),
                            suggestion: "Add an expiration timestamp check to ensure claims cannot be processed after a certain deadline".to_string(),
                            line_number: function.line_number,
                            column_number: 0,
                            variable_name: function.name.clone(),
                            severity: self.severity(),
                        });
                    }
                }
            }
        }

        eprintln!("DEBUG apply returning {} violations", violations.len());
        violations
    }
}

/// Rule for detecting susceptibility to front-running (#118)
pub struct AntiFrontRunningRule {
    enabled: bool,
}

impl Default for AntiFrontRunningRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for AntiFrontRunningRule {
    fn id(&self) -> &str {
        "soroban-anti-front-running"
    }

    fn name(&self) -> &str {
        "Anti-Front-Running Protection"
    }

    fn description(&self) -> &str {
        "Detects transaction patterns vulnerable to front-running (e.g., missing nonces or slippage checks)"
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
                let func_name = function.name.to_lowercase();

                // Sensitive operations: transfer, swap, liquidate
                if func_name.contains("transfer")
                    || func_name.contains("swap")
                    || func_name.contains("liquidate")
                {
                    let source = &function.raw_definition;

                    if !source.contains("nonce")
                        && !source.contains("deadline")
                        && !source.contains("min_amount")
                    {
                        violations.push(RuleViolation {
                            rule_name: self.id().to_string(),
                            description: format!("Function '{}' may be vulnerable to front-running", function.name),
                            suggestion: "Implement nonces, deadlines, or minimum output checks (slippage protection) to prevent transaction reordering attacks".to_string(),
                            line_number: function.line_number,
                            column_number: 0,
                            variable_name: function.name.clone(),
                            severity: self.severity(),
                        });
                    }
                }
            }
        }

        violations
    }
}

/// Rule for detecting insecure randomness sources (#119)
pub struct SecureRandomnessRule {
    enabled: bool,
}

impl Default for SecureRandomnessRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for SecureRandomnessRule {
    fn id(&self) -> &str {
        "soroban-secure-randomness"
    }

    fn name(&self) -> &str {
        "Secure Randomness Check"
    }

    fn description(&self) -> &str {
        "Detects the use of predictable values for randomness instead of 'env.pseudo_random()'"
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

        let insecure_patterns = [
            "env.ledger().timestamp()",
            "env.ledger().sequence()",
            "timestamp()",
            "sequence()",
        ];

        for implementation in &contract.implementations {
            for function in &implementation.functions {
                let source = &function.raw_definition;

                if (source.contains("random") || source.contains("seed"))
                    && insecure_patterns.iter().any(|p| source.contains(p))
                    && !source.contains("pseudo_random")
                {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: format!("Function '{}' uses predictable values for randomness", function.name),
                        suggestion: "Use 'env.pseudo_random()' for generating secure random values instead of ledger block properties".to_string(),
                        line_number: function.line_number,
                        column_number: 0,
                        variable_name: function.name.clone(),
                        severity: self.severity(),
                    });
                }
            }
        }

        violations
    }
}

/// Rule for detecting missing version tracking in contracts (#123)
pub struct UpgradeVersionTrackingRule {
    enabled: bool,
}

impl Default for UpgradeVersionTrackingRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for UpgradeVersionTrackingRule {
    fn id(&self) -> &str {
        "soroban-upgrade-version-tracking"
    }

    fn name(&self) -> &str {
        "Upgrade Version Tracking"
    }

    fn description(&self) -> &str {
        "Detects contracts missing version information or upgrade tracking"
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
        let mut has_version_field = false;
        let mut has_version_query = false;

        for ct in &contract.contract_types {
            if ct.fields.iter().any(|f| f.name.contains("version")) {
                has_version_field = true;
                break;
            }
        }

        for imp in &contract.implementations {
            if imp
                .functions
                .iter()
                .any(|f| f.name == "version" || f.name == "get_version")
            {
                has_version_query = true;
                break;
            }
        }

        if !has_version_field && !has_version_query {
            return vec![RuleViolation {
                rule_name: self.id().to_string(),
                description: "Contract lacks version tracking or a version query method".to_string(),
                suggestion: "Add a 'version: u32' field to your state and a 'version()' method to track contract upgrades".to_string(),
                line_number: 1,
                column_number: 0,
                variable_name: contract.name.clone(),
                severity: self.severity(),
            }];
        }

        Vec::new()
    }
}

#[cfg(test)]
mod issue_tests {
    use super::*;

    #[test]
    fn test_claim_expiration_rule() {
        let source = r#"
use soroban_sdk::{contract, contractimpl, Env, Address};

#[contract]
pub struct MyContract;

#[contractimpl]
impl MyContract {
    pub fn claim_reward(env: Env, user: Address) {
        // ❌ Missing expiration check
        let reward = 100;
        env.storage().instance().set(&user, &reward);
    }
    
    pub fn secure_claim(env: Env, deadline: u64) {
        // ✅ Has expiration check
        if env.ledger().timestamp() > deadline {
            panic!("Expired");
        }
    }
}
"#;
        let rule = ClaimExpirationRule::default();
        let contract = SorobanParser::parse_contract(source, "test.rs").unwrap();
        let violations = rule.apply(&contract);

        // Debug: print what was parsed
        eprintln!("Parsed implementations: {}", contract.implementations.len());
        for imp in &contract.implementations {
            eprintln!("  impl {}: {} functions", imp.target, imp.functions.len());
            for f in &imp.functions {
                eprintln!("    fn {} (line {})", f.name, f.line_number);
            }
        }
        eprintln!(
            "Violations: {:?}",
            violations
                .iter()
                .map(|v| &v.variable_name)
                .collect::<Vec<_>>()
        );

        // Should find one violation for claim_reward
        assert!(violations.iter().any(|v| v.variable_name == "claim_reward"));
        // Should NOT find violation for secure_claim
        assert!(!violations.iter().any(|v| v.variable_name == "secure_claim"));
    }

    #[test]
    fn test_secure_randomness_rule() {
        let source = r#"
use soroban_sdk::{contract, contractimpl, Env};

#[contract]
pub struct MyContract;

#[contractimpl]
impl MyContract {
    pub fn roll_dice(env: Env) -> u32 {
        // ❌ Insecure randomness
        let seed = env.ledger().timestamp();
        (seed % 6) + 1
    }
}
"#;
        let rule = SecureRandomnessRule::default();
        let contract = SorobanParser::parse_contract(source, "test.rs").unwrap();
        let violations = rule.apply(&contract);
        assert!(!violations.is_empty());
    }

    #[test]
    fn test_upgrade_version_tracking_rule() {
        let source = r#"
use soroban_sdk::{contract, contractimpl};

#[contract]
pub struct MyContract;

#[contractimpl]
impl MyContract {
    pub fn hello() {}
}
"#;
        let rule = UpgradeVersionTrackingRule::default();
        let contract = SorobanParser::parse_contract(source, "test.rs").unwrap();
        let violations = rule.apply(&contract);

        // Should find a violation because version is missing
        assert!(violations
            .iter()
            .any(|v| v.rule_name == "soroban-upgrade-version-tracking"));
    }

    // ── Issue #783: Soroban Function Complexity Analyzer Tests ───────────────

    #[test]
    fn test_function_complexity_simple() {
        let source = r#"
use soroban_sdk::{contract, contractimpl, Env};

#[contract]
pub struct MyContract;

#[contractimpl]
impl MyContract {
    pub fn simple_fn(env: Env) -> u64 {
        42
    }
}
"#;
        let rule = SorobanFunctionComplexityRule::default();
        let contract = SorobanParser::parse_contract(source, "test.rs").unwrap();
        let violations = rule.apply(&contract);

        // Simple function should have no complexity violations
        assert!(violations.iter().all(|v| v.variable_name != "simple_fn"));
    }

    #[test]
    fn test_function_complexity_high() {
        let source = r#"
use soroban_sdk::{contract, contractimpl, Env, Address};

#[contract]
pub struct MyContract;

#[contractimpl]
impl MyContract {
    pub fn complex_fn(env: Env, user: Address, amount: u64) -> u64 {
        if amount > 0 {
            if amount < 100 {
                if user == env.current_contract_address() {
                    return 1;
                } else if amount > 50 {
                    return 2;
                } else {
                    return 3;
                }
            } else if amount < 1000 {
                for i in 0..10 {
                    if i > 5 {
                        while i < 8 {
                            if i == 7 {
                                return 4;
                            }
                        }
                    }
                }
            } else {
                match amount {
                    1000 => return 5,
                    2000 => return 6,
                    _ => return 7,
                }
            }
        }
        0
    }
}
"#;
        let rule = SorobanFunctionComplexityRule::default();
        let contract = SorobanParser::parse_contract(source, "test.rs").unwrap();
        let violations = rule.apply(&contract);

        // Complex function should have a complexity violation
        assert!(violations
            .iter()
            .any(|v| v.variable_name == "complex_fn" && v.severity == ViolationSeverity::High));
    }

    // ── Issue #784: Deep Soroban Control-Flow Nesting Tests ──────────────────

    #[test]
    fn test_deep_nesting_detection() {
        let source = r#"
use soroban_sdk::{contract, contractimpl, Env};

#[contract]
pub struct MyContract;

#[contractimpl]
impl MyContract {
    pub fn nested_fn(env: Env) {
        if true {
            if true {
                if true {
                    if true {
                        if true {
                            // 5 levels deep - exceeds threshold of 4
                        }
                    }
                }
            }
        }
    }
}
"#;
        let rule = SorobanDeepNestingRule::default();
        let contract = SorobanParser::parse_contract(source, "test.rs").unwrap();
        let violations = rule.apply(&contract);

        assert!(violations
            .iter()
            .any(|v| v.variable_name == "nested_fn" && v.rule_name == "soroban-deep-nesting"));
    }

    #[test]
    fn test_no_shallow_nesting() {
        let source = r#"
use soroban_sdk::{contract, contractimpl, Env};

#[contract]
pub struct MyContract;

#[contractimpl]
impl MyContract {
    pub fn shallow_fn(env: Env) {
        if true {
            for i in 0..10 {
                // Only 2 levels deep
            }
        }
    }
}
"#;
        let rule = SorobanDeepNestingRule::default();
        let contract = SorobanParser::parse_contract(source, "test.rs").unwrap();
        let violations = rule.apply(&contract);

        assert!(!violations
            .iter()
            .any(|v| v.variable_name == "shallow_fn"));
    }

    // ── Issue #785: Repeated Soroban Computations Tests ──────────────────────

    #[test]
    fn test_repeated_computations_detection() {
        let source = r#"
use soroban_sdk::{contract, contractimpl, Env, Address};

#[contract]
pub struct MyContract;

#[contractimpl]
impl MyContract {
    pub fn repeated_compute(env: Env, user: Address) {
        let a = env.storage().instance().get(&user);
        let b = env.storage().instance().get(&user);
        let c = env.storage().instance().get(&user);
    }
}
"#;
        let rule = SorobanRepeatedComputationsRule::default();
        let contract = SorobanParser::parse_contract(source, "test.rs").unwrap();
        let violations = rule.apply(&contract);

        assert!(violations
            .iter()
            .any(|v| v.variable_name == "repeated_compute" && v.rule_name == "soroban-repeated-computations"));
    }

    // ── Issue #786: Soroban Dead Code Detector Tests ─────────────────────────

    #[test]
    fn test_dead_code_after_return() {
        let source = r#"
use soroban_sdk::{contract, contractimpl, Env};

#[contract]
pub struct MyContract;

#[contractimpl]
impl MyContract {
    pub fn dead_code_fn(env: Env) -> u64 {
        return 42;
        let x = 10; // dead code
    }
}
"#;
        let rule = SorobanDeadCodeRule::default();
        let contract = SorobanParser::parse_contract(source, "test.rs").unwrap();
        let violations = rule.apply(&contract);

        assert!(violations
            .iter()
            .any(|v| v.variable_name == "dead_code_fn" && v.rule_name == "soroban-dead-code"));
    }

    #[test]
    fn test_dead_code_after_panic() {
        let source = r#"
use soroban_sdk::{contract, contractimpl, Env};

#[contract]
pub struct MyContract;

#[contractimpl]
impl MyContract {
    pub fn panic_fn(env: Env) {
        panic!("error");
        let x = 10; // dead code
    }
}
"#;
        let rule = SorobanDeadCodeRule::default();
        let contract = SorobanParser::parse_contract(source, "test.rs").unwrap();
        let violations = rule.apply(&contract);

        assert!(violations
            .iter()
            .any(|v| v.variable_name == "panic_fn" && v.rule_name == "soroban-dead-code"));
    }

    #[test]
    fn test_no_dead_code_clean_function() {
        let source = r#"
use soroban_sdk::{contract, contractimpl, Env};

#[contract]
pub struct MyContract;

#[contractimpl]
impl MyContract {
    pub fn clean_fn(env: Env) -> u64 {
        let x = 42;
        x
    }
}
"#;
        let rule = SorobanDeadCodeRule::default();
        let contract = SorobanParser::parse_contract(source, "test.rs").unwrap();
        let violations = rule.apply(&contract);

        assert!(!violations
            .iter()
            .any(|v| v.variable_name == "clean_fn"));
    }
}
