//! Detect Missing Calldata Usage in External Functions
//!
//! Flags external functions using memory parameters when calldata would be more efficient.
//! Using memory for read-only parameters in external functions wastes gas by copying data
//! from calldata to memory.
//!
//! Detection strategy:
//! - Scan for external function definitions
//! - Check for memory-qualified parameters (arrays, structs, strings, bytes)
//! - Suggest using calldata instead for gas optimization
//! - Provide gas savings estimation

use crate::rule_engine::{Rule, RuleViolation, ViolationSeverity};
use quote::ToTokens;
use syn::Item;

pub struct MissingCalldataUsageRule;

impl MissingCalldataUsageRule {
    /// Check if a code string contains external function definitions
    fn has_external_functions(code: &str) -> bool {
        code.contains("external")
    }

    /// Check if code contains memory parameters in functions
    fn has_memory_parameters(code: &str) -> bool {
        code.contains(" memory ")
    }

    /// Check if a type should use calldata
    fn should_use_calldata(type_name: &str) -> bool {
        let t = type_name.trim().to_lowercase();
        // Dynamic types that benefit from calldata
        t.contains("[]") || // Arrays
        t.starts_with("bytes") || // byte arrays (but not bytes1-bytes32)
        t == "string" || // strings
        t.contains("struct") ||
        t.contains("mapping")
    }

    /// Extract external functions and analyze parameters
    fn find_memory_in_external_functions(code: &str) -> Vec<(String, Vec<String>)> {
        let mut functions_with_memory = Vec::new();
        let lines: Vec<&str> = code.lines().collect();
        
        for (i, line) in lines.iter().enumerate() {
            if line.contains("external") && line.contains("(") {
                // Found external function declaration
                // Look for matching closing paren in next few lines
                let mut func_signature = line.to_string();
                let mut j = i + 1;
                while j < lines.len() && !func_signature.contains(")") {
                    func_signature.push(' ');
                    func_signature.push_str(lines[j]);
                    j += 1;
                }

                // Check for memory parameters
                if func_signature.contains(" memory ") {
                    let memory_params: Vec<String> = func_signature
                        .split(',')
                        .filter(|param| param.contains(" memory "))
                        .map(|param| param.trim().to_string())
                        .collect();

                    if !memory_params.is_empty() {
                        functions_with_memory.push((
                            func_signature.lines().next().unwrap_or("").to_string(),
                            memory_params,
                        ));
                    }
                }
            }
        }

        functions_with_memory
    }

    /// Estimate gas savings from using calldata instead of memory
    fn estimate_gas_savings(param_type: &str) -> usize {
        // Rough estimates based on calldata vs memory costs
        if param_type.contains("[]") {
            return 1000; // Dynamic arrays save significant gas
        }
        if param_type.contains("string") {
            return 800; // Strings save significant gas
        }
        if param_type.contains("bytes") {
            return 600; // Bytes save gas
        }
        500 // Structs typically save some gas
    }
}

impl Rule for MissingCalldataUsageRule {
    fn name(&self) -> &str {
        "missing-calldata-usage"
    }

    fn description(&self) -> &str {
        "Detects external functions using memory for parameters when calldata would be \
         more gas-efficient. Using memory unnecessarily copies data from calldata to memory, \
         wasting gas."
    }

