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

/// Represents a field within a Vyper struct
#[derive(Debug, Clone)]
pub struct VyperStructField {
    pub name: String,
    pub type_name: String,
    pub size_bytes: usize,
    pub line_number: usize,
}

/// Represents a Vyper struct definition
#[derive(Debug, Clone)]
pub struct VyperStruct {
    pub name: String,
    pub fields: Vec<VyperStructField>,
    pub line_number: usize,
}

/// Parsed Vyper contract representation
#[derive(Debug, Clone)]
pub struct VyperContract {
    pub functions: Vec<VyperFunction>,
    pub function_calls: Vec<VyperFunctionCall>,
    pub structs: Vec<VyperStruct>,
}

impl VyperContract {
    /// Parse Vyper source code and extract function definitions with decorators
    pub fn parse(source: &str) -> Result<Self, String> {
        let mut functions = Vec::new();
        let mut function_calls = Vec::new();
        let mut structs = Vec::new();
        let mut current_decorators: Vec<String> = Vec::new();
        let mut decorator_start_line: Option<usize> = None;

        // Regex patterns for Vyper parsing
        let decorator_pattern = Regex::new(r"^@(\w+)").map_err(|e| e.to_string())?;
        let function_pattern = Regex::new(r"^def\s+(\w+)\s*\(").map_err(|e| e.to_string())?;
        let self_call_pattern = Regex::new(r"self\.(\w+)\s*\(").map_err(|e| e.to_string())?;
        let struct_pattern = Regex::new(r"^struct\s+(\w+)").map_err(|e| e.to_string())?;
        let field_pattern = Regex::new(r"^(\w+)\s*:\s*(\w+)").map_err(|e| e.to_string())?;

        let mut current_struct: Option<VyperStruct> = None;

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
            // Check for struct definition
            else if let Some(captures) = struct_pattern.captures(trimmed) {
                // Save any pending struct
                if let Some(struct_def) = current_struct.take() {
                    if !struct_def.fields.is_empty() {
                        structs.push(struct_def);
                    }
                }

                let struct_name = captures.get(1).unwrap().as_str().to_string();
                current_struct = Some(VyperStruct {
                    name: struct_name,
                    fields: Vec::new(),
                    line_number,
                });
            }
            // Check for struct field (only if inside a struct)
            else if current_struct.is_some() {
                if trimmed.starts_with("#") || trimmed.is_empty() {
                    continue;
                }

                // Check if struct ended
                if trimmed.starts_with("def ")
                    || trimmed.starts_with("@")
                    || trimmed.starts_with("event ")
                    || trimmed.starts_with("interface ")
                    || trimmed.starts_with("struct ")
                {
                    if let Some(struct_def) = current_struct.take() {
                        if !struct_def.fields.is_empty() {
                            structs.push(struct_def);
                        }
                    }

                    // Process the current line for functions/decorators
                    if let Some(captures) = function_pattern.captures(trimmed) {
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
                } else if let Some(captures) = field_pattern.captures(trimmed) {
                    let field_name = captures.get(1).unwrap().as_str().to_string();
                    let type_name = captures.get(2).unwrap().as_str().to_string();
                    let size_bytes = get_vyper_type_size(&type_name);

                    if let Some(ref mut struct_def) = current_struct {
                        struct_def.fields.push(VyperStructField {
                            name: field_name,
                            type_name,
                            size_bytes,
                            line_number,
                        });
                    }
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

        // Don't forget the last struct
        if let Some(struct_def) = current_struct.take() {
            if !struct_def.fields.is_empty() {
                structs.push(struct_def);
            }
        }

        Ok(VyperContract {
            functions,
            function_calls,
            structs,
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

/// Get the size of a Vyper type in bytes
pub fn get_vyper_type_size(type_name: &str) -> usize {
    let base_type = type_name.trim().to_lowercase();

    // Handle decimal types
    if base_type.starts_with("decimal") {
        return 32;
    }

    // Handle unsigned integers
    if base_type.starts_with("uint") {
        if let Some(bits_str) = base_type.strip_prefix("uint") {
            if bits_str.is_empty() {
                return 32; // uint = uint256
            }
            if let Ok(bits) = bits_str.parse::<usize>() {
                return bits / 8;
            }
        }
    }

    // Handle signed integers
    if base_type.starts_with("int") {
        if let Some(bits_str) = base_type.strip_prefix("int") {
            if bits_str.is_empty() {
                return 32; // int = int256
            }
            if let Ok(bits) = bits_str.parse::<usize>() {
                return bits / 8;
            }
        }
    }

    // Handle bytes types
    if base_type.starts_with("bytes") {
        if let Some(size_str) = base_type.strip_prefix("bytes") {
            if size_str.is_empty() {
                return 32; // bytes = bytes32 (dynamic in some contexts but typically 32)
            }
            if let Ok(size) = size_str.parse::<usize>() {
                return size;
            }
        }
    }

    // Handle string types
    if base_type == "string" {
        return 32; // Dynamic type, treated as 32 bytes for slot calculations
    }

    // Handle special types
    match base_type.as_str() {
        "bool" => 1,
        "address" => 20,
        "byte" => 1,
        _ => {
            // Handle dynamic arrays and other complex types
            if base_type.contains("[]") || base_type.contains("[") {
                return 32; // Dynamic types occupy a full slot
            }
            32 // Default fallback
        }
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

    #[test]
    fn test_parse_struct() {
        let source = r#"
struct User:
    is_active: bool
    balance: uint256
    nonce: uint8
"#;
        let contract = VyperContract::parse(source).unwrap();
        assert_eq!(contract.structs.len(), 1);
        assert_eq!(contract.structs[0].name, "User");
        assert_eq!(contract.structs[0].fields.len(), 3);
        assert_eq!(contract.structs[0].fields[0].name, "is_active");
        assert_eq!(contract.structs[0].fields[0].type_name, "bool");
        assert_eq!(contract.structs[0].fields[1].name, "balance");
        assert_eq!(contract.structs[0].fields[1].type_name, "uint256");
        assert_eq!(contract.structs[0].fields[2].name, "nonce");
        assert_eq!(contract.structs[0].fields[2].type_name, "uint8");
    }

    #[test]
    fn test_parse_multiple_structs() {
        let source = r#"
struct User:
    active: bool
    balance: uint256

struct Config:
    enabled: bool
    value: uint128
"#;
        let contract = VyperContract::parse(source).unwrap();
        assert_eq!(contract.structs.len(), 2);
        assert_eq!(contract.structs[0].name, "User");
        assert_eq!(contract.structs[1].name, "Config");
    }

    #[test]
    fn test_parse_struct_with_function() {
        let source = r#"
struct User:
    active: bool
    balance: uint256

@external
def get_user() -> User:
    pass
"#;
        let contract = VyperContract::parse(source).unwrap();
        assert_eq!(contract.structs.len(), 1);
        assert_eq!(contract.functions.len(), 1);
    }

    #[test]
    fn test_get_vyper_type_size() {
        assert_eq!(get_vyper_type_size("uint8"), 1);
        assert_eq!(get_vyper_type_size("uint16"), 2);
        assert_eq!(get_vyper_type_size("uint256"), 32);
        assert_eq!(get_vyper_type_size("uint"), 32);
        assert_eq!(get_vyper_type_size("bool"), 1);
        assert_eq!(get_vyper_type_size("address"), 20);
        assert_eq!(get_vyper_type_size("bytes1"), 1);
        assert_eq!(get_vyper_type_size("bytes32"), 32);
    }
}

