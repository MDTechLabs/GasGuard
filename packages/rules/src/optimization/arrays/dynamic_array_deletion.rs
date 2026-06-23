use crate::rule_engine::{RuleViolation, ViolationSeverity};
use gasguard_ast::{Language, UnifiedAST};

fn normalize_whitespace(input: &str) -> String {
    input.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn is_dynamic_array(type_name: &str) -> bool {
    let normalized = type_name.trim().to_lowercase();
    normalized.ends_with("[]")
}

fn build_shift_pattern(array_name: &str) -> String {
    format!(
        r"\b{}\s*\[[^\]]+\]\s*=\s*{}\s*\[[^\]]+\+\s*1\s*\]",
        regex::escape(array_name),
        regex::escape(array_name)
    )
}

fn build_reverse_shift_pattern(array_name: &str) -> String {
    format!(
        r"\b{}\s*\[[^\]]+\-\s*1\s*\]\s*=\s*{}\s*\[[^\]]+\]\s*",
        regex::escape(array_name),
        regex::escape(array_name)
    )
}

fn detect_shifting_deletion(body: &str, array_name: &str) -> bool {
    let normalized = normalize_whitespace(body);
    let shift_regex = regex::Regex::new(&build_shift_pattern(array_name))
        .expect("shift detection regex must compile");
    let reverse_shift_regex = regex::Regex::new(&build_reverse_shift_pattern(array_name))
        .expect("reverse shift detection regex must compile");

    let has_shift = shift_regex.is_match(&normalized) || reverse_shift_regex.is_match(&normalized);
    let has_pop = normalized.contains(&format!("{}.pop()", array_name));

    has_shift && has_pop
}

/// Detects expensive deletions from dynamic arrays that manually shift elements.
pub fn detect_dynamic_array_deletions(ast: &UnifiedAST) -> Vec<RuleViolation> {
    let mut violations = Vec::new();

    if ast.language != Language::Solidity {
        return violations;
    }

    for contract in &ast.contracts {
        let dynamic_arrays: Vec<_> = contract
            .state_variables
            .iter()
            .filter(|var| is_dynamic_array(&var.type_name))
            .collect();

        if dynamic_arrays.is_empty() {
            continue;
        }

        for func in &contract.functions {
            let body = normalize_whitespace(&func.body_raw);
            let has_loop = body.contains("for (")
                || body.contains("for(")
                || body.contains("while (")
                || body.contains("while(");

            if !has_loop {
                continue;
            }

            for array in &dynamic_arrays {
                if detect_shifting_deletion(&body, &array.name) {
                    violations.push(RuleViolation {
                        rule_name: "dynamic-array-deletion".to_string(),
                        description: format!(
                            "Function '{}' shifts elements of dynamic array '{}' before deleting an item. This is gas-heavy for storage arrays.",
                            func.name, array.name
                        ),
                        severity: ViolationSeverity::Medium,
                        line_number: func.line_number,
                        column_number: 1,
                        variable_name: array.name.clone(),
                        suggestion: format!(
                            "Use swap-and-pop for '{}' when order does not matter: move the last element into the deleted slot and call '{}.pop()' once.",
                            array.name, array.name
                        ),
                    });
                }
            }
        }
    }

    violations
}

#[cfg(test)]
mod tests {
    use super::*;
    use gasguard_ast::{ContractNode, FunctionNode, ParamNode, VariableNode, Visibility};

    #[test]
    fn detects_shift_and_pop_deletion() {
        let ast = UnifiedAST {
            language: Language::Solidity,
            source: String::new(),
            file_path: String::new(),
            structs: vec![],
            enums: vec![],
            contracts: vec![ContractNode {
                name: "Test".to_string(),
                line_number: 1,
                state_variables: vec![VariableNode {
                    name: "users".to_string(),
                    type_name: "address[]".to_string(),
                    visibility: Visibility::Public,
                    is_constant: false,
                    is_immutable: false,
                    line_number: 2,
                }],
                functions: vec![FunctionNode {
                    name: "removeUser".to_string(),
                    params: vec![ParamNode {
                        name: "index".to_string(),
                        type_name: "uint256".to_string(),
                    }],
                    return_type: None,
                    visibility: Visibility::Public,
                    decorators: vec![],
                    is_constructor: false,
                    is_external: false,
                    is_payable: false,
                    line_number: 10,
                    body_raw: r#"
                        for (uint256 i = index; i < users.length - 1; i++) {
                            users[i] = users[i + 1];
                        }
                        users.pop();
                    "#
                    .to_string(),
                }],
            }],
        };

        let violations = detect_dynamic_array_deletions(&ast);
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].variable_name, "users");
        assert!(violations[0].suggestion.contains("swap-and-pop"));
    }

    #[test]
    fn ignores_non_shifting_pop() {
        let ast = UnifiedAST {
            language: Language::Solidity,
            source: String::new(),
            file_path: String::new(),
            structs: vec![],
            enums: vec![],
            contracts: vec![ContractNode {
                name: "Test".to_string(),
                line_number: 1,
                state_variables: vec![VariableNode {
                    name: "users".to_string(),
                    type_name: "address[]".to_string(),
                    visibility: Visibility::Public,
                    is_constant: false,
                    is_immutable: false,
                    line_number: 2,
                }],
                functions: vec![FunctionNode {
                    name: "removeLast".to_string(),
                    params: vec![],
                    return_type: None,
                    visibility: Visibility::Public,
                    decorators: vec![],
                    is_constructor: false,
                    is_external: false,
                    is_payable: false,
                    line_number: 10,
                    body_raw: "users.pop();".to_string(),
                }],
            }],
        };

        let violations = detect_dynamic_array_deletions(&ast);
        assert!(violations.is_empty());
    }
}
