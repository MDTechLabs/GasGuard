use gasguard_ast::{Language, UnifiedAST};
use crate::rule_engine::{RuleViolation, ViolationSeverity};

/// Detects inefficient use of `abi.encode` that could be replaced with `abi.encodePacked`.
pub fn detect_abi_encoding_inefficiencies(ast: &UnifiedAST) -> Vec<RuleViolation> {
    let mut violations = Vec::new();

    if ast.language != Language::Solidity {
        return violations;
    }

    for contract in &ast.contracts {
        for func in &contract.functions {
            let body = &func.body_raw;
            
            // Simple check for abi.encode usage while trying to avoid false positives 
            // like abi.encodePacked, abi.encodeWithSignature, etc.
            
            // Basic search strategy:
            // Find occurrences of "abi.encode" and ensure the next character is "(" or whitespace then "("
            let mut search_start = 0;
            while let Some(index) = body[search_start..].find("abi.encode") {
                let absolute_index = search_start + index;
                let remainder = &body[absolute_index + "abi.encode".len()..];
                
                // Check if the next non-whitespace char is '('
                if let Some(next_char) = remainder.chars().find(|c| !c.is_whitespace()) {
                    if next_char == '(' {
                        violations.push(RuleViolation {
                            rule_name: "abi-encoding-inefficiency".to_string(),
                            description: "Detected potentially inefficient use of abi.encode".to_string(),
                            severity: ViolationSeverity::Medium,
                            line_number: func.line_number, // We use the function's start line as a proxy
                            column_number: 1,
                            variable_name: "abi.encode".to_string(),
                            suggestion: "Consider using abi.encodePacked to save gas, unless you require 32-byte padding (e.g., to prevent hash collisions with multiple dynamic types or interfacing with standard ABI requirements).".to_string(),
                        });
                    }
                }
                
                search_start = absolute_index + "abi.encode".len();
            }
        }
    }

    violations
}

#[cfg(test)]
mod tests {
    use super::*;
    use gasguard_ast::{ContractNode, FunctionNode, Visibility};

    #[test]
    fn test_detect_abi_encoding() {
        let ast = UnifiedAST {
            language: Language::Solidity,
            source: "".to_string(),
            file_path: "".to_string(),
            structs: vec![],
            enums: vec![],
            contracts: vec![ContractNode {
                name: "Test".to_string(),
                line_number: 1,
                state_variables: vec![],
                functions: vec![
                    FunctionNode {
                        name: "testInefficient".to_string(),
                        params: vec![],
                        return_type: None,
                        visibility: Visibility::Public,
                        decorators: vec![],
                        is_constructor: false,
                        is_external: false,
                        is_payable: false,
                        line_number: 5,
                        body_raw: "bytes memory data = abi.encode(1, 2);".to_string(),
                    },
                    FunctionNode {
                        name: "testEfficient".to_string(),
                        params: vec![],
                        return_type: None,
                        visibility: Visibility::Public,
                        decorators: vec![],
                        is_constructor: false,
                        is_external: false,
                        is_payable: false,
                        line_number: 10,
                        body_raw: "bytes memory data = abi.encodePacked(1, 2);".to_string(),
                    },
                    FunctionNode {
                        name: "testEncodeWithSelector".to_string(),
                        params: vec![],
                        return_type: None,
                        visibility: Visibility::Public,
                        decorators: vec![],
                        is_constructor: false,
                        is_external: false,
                        is_payable: false,
                        line_number: 15,
                        body_raw: "bytes memory data = abi.encodeWithSelector(bytes4(keccak256(\"foo()\")));".to_string(),
                    }
                ],
            }],
        };

        let violations = detect_abi_encoding_inefficiencies(&ast);
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].line_number, 5);
        assert_eq!(violations[0].variable_name, "abi.encode");
    }
}