    fn check(&self, ast: &[Item]) -> Vec<RuleViolation> {
        let mut violations = Vec::new();

        for item in ast {
            let token_str = item.to_token_stream().to_string();

            // Only check items that contain external functions
            if !Self::has_external_functions(&token_str) || !Self::has_memory_parameters(&token_str)
            {
                continue;
            }

            let functions_with_memory = Self::find_memory_in_external_functions(&token_str);

            for (func_sig, memory_params) in functions_with_memory {
                for param in memory_params {
                    // Extract type name from parameter
                    let param_parts: Vec<&str> = param.split_whitespace().collect();
                    let mut type_name = String::new();

                    for (i, part) in param_parts.iter().enumerate() {
                        if *part == "memory" && i > 0 {
                            // Type is typically before 'memory'
                            type_name = param_parts[0..i].join(" ");
                            break;
                        }
                    }

                    if !type_name.is_empty() && Self::should_use_calldata(&type_name) {
                        let gas_savings = Self::estimate_gas_savings(&type_name);

                        violations.push(RuleViolation {
                            rule_name: self.name().to_string(),
                            description: format!(
                                "External function parameter uses 'memory' for type '{}'. \
                                 Using 'calldata' would be more gas-efficient.",
                                type_name
                            ),
                            severity: ViolationSeverity::Medium,
                            line_number: 0,
                            column_number: 0,
                            variable_name: type_name.clone(),
                            suggestion: format!(
                                "Replace 'memory' with 'calldata' for this parameter. \
                                 Estimated gas savings: ~{} gas per call. \
                                 Example: function foo({}[] calldata data) external {{ ... }}",
                                gas_savings, type_name
                            ),
                        });
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

    #[test]
    fn test_memory_in_external_function() {
        let code = r#"
            function transfer(address[] memory recipients, uint256[] memory amounts) external {
                for (uint i = 0; i < recipients.length; i++) {
                    // transfer logic
                }
            }
        "#;

        let rule = MissingCalldataUsageRule;
        let ast = syn::parse_file(code).unwrap();
        let violations = rule.check(&ast.items);

        assert!(!violations.is_empty());
        assert!(violations.iter().any(|v| v.variable_name.contains("address")));
    }

    #[test]
    fn test_calldata_in_external_function() {
        let code = r#"
            function transfer(address[] calldata recipients, uint256[] calldata amounts) external {
                for (uint i = 0; i < recipients.length; i++) {
                    // transfer logic
                }
            }
        "#;

        let rule = MissingCalldataUsageRule;
        let ast = syn::parse_file(code).unwrap();
        let violations = rule.check(&ast.items);

        // Should have no violations for correct calldata usage
        let relevant_violations: Vec<_> = violations
            .iter()
            .filter(|v| v.variable_name.contains("address"))
            .collect();
        assert!(relevant_violations.is_empty());
    }

    #[test]
    fn test_string_parameter_memory() {
        let code = r#"
            function process(string memory data) external returns (bytes32) {
                return keccak256(abi.encodePacked(data));
            }
        "#;

        let rule = MissingCalldataUsageRule;
        let ast = syn::parse_file(code).unwrap();
        let violations = rule.check(&ast.items);

        assert!(!violations.is_empty());
        assert!(violations[0].description.contains("string"));
    }

    #[test]
    fn test_bytes_parameter_memory() {
        let code = r#"
            function validate(bytes memory signature) external view returns (bool) {
                return signature.length > 0;
            }
        "#;

        let rule = MissingCalldataUsageRule;
        let ast = syn::parse_file(code).unwrap();
        let violations = rule.check(&ast.items);

        assert!(!violations.is_empty());
        assert!(violations[0].description.contains("bytes"));
    }

    #[test]
    fn test_internal_function_not_flagged() {
        let code = r#"
            function _process(string memory data) internal returns (bytes32) {
                return keccak256(abi.encodePacked(data));
            }
        "#;

        let rule = MissingCalldataUsageRule;
        let ast = syn::parse_file(code).unwrap();
        let violations = rule.check(&ast.items);

        // Internal functions should not be flagged (memory is correct there)
        assert!(violations.is_empty());
    }

    #[test]
    fn test_gas_savings_estimation() {
        assert_eq!(MissingCalldataUsageRule::estimate_gas_savings("uint256[]"), 1000);
        assert_eq!(MissingCalldataUsageRule::estimate_gas_savings("string"), 800);
        assert_eq!(MissingCalldataUsageRule::estimate_gas_savings("bytes"), 600);
    }
}
