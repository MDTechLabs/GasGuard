use crate::{Rule, RuleViolation, ViolationSeverity};
use gasguard_ast::{Language, UnifiedAST};
use regex::Regex;

#[derive(Default)]
pub struct RedundantConstructorInitRule;

impl RedundantConstructorInitRule {
    fn extract_state_vars(source: &str) -> Vec<(String, String, usize)> {
        let mut state_vars = Vec::new();
        let re = Regex::new(
            r"(?m)^\s*(?:uint256|uint|int256|int|address|bool|string|bytes\d+)\s+(?:public|private|internal|external)?\s*(\w+)\s*=\s*(.+?)\s*;"
        ).unwrap();

        for caps in re.captures_iter(source) {
            if let (Some(name), Some(value)) = (caps.get(1), caps.get(2)) {
                let var_name = name.as_str().to_string();
                let init_value = value.as_str().trim().to_string();
                let line_number = source[..name.start()].matches('\n').count() + 1;
                state_vars.push((var_name, init_value, line_number));
            }
        }

        state_vars
    }

    fn extract_constructor_assignments(
        source: &str,
        var_names: &[String],
    ) -> Vec<(String, String, usize)> {
        let mut assignments = Vec::new();
        
        let constructor_re = Regex::new(r"constructor\s*\([^)]*\)\s*(?:public|private|internal|external)?\s*\{").unwrap();
        let constructor_match = constructor_re.find(source);
        
        let constructor_body = match constructor_match {
            Some(m) => {
                let start = m.end();
                let rest = &source[start..];
                if let Some(end) = rest.find('}') {
                    &rest[..end]
                } else {
                    rest
                }
            }
            None => return Vec::new(),
        };

        let re = Regex::new(r"(?m)^\s*(\w+)\s*=\s*(.+?)\s*;").unwrap();
        for caps in re.captures_iter(constructor_body) {
            if let (Some(name), Some(value)) = (caps.get(1), caps.get(2)) {
                let var_name = name.as_str().to_string();
                let assigned_value = value.as_str().trim().to_string();
                
                if var_names.contains(&var_name) {
                    let line_offset = constructor_body[..caps.get(0).unwrap().start()].matches('\n').count();
                    let constructor_start = source[..constructor_match.unwrap().start()].matches('\n').count() + 1;
                    let line_number = constructor_start + line_offset;
                    assignments.push((var_name, assigned_value, line_number));
                }
            }
        }

        assignments
    }
}

impl Rule for RedundantConstructorInitRule {
    fn id(&self) -> &str {
        "solidity-redundant-constructor-init"
    }

    fn name(&self) -> &str {
        "Redundant Constructor Initialization"
    }

    fn description(&self) -> &str {
        "Detects when a constructor redundantly assigns the same value already set in a state variable declaration"
    }

    fn dependencies(&self) -> Vec<String> {
        Vec::new()
    }

    fn check(&self, ast: &UnifiedAST) -> Vec<RuleViolation> {
        if ast.language != Language::Solidity {
            return Vec::new();
        }

        let state_vars = Self::extract_state_vars(&ast.source);
        if state_vars.is_empty() {
            return Vec::new();
        }

        let var_names: Vec<String> = state_vars.iter().map(|(name, _, _)| name.clone()).collect();
        let assignments = Self::extract_constructor_assignments(&ast.source, &var_names);

        let mut violations = Vec::new();

        for (var_name, assigned_value, line_number) in assignments {
            for (decl_name, init_value, _) in &state_vars {
                if var_name == *decl_name && assigned_value == *init_value {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: format!(
                            "Redundant constructor initialization for `{}`: assigning `{}` which matches the declaration value",
                            var_name, assigned_value
                        ),
                        severity: ViolationSeverity::Warning,
                        line_number,
                        column_number: 1,
                        variable_name: var_name.clone(),
                        suggestion: format!(
                            "Remove `{} = {};` from constructor — the state variable is already initialized to `{}` in its declaration",
                            var_name, assigned_value, init_value
                        ),
                    });
                    break;
                }
            }
        }

        violations
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gasguard_ast::{ContractNode, FunctionNode, Visibility};

    fn make_ast(source: &str) -> UnifiedAST {
        UnifiedAST {
            language: Language::Solidity,
            source: source.to_string(),
            file_path: "test.sol".to_string(),
            contracts: vec![ContractNode {
                name: "TestContract".to_string(),
                functions: vec![FunctionNode {
                    name: "constructor".to_string(),
                    params: vec![],
                    return_type: None,
                    visibility: Visibility::Public,
                    decorators: vec![],
                    is_constructor: true,
                    is_external: false,
                    is_payable: false,
                    line_number: 1,
                    body_raw: String::new(),
                }],
                state_variables: vec![],
                line_number: 1,
            }],
            structs: vec![],
            enums: vec![],
        }
    }

    #[test]
    fn detects_redundant_uint_constructor_init() {
        let source = r#"contract TestContract {
    uint256 public x = 10;

    constructor() {
        x = 10;
    }
}"#;

        let ast = make_ast(source);
        let rule = RedundantConstructorInitRule::default();
        let violations = rule.check(&ast);

        assert_eq!(violations.len(), 1);
        assert!(violations[0].suggestion.contains("Remove `x = 10;` from constructor"));
    }

    #[test]
    fn detects_redundant_bool_constructor_init() {
        let source = r#"contract TestContract {
    bool public flag = true;

    constructor() {
        flag = true;
    }
}"#;

        let ast = make_ast(source);
        let rule = RedundantConstructorInitRule::default();
        let violations = rule.check(&ast);

        assert_eq!(violations.len(), 1);
        assert!(violations[0].suggestion.contains("Remove `flag = true;` from constructor"));
    }

    #[test]
    fn does_not_flag_different_constructor_value() {
        let source = r#"contract TestContract {
    uint256 public x = 10;

    constructor() {
        x = 20;
    }
}"#;

        let ast = make_ast(source);
        let rule = RedundantConstructorInitRule::default();
        let violations = rule.check(&ast);

        assert_eq!(violations.len(), 0);
    }

    #[test]
    fn does_not_flag_without_initial_value() {
        let source = r#"contract TestContract {
    uint256 public x;

    constructor() {
        x = 10;
    }
}"#;

        let ast = make_ast(source);
        let rule = RedundantConstructorInitRule::default();
        let violations = rule.check(&ast);

        assert_eq!(violations.len(), 0);
    }

    #[test]
    fn detects_multiple_redundant_inits() {
        let source = r#"contract TestContract {
    uint256 public a = 1;
    bool public b = false;

    constructor() {
        a = 1;
        b = false;
    }
}"#;

        let ast = make_ast(source);
        let rule = RedundantConstructorInitRule::default();
        let violations = rule.check(&ast);

        assert_eq!(violations.len(), 2);
    }
}
