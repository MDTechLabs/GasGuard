#[cfg(test)]
mod tests {
    use gasguard_rules::{RuleViolation, SorobanRuleEngine};

    /// Helper to check if any violation exists for a given variable name
    fn has_violation_for(violations: &[RuleViolation], var_name: &str) -> bool {
        violations.iter().any(|v| v.variable_name == var_name)
    }

    #[test]
    fn test_unused_variable_rename_mutation() {
        let engine = SorobanRuleEngine::with_default_rules();

        let base = r#"
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

#[contracttype]
pub struct Contract {
    pub unused_var: u64,
}

#[contractimpl]
impl Contract {
    pub fn new() -> Self {
        Self { unused_var: 0 }
    }
}
"#;

        let original = engine.analyze(base, "base.rs").unwrap();
        assert!(
            has_violation_for(&original, "unused_var"),
            "Original code should detect unused_var"
        );

        let mutated = base.replace("unused_var", "renamed_var");
        let mutated_result = engine.analyze(&mutated, "mutated.rs").unwrap();
        assert!(
            has_violation_for(&mutated_result, "renamed_var"),
            "Mutated code should detect renamed_var"
        );
        assert!(
            !has_violation_for(&mutated_result, "unused_var"),
            "Mutated code should not reference old variable name"
        );
    }

    #[test]
    fn test_unused_variable_add_usage_mutation() {
        let engine = SorobanRuleEngine::with_default_rules();

        let base = r#"
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

#[contracttype]
pub struct Contract {
    pub my_var: u64,
}

#[contractimpl]
impl Contract {
    pub fn new() -> Self {
        Self { my_var: 0 }
    }
}
"#;

        let original = engine.analyze(base, "base.rs").unwrap();
        assert!(
            has_violation_for(&original, "my_var"),
            "Original code should flag my_var as unused"
        );

        let mutated = r#"
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

#[contracttype]
pub struct Contract {
    pub my_var: u64,
}

#[contractimpl]
impl Contract {
    pub fn new() -> Self {
        Self { my_var: 0 }
    }
    
    pub fn get_my_var(&self) -> u64 {
        self.my_var
    }
}
"#;

        let mutated_result = engine.analyze(mutated, "mutated.rs").unwrap();
        assert!(
            !has_violation_for(&mutated_result, "my_var"),
            "After adding getter, my_var should be considered used and not flagged"
        );
    }

    #[test]
    fn test_inefficient_integer_type_mutation() {
        let engine = SorobanRuleEngine::with_default_rules();

        let inefficient = r#"
use soroban_sdk::{contract, contractimpl, contracttype};

#[contracttype]
pub struct Contract {
    pub huge_counter: u128,
}

#[contractimpl]
impl Contract {
    pub fn new() -> Self {
        Self { huge_counter: 0 }
    }
}
"#;

        let original = engine.analyze(inefficient, "u128.rs").unwrap();
        assert!(
            has_violation_for(&original, "huge_counter"),
            "Should detect inefficient u128 type"
        );

        let efficient = inefficient.replace("u128", "u64");
        let mutated = engine.analyze(&efficient, "u64.rs").unwrap();
        assert!(
            !has_violation_for(&mutated, "huge_counter"),
            "After changing to u64, huge_counter should not be flagged"
        );
    }
}
