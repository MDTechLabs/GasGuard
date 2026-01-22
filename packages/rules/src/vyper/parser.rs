use regex::Regex;
use std::collections::HashSet;

/// Represents a parsed Vyper function with its decorators and metadata
#[derive(Debug, Clone)]
pub struct VyperFunction {
    pub name: String,
    pub decorators: Vec<String>,
    pub line_number: usize,
    pub column_number: usize,
}

/// Represents a function call within the contract
#[derive(Debug, Clone)]
pub struct VyperFunctionCall {
    pub function_name: String,
    pub is_self_call: bool,
    pub line_number: usize,
}

/// Parsed Vyper contract representation
#[derive(Debug, Clone)]
pub struct VyperContract {
    pub functions: Vec<VyperFunction>,
    pub function_calls: Vec<VyperFunctionCall>,
}

impl VyperContract {
    /// Parse Vyper source code and extract function definitions with decorators
    pub fn parse(source: &str) -> Result<Self, String> {
        let mut functions = Vec::new();
        let mut function_calls = Vec::new();
        let mut current_decorators: Vec<String> = Vec::new();
        let mut decorator_start_line: Option<usize> = None;

        // Regex patterns for Vyper parsing
        let decorator_pattern = Regex::new(r"^@(\w+)").map_err(|e| e.to_string())?;
        let function_pattern = Regex::new(r"^def\s+(\w+)\s*\(").map_err(|e| e.to_string())?;
        let self_call_pattern = Regex::new(r"self\.(\w+)\s*\(").map_err(|e| e.to_string())?;

        for (line_idx, line) in source.lines().enumerate() {
            let line_number = line_idx + 1;
            let trimmed = line.trim();

            // Check for decorator
            if let Some(captures) = decorator_pattern.captures(trimmed) {
                if let Some(decorator_name) = captures.get(1) {
                    if current_decorators.is_empty() {
                        decorator_start_line = Some(line_number);
                    }
                    current_decorators.push(decorator_name.as_str().to_string());
                }
            }
            // Check for function definition
            else if let Some(captures) = function_pattern.captures(trimmed) {
                if let Some(func_name) = captures.get(1) {
                    let func_line = decorator_start_line.unwrap_or(line_number);
                    functions.push(VyperFunction {
                        name: func_name.as_str().to_string(),
                        decorators: current_decorators.clone(),
                        line_number: func_line,
                        column_number: 1,
                    });
                    current_decorators.clear();
                    decorator_start_line = None;
                }
            }
            // Check for non-decorator, non-function lines (reset decorators if we hit something else)
            else if !trimmed.is_empty() && !trimmed.starts_with('#') {
                // If we encounter a non-empty, non-comment line that's not a decorator or function,
                // and we have pending decorators, they might be orphaned (edge case)
                // For now, we keep collecting decorators until we hit a function
            }

            // Track self.function() calls for internal usage analysis
            for captures in self_call_pattern.captures_iter(line) {
                if let Some(func_name) = captures.get(1) {
                    function_calls.push(VyperFunctionCall {
                        function_name: func_name.as_str().to_string(),
                        is_self_call: true,
                        line_number,
                    });
                }
            }
        }

        Ok(VyperContract {
            functions,
            function_calls,
        })
    }

    /// Get all functions that are only called internally (via self.)
    pub fn get_internally_called_functions(&self) -> HashSet<String> {
        self.function_calls
            .iter()
            .filter(|call| call.is_self_call)
            .map(|call| call.function_name.clone())
            .collect()
    }

    /// Check if a function has a specific decorator
    pub fn function_has_decorator(func: &VyperFunction, decorator: &str) -> bool {
        func.decorators.iter().any(|d| d == decorator)
    }

    /// Check if function name suggests it should be internal (starts with _)
    pub fn is_internal_naming_convention(func_name: &str) -> bool {
        func_name.starts_with('_') && !func_name.starts_with("__")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple_function() {
        let source = r#"
@external
def my_function():
    pass
"#;
        let contract = VyperContract::parse(source).unwrap();
        assert_eq!(contract.functions.len(), 1);
        assert_eq!(contract.functions[0].name, "my_function");
        assert_eq!(contract.functions[0].decorators, vec!["external"]);
    }

    #[test]
    fn test_parse_internal_function() {
        let source = r#"
@internal
def _helper():
    pass
"#;
        let contract = VyperContract::parse(source).unwrap();
        assert_eq!(contract.functions.len(), 1);
        assert_eq!(contract.functions[0].name, "_helper");
        assert_eq!(contract.functions[0].decorators, vec!["internal"]);
    }

    #[test]
    fn test_parse_multiple_decorators() {
        let source = r#"
@external
@view
def get_value() -> uint256:
    return self.value
"#;
        let contract = VyperContract::parse(source).unwrap();
        assert_eq!(contract.functions.len(), 1);
        assert_eq!(contract.functions[0].decorators, vec!["external", "view"]);
    }

    #[test]
    fn test_detect_self_calls() {
        let source = r#"
@external
def main():
    self._helper()
    self.another_function()

@internal
def _helper():
    pass
"#;
        let contract = VyperContract::parse(source).unwrap();
        assert_eq!(contract.function_calls.len(), 2);
        assert!(contract
            .get_internally_called_functions()
            .contains("_helper"));
        assert!(contract
            .get_internally_called_functions()
            .contains("another_function"));
    }

    #[test]
    fn test_internal_naming_convention() {
        assert!(VyperContract::is_internal_naming_convention("_helper"));
        assert!(VyperContract::is_internal_naming_convention(
            "_calculate_fee"
        ));
        assert!(!VyperContract::is_internal_naming_convention(
            "public_function"
        ));
        assert!(!VyperContract::is_internal_naming_convention("__init__")); // Dunder methods excluded
    }
}
