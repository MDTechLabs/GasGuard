use gasguard_ast::{Language, UnifiedAST};
use crate::rule_engine::{RuleViolation, ViolationSeverity};

/// Detects inefficient mapping iteration workarounds.
pub fn detect_mapping_iteration(ast: &UnifiedAST) -> Vec<RuleViolation> {
    let mut violations = Vec::new();

    if ast.language != Language::Solidity {
        return violations;
    }

    for contract in &ast.contracts {
        let mut mappings = Vec::new();
        let mut arrays = Vec::new();

        for var in &contract.state_variables {
            if var.type_name.starts_with("mapping") {
                mappings.push(&var.name);
            } else if var.type_name.ends_with("[]") {
                arrays.push(&var.name);
            }
        }

        for func in &contract.functions {
            let body = &func.body_raw;
            // Simple check for loop keywords
            if body.contains("for ") || body.contains("for(") || body.contains("while ") || body.contains("while(") {
                for mapping in &mappings {
                    for array in &arrays {
                        // Look for mapping[array[i]] pattern
                        let pattern1 = format!("{}[{}[", mapping, array);
                        let pattern2 = format!("{}[ {}[", mapping, array); // e.g. mapping[ array[
                        let pattern3 = format!("{} [{}[", mapping, array); // e.g. mapping [array[
                        
                        if body.contains(&pattern1) || body.contains(&pattern2) || body.contains(&pattern3) {
                            violations.push(RuleViolation {
                                rule_name: "mapping-iteration-workaround".to_string(),
                                description: format!(
                                    "Detected gas-heavy iteration over helper array '{}' to access mapping '{}'",
                                    array, mapping
                                ),
                                severity: ViolationSeverity::High,
                                line_number: func.line_number,
                                column_number: 1,
                                variable_name: mapping.to_string(),
                                suggestion: "Mappings are not iterable. On-chain iteration over unbounded arrays can lead to out-of-gas errors. Consider using off-chain indexing via events or a pagination pattern.".to_string(),
                            });
                        }
                    }
                }
            }
        }
    }

    violations
}

#[cfg(test)]
mod tests {
    use super::*;
    use gasguard_ast::{ContractNode, FunctionNode, VariableNode, Visibility};

    #[test]
    fn test_detect_mapping_iteration() {
        let ast = UnifiedAST {
            language: Language::Solidity,
            source: "".to_string(),
            file_path: "".to_string(),
            structs: vec![],
            enums: vec![],
            contracts: vec![ContractNode {
                name: "Test".to_string(),
                line_number: 1,
                state_variables: vec![
                    VariableNode {
                        name: "balances".to_string(),
                        type_name: "mapping(address => uint256)".to_string(),
                        visibility: Visibility::Public,
                        is_constant: false,
                        is_immutable: false,
                        line_number: 2,
                    },
                    VariableNode {
                        name: "users".to_string(),
                        type_name: "address[]".to_string(),
                        visibility: Visibility::Public,
                        is_constant: false,
                        is_immutable: false,
                        line_number: 3,
                    },
                ],
                functions: vec![FunctionNode {
                    name: "distribute".to_string(),
                    params: vec![],
                    return_type: None,
                    visibility: Visibility::Public,
                    decorators: vec![],
                    is_constructor: false,
                    is_external: false,
                    is_payable: false,
                    line_number: 5,
                    body_raw: "for (uint i = 0; i < users.length; i++) { balances[users[i]] += 100; }".to_string(),
                }],
            }],
        };

        let violations = detect_mapping_iteration(&ast);
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].variable_name, "balances");
        assert!(violations[0].description.contains("users"));
    }
}
