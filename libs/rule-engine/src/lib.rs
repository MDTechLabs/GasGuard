use gasguard_ast::UnifiedAST;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{HashMap, HashSet, VecDeque};

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

/// Output from rule execution that can be passed to dependent rules
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuleOutput {
    pub rule_id: String,
    pub rule_name: String,
    pub data: serde_json::Value,
}

/// Error types for dependency resolution and execution
#[derive(Debug, Clone)]
pub enum PipelineError {
    CircularDependency(Vec<String>),
    MissingDependency(String),
    RuleExecutionFailed(String),
}

impl std::fmt::Display for PipelineError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PipelineError::CircularDependency(cycle) => {
                write!(f, "Circular dependency detected: {}", cycle.join(" -> "))
            }
            PipelineError::MissingDependency(rule_id) => {
                write!(f, "Missing dependency: rule '{}' not found", rule_id)
            }
            PipelineError::RuleExecutionFailed(reason) => {
                write!(f, "Rule execution failed: {}", reason)
            }
        }
    }
}

impl std::error::Error for PipelineError {}

pub trait Rule: Send + Sync {
    fn id(&self) -> &str;
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    
    /// Returns list of rule IDs that this rule depends on
    fn dependencies(&self) -> Vec<String> {
        Vec::new()
    }
    
    /// Execute the rule with context from prior rule outputs
    fn check(&self, ast: &UnifiedAST) -> Vec<RuleViolation>;
    
    /// Execute the rule with access to prior rule outputs
    fn check_with_context(
        &self,
        ast: &UnifiedAST,
        _context: &HashMap<String, RuleOutput>,
    ) -> Vec<RuleViolation> {
        // Default implementation ignores context; rules can override
        self.check(ast)
    }
    
    /// Generate output data for dependent rules
    fn generate_output(&self, violations: &[RuleViolation]) -> RuleOutput {
        RuleOutput {
            rule_id: self.id().to_string(),
            rule_name: self.name().to_string(),
            data: json!({
                "violations_count": violations.len(),
                "violations": violations,
            }),
        }
    }
}

/// Manages rule dependencies and execution order
pub struct RuleDependencyGraph {
    rules: HashMap<String, Box<dyn Rule>>,
    dependencies: HashMap<String, Vec<String>>,
}

impl RuleDependencyGraph {
    pub fn new() -> Self {
        Self {
            rules: HashMap::new(),
            dependencies: HashMap::new(),
        }
    }

    pub fn add_rule(&mut self, rule: Box<dyn Rule>) {
        let rule_id = rule.id().to_string();
        let deps = rule.dependencies();
        self.rules.insert(rule_id.clone(), rule);
        self.dependencies.insert(rule_id, deps);
    }

    /// Validates the dependency graph for circular dependencies
    pub fn validate(&self) -> Result<(), PipelineError> {
        for rule_id in self.rules.keys() {
            self.detect_cycle(rule_id)?;
        }
        Ok(())
    }

    /// Detects circular dependencies using DFS
    fn detect_cycle(&self, start: &str) -> Result<(), PipelineError> {
        let mut visited = HashSet::new();
        let mut rec_stack = HashSet::new();
        let mut path = Vec::new();

        self.dfs_cycle_check(start, &mut visited, &mut rec_stack, &mut path)?;
        Ok(())
    }

    fn dfs_cycle_check(
        &self,
        node: &str,
        visited: &mut HashSet<String>,
        rec_stack: &mut HashSet<String>,
        path: &mut Vec<String>,
    ) -> Result<(), PipelineError> {
        visited.insert(node.to_string());
        rec_stack.insert(node.to_string());
        path.push(node.to_string());

        if let Some(deps) = self.dependencies.get(node) {
            for dep in deps {
                if !visited.contains(dep) {
                    self.dfs_cycle_check(dep, visited, rec_stack, path)?;
                } else if rec_stack.contains(dep) {
                    // Found a cycle
                    let cycle_start = path.iter().position(|x| x == dep).unwrap_or(0);
                    let cycle = path[cycle_start..].to_vec();
                    return Err(PipelineError::CircularDependency(cycle));
                }
            }
        }

        path.pop();
        rec_stack.remove(node);
        Ok(())
    }

    /// Returns rules in topologically sorted order
    pub fn topological_sort(&self) -> Result<Vec<String>, PipelineError> {
        // Validate first
        self.validate()?;

        let mut sorted = Vec::new();
        let mut visited = HashSet::new();
        let mut visiting = HashSet::new();

        for rule_id in self.rules.keys() {
            if !visited.contains(rule_id) {
                self.topological_sort_dfs(rule_id, &mut visited, &mut visiting, &mut sorted)?;
            }
        }

        sorted.reverse();
        Ok(sorted)
    }

    fn topological_sort_dfs(
        &self,
        node: &str,
        visited: &mut HashSet<String>,
        visiting: &mut HashSet<String>,
        sorted: &mut Vec<String>,
    ) -> Result<(), PipelineError> {
        visiting.insert(node.to_string());

        if let Some(deps) = self.dependencies.get(node) {
            for dep in deps {
                if !self.rules.contains_key(dep) {
                    return Err(PipelineError::MissingDependency(dep.clone()));
                }

                if !visited.contains(dep) {
                    self.topological_sort_dfs(dep, visited, visiting, sorted)?;
                }
            }
        }

        visiting.remove(node);
        visited.insert(node.to_string());
        sorted.push(node.to_string());
        Ok(())
    }
}

/// Executes rules in dependency order with context passing
pub struct PipelineExecutor {
    graph: RuleDependencyGraph,
}

impl PipelineExecutor {
    pub fn new(graph: RuleDependencyGraph) -> Result<Self, PipelineError> {
        graph.validate()?;
        Ok(Self { graph })
    }

    pub fn execute(&self, ast: &UnifiedAST) -> Result<Vec<RuleViolation>, PipelineError> {
        let execution_order = self.graph.topological_sort()?;
        let mut all_violations = Vec::new();
        let mut context: HashMap<String, RuleOutput> = HashMap::new();

        for rule_id in execution_order {
            let rule = self
                .graph
                .rules
                .get(&rule_id)
                .ok_or_else(|| PipelineError::MissingDependency(rule_id.clone()))?;

            // Execute rule with context
            let violations = rule.check_with_context(ast, &context);
            
            // Generate output for dependent rules
            let output = rule.generate_output(&violations);
            context.insert(rule_id, output);
            all_violations.extend(violations);
        }

        Ok(all_violations)
    }
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

    /// Create a pipeline executor with dependency-aware execution
    pub fn to_pipeline(self) -> Result<PipelineExecutor, PipelineError> {
        let mut graph = RuleDependencyGraph::new();
        for rule in self.rules.into_iter() {
            graph.add_rule(rule);
        }
        PipelineExecutor::new(graph)
    }
}
