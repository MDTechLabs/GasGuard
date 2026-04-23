use gasguard_ast::UnifiedAST;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuleViolation {
    pub rule_name: String,
    pub description: String,
    pub severity: ViolationSeverity,
    pub line_number: usize,
    pub column_number: usize,
    pub variable_name: String,
    pub suggestion: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ViolationSeverity {
    Error,
    High,
    Medium,
    Warning,
    Info,
}

pub trait Rule: Send + Sync {
    fn id(&self) -> &str;
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn check(&self, ast: &UnifiedAST) -> Vec<RuleViolation>;
}

pub struct RuleEngine {
    rules: Vec<Box<dyn Rule>>,
}

impl RuleEngine {
    pub fn new() -> Self {
        Self { rules: Vec::new() }
    }

    pub fn add_rule(&mut self, rule: Box<dyn Rule>) {
        self.rules.push(rule);
    }

    pub fn run(&self, ast: &UnifiedAST) -> Vec<RuleViolation> {
        let mut violations = Vec::new();
        for rule in &self.rules {
            violations.extend(rule.check(ast));
        }
        violations
    }
}
