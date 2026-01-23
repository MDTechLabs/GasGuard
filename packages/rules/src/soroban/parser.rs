//! Soroban contract parser implementation
//!
//! This module provides parsing capabilities for Soroban smart contracts,
//! extracting AST-like structures from Rust code containing Soroban macros.

use super::*;
use regex::Regex;
use std::collections::HashMap;

/// Parses Soroban contracts from source code
pub struct SorobanParser;

impl SorobanParser {
    /// Parse a Soroban contract from source code
    pub fn parse_contract(source: &str, file_path: &str) -> SorobanResult<SorobanContract> {
        let lines: Vec<&str> = source.lines().collect();
        
        // Extract contract name from #[contract] attribute
        let contract_name = Self::extract_contract_name(source)?;
        
        // Parse struct definitions with #[contracttype]
        let contract_types = Self::parse_contract_types(&lines)?;
        
        // Parse implementation blocks with #[contractimpl]
        let implementations = Self::parse_implementations(&lines)?;
        
        Ok(SorobanContract {
            name: contract_name,
            contract_types,
            implementations,
            source: source.to_string(),
            file_path: file_path.to_string(),
        })
    }
    
    /// Extract contract name from #[contract] attribute
    fn extract_contract_name(source: &str) -> SorobanResult<String> {
        let contract_re = Regex::new(r#"#\s*\[\s*contract\s*\(\s*(.*?)\s*\)\s*\]"#).unwrap();
        
        if let Some(captures) = contract_re.captures(source) {
            if let Some(name) = captures.get(1) {
                return Ok(name.as_str().trim().to_string());
            }
        }
        
        // If no explicit name, try to infer from struct names
        let struct_re = Regex::new(r#"#\s*\[\s*contracttype\s*\][\s\S]*?struct\s+(\w+)"#).unwrap();
        if let Some(captures) = struct_re.captures(source) {
            if let Some(name) = captures.get(1) {
                return Ok(name.as_str().to_string());
            }
        }
        
        Err(SorobanParseError::MissingMacro(
            "Could not determine contract name from #[contract] or #[contracttype] attributes".to_string()
        ))
    }
    
    /// Parse struct definitions with #[contracttype] macro
    fn parse_contract_types(lines: &[&str]) -> SorobanResult<Vec<SorobanStruct>> {
        let mut structs = Vec::new();
        let mut i = 0;
        
        while i < lines.len() {
            // Look for #[contracttype] attribute
            if lines[i].trim().starts_with("#[contracttype]") {
                let line_number = i + 1;
                
                // Skip to the struct definition
                i += 1;
                while i < lines.len() && !lines[i].trim().starts_with("struct") {
                    i += 1;
                }
                
                if i >= lines.len() {
                    break;
                }
                
                // Parse the struct
                if let Some(soroban_struct) = Self::parse_single_struct(&lines[i..], line_number)? {
                    structs.push(soroban_struct);
                }
            }
            i += 1;
        }
        
        Ok(structs)
    }
    
    /// Parse a single struct definition
    fn parse_single_struct(lines: &[&str], start_line: usize) -> SorobanResult<Option<SorobanStruct>> {
        if lines.is_empty() || !lines[0].trim().starts_with("struct") {
            return Ok(None);
        }
        
        let struct_line = lines[0].trim();
        
        // Extract struct name
        let name_re = Regex::new(r"struct\s+(\w+)").unwrap();
        let name = name_re.captures(struct_line)
            .and_then(|caps| caps.get(1))
            .map(|m| m.as_str().to_string())
            .ok_or_else(|| SorobanParseError::ParseError(
                format!("Could not parse struct name from: {}", struct_line)
            ))?;
        
        // Find the opening brace
        let mut brace_count = 0;
        let mut struct_lines = vec![struct_line];
        let mut i = 1;
        
        while i < lines.len() {
            let line = lines[i].trim();
            struct_lines.push(line);
            
            if line.contains('{') {
                brace_count += 1;
            }
            if line.contains('}') {
                brace_count -= 1;
                if brace_count == 0 {
                    break;
                }
            }
            i += 1;
        }
        
        // Parse fields
        let fields = Self::parse_struct_fields(&struct_lines, start_line)?;
        
        Ok(Some(SorobanStruct {
            name,
            fields,
            line_number: start_line,
            raw_definition: struct_lines.join("\n"),
        }))
    }
    
    /// Parse fields from a struct definition
    fn parse_struct_fields(lines: &[&str], base_line: usize) -> SorobanResult<Vec<SorobanField>> {
        let mut fields = Vec::new();
        
        // Join lines and extract content between braces
        let full_content = lines.join(" ");
        let fields_content = Self::extract_between_braces(&full_content)
            .ok_or_else(|| SorobanParseError::ParseError("Could not extract struct fields".to_string()))?;
        
        // Split by comma to get individual fields
        let field_parts: Vec<&str> = fields_content.split(',').collect();
        
        for (index, field_part) in field_parts.iter().enumerate() {
            let field_part = field_part.trim();
            if field_part.is_empty() {
                continue;
            }
            
            // Parse field: visibility, name, and type
            if let Some(field) = Self::parse_field(field_part, base_line + index)? {
                fields.push(field);
            }
        }
        
        Ok(fields)
    }
    
    /// Parse a single field definition
    fn parse_field(field_str: &str, line_number: usize) -> SorobanResult<Option<SorobanField>> {
        let field_str = field_str.trim();
        if field_str.is_empty() {
            return Ok(None);
        }
        
        // Handle visibility modifiers
        let (visibility, remaining) = if field_str.starts_with("pub ") {
            (FieldVisibility::Public, &field_str[4..])
        } else {
            (FieldVisibility::Private, field_str)
        };
        
        // Split by colon to separate name and type
        let parts: Vec<&str> = remaining.split(':').collect();
        if parts.len() != 2 {
            return Err(SorobanParseError::ParseError(
                format!("Invalid field format: {}", field_str)
            ));
        }
        
        let name = parts[0].trim().to_string();
        let type_name = parts[1].trim().to_string();
        
        Ok(Some(SorobanField {
            name,
            type_name,
            visibility,
            line_number,
        }))
    }
    
    /// Parse implementation blocks with #[contractimpl] macro
    fn parse_implementations(lines: &[&str]) -> SorobanResult<Vec<SorobanImpl>> {
        let mut implementations = Vec::new();
        let mut i = 0;
        
        while i < lines.len() {
            // Look for #[contractimpl] attribute
            if lines[i].trim().starts_with("#[contractimpl]") {
                let line_number = i + 1;
                
                // Skip to the impl definition
                i += 1;
                while i < lines.len() && !lines[i].trim().starts_with("impl") {
                    i += 1;
                }
                
                if i >= lines.len() {
                    break;
                }
                
                // Parse the impl block
                if let Some(implementation) = Self::parse_single_impl(&lines[i..], line_number)? {
                    implementations.push(implementation);
                }
            }
            i += 1;
        }
        
        Ok(implementations)
    }
    
    /// Parse a single implementation block
    fn parse_single_impl(lines: &[&str], start_line: usize) -> SorobanResult<Option<SorobanImpl>> {
        if lines.is_empty() || !lines[0].trim().starts_with("impl") {
            return Ok(None);
        }
        
        let impl_line = lines[0].trim();
        
        // Extract target type (struct name)
        let target_re = Regex::new(r"impl\s+(?:.*?\s+for\s+)?(\w+)").unwrap();
        let target = target_re.captures(impl_line)
            .and_then(|caps| caps.get(1))
            .map(|m| m.as_str().to_string())
            .ok_or_else(|| SorobanParseError::ParseError(
                format!("Could not parse impl target from: {}", impl_line)
            ))?;
        
        // Find the opening brace and parse functions
        let mut brace_count = 0;
        let mut impl_lines = vec![impl_line];
        let mut i = 1;
        let mut functions = Vec::new();
        
        while i < lines.len() {
            let line = lines[i].trim();
            impl_lines.push(line);
            
            if line.contains('{') {
                brace_count += 1;
            }
            
            if line.contains('}') {
                brace_count -= 1;
                if brace_count == 0 {
                    break;
                }
            }
            
            // Parse function definitions within the impl block
            if brace_count == 1 && line.starts_with("pub ") && line.contains("fn ") {
                if let Some(function) = Self::parse_function(&lines[i..], start_line + i)? {
                    functions.push(function);
                }
            }
            
            i += 1;
        }
        
        Ok(Some(SorobanImpl {
            target,
            functions,
            line_number: start_line,
            raw_definition: impl_lines.join("\n"),
        }))
    }
    
    /// Parse a function definition
    fn parse_function(lines: &[&str], start_line: usize) -> SorobanResult<Option<SorobanFunction>> {
        if lines.is_empty() {
            return Ok(None);
        }
        
        let func_line = lines[0].trim();
        if !func_line.starts_with("pub ") || !func_line.contains("fn ") {
            return Ok(None);
        }
        
        // Extract function name
        let name_re = Regex::new(r"fn\s+(\w+)").unwrap();
        let name = name_re.captures(func_line)
            .and_then(|caps| caps.get(1))
            .map(|m| m.as_str().to_string())
            .ok_or_else(|| SorobanParseError::ParseError(
                format!("Could not parse function name from: {}", func_line)
            ))?;
        
        // Extract parameters
        let params = Self::extract_parameters(func_line)?;
        
        // Extract return type
        let return_type = Self::extract_return_type(func_line)?;
        
        // Determine if it's a constructor (new function typically)
        let is_constructor = name == "new" || name.ends_with("_init");
        
        // Get full function definition (find closing brace)
        let mut brace_count = 0;
        let mut func_lines = vec![func_line];
        let mut i = 1;
        
        if func_line.contains('{') {
            brace_count += 1;
        }
        
        while i < lines.len() && brace_count > 0 {
            let line = lines[i].trim();
            func_lines.push(line);
            
            if line.contains('{') {
                brace_count += 1;
            }
            if line.contains('}') {
                brace_count -= 1;
            }
            i += 1;
        }
        
        Ok(Some(SorobanFunction {
            name,
            params,
            return_type,
            visibility: FunctionVisibility::Public, // All contract functions are public
            is_constructor,
            line_number: start_line,
            raw_definition: func_lines.join("\n"),
        }))
    }
    
    /// Extract function parameters
    fn extract_parameters(func_signature: &str) -> SorobanResult<Vec<SorobanParam>> {
        let params_section = Self::extract_between_parentheses(func_signature)
            .ok_or_else(|| SorobanParseError::ParseError("Could not extract parameters".to_string()))?;
        
        let mut params = Vec::new();
        
        // Split by comma, handling nested parentheses
        let param_parts = Self::split_preserving_parentheses(params_section, ',');
        
        for param_part in param_parts {
            let param_part = param_part.trim();
            if param_part.is_empty() {
                continue;
            }
            
            // Split by colon to separate name and type
            let parts: Vec<&str> = param_part.split(':').collect();
            if parts.len() == 2 {
                let name = parts[0].trim().to_string();
                let type_name = parts[1].trim().to_string();
                params.push(SorobanParam { name, type_name });
            }
        }
        
        Ok(params)
    }
    
    /// Extract return type from function signature
    fn extract_return_type(func_signature: &str) -> SorobanResult<Option<String>> {
        // Look for -> return type pattern
        let return_re = Regex::new(r"->\s*([^{\n]+)").unwrap();
        
        if let Some(captures) = return_re.captures(func_signature) {
            if let Some(return_type) = captures.get(1) {
                let clean_type = return_type.as_str().trim().to_string();
                if !clean_type.is_empty() {
                    return Ok(Some(clean_type));
                }
            }
        }
        
        Ok(None)
    }
    
    /// Helper function to extract content between parentheses
    fn extract_between_parentheses(text: &str) -> Option<String> {
        let start = text.find('(')?;
        let mut paren_count = 1;
        let mut end = start + 1;
        
        while end < text.len() && paren_count > 0 {
            match text.chars().nth(end).unwrap() {
                '(' => paren_count += 1,
                ')' => paren_count -= 1,
                _ => {}
            }
            if paren_count > 0 {
                end += 1;
            }
        }
        
        if paren_count == 0 {
            Some(text[start + 1..end].to_string())
        } else {
            None
        }
    }
    
    /// Helper function to extract content between braces
    fn extract_between_braces(text: &str) -> Option<String> {
        let start = text.find('{')?;
        let mut brace_count = 1;
        let mut end = start + 1;
        
        while end < text.len() && brace_count > 0 {
            match text.chars().nth(end).unwrap() {
                '{' => brace_count += 1,
                '}' => brace_count -= 1,
                _ => {}
            }
            if brace_count > 0 {
                end += 1;
            }
        }
        
        if brace_count == 0 {
            Some(text[start + 1..end].to_string())
        } else {
            None
        }
    }
    
    /// Split string by delimiter while preserving parentheses nesting
    fn split_preserving_parentheses(text: &str, delimiter: char) -> Vec<String> {
        let mut result = Vec::new();
        let mut current = String::new();
        let mut paren_count = 0;
        let mut bracket_count = 0;
        let mut brace_count = 0;
        
        for ch in text.chars() {
            match ch {
                '(' => paren_count += 1,
                ')' => paren_count -= 1,
                '[' => bracket_count += 1,
                ']' => bracket_count -= 1,
                '{' => brace_count += 1,
                '}' => brace_count -= 1,
                _ => {}
            }
            
            if ch == delimiter && paren_count == 0 && bracket_count == 0 && brace_count == 0 {
                result.push(current.trim().to_string());
                current = String::new();
            } else {
                current.push(ch);
            }
        }
        
        if !current.trim().is_empty() {
            result.push(current.trim().to_string());
        }
        
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_parse_simple_contract() {
        let source = r#"
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

#[contracttype]
pub struct TokenContract {
    pub admin: Address,
    pub total_supply: u64,
}

#[contractimpl]
impl TokenContract {
    pub fn new(admin: Address, supply: u64) -> Self {
        Self {
            admin,
            total_supply: supply,
        }
    }
    
    pub fn get_total_supply(&self) -> u64 {
        self.total_supply
    }
}
"#;
        
        let contract = SorobanParser::parse_contract(source, "test.rs").unwrap();
        
        assert_eq!(contract.contract_types.len(), 1);
        assert_eq!(contract.implementations.len(), 1);
        
        let struct_def = &contract.contract_types[0];
        assert_eq!(struct_def.name, "TokenContract");
        assert_eq!(struct_def.fields.len(), 2);
        
        let impl_block = &contract.implementations[0];
        assert_eq!(impl_block.functions.len(), 2);
        assert_eq!(impl_block.functions[0].name, "new");
        assert_eq!(impl_block.functions[1].name, "get_total_supply");
    }
}