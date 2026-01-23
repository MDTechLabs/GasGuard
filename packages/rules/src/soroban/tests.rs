#[cfg(test)]
mod tests {
    use gasguard_rules::soroban::*;
    
    #[test]
    fn test_soroban_struct_parsing() {
        let source = r#"
#[contracttype]
pub struct Token {
    pub admin: Address,
    pub total_supply: u64,
}
"#;
        
        let lines: Vec<&str> = source.lines().collect();
        let parser = SorobanParser;
        
        if let Ok(Some(struct_def)) = parser.parse_single_struct(&lines[1..], 2) {
            assert_eq!(struct_def.name, "Token");
            assert_eq!(struct_def.fields.len(), 2);
            assert_eq!(struct_def.fields[0].name, "admin");
            assert_eq!(struct_def.fields[0].type_name, "Address");
            assert_eq!(struct_def.fields[1].name, "total_supply");
            assert_eq!(struct_def.fields[1].type_name, "u64");
        } else {
            panic!("Failed to parse struct");
        }
    }
    
    #[test]
    fn test_soroban_function_parsing() {
        let source = r#"
    pub fn transfer(from: Address, to: Address, amount: u64) -> Result<(), Error> {
        // Implementation here
    }
"#;
        
        let lines: Vec<&str> = source.lines().collect();
        let parser = SorobanParser;
        
        if let Ok(Some(function)) = parser.parse_function(&lines, 1) {
            assert_eq!(function.name, "transfer");
            assert_eq!(function.params.len(), 3);
            assert_eq!(function.params[0].name, "from");
            assert_eq!(function.params[0].type_name, "Address");
            assert_eq!(function.return_type, Some("Result<(), Error>".to_string()));
        } else {
            panic!("Failed to parse function");
        }
    }
    
    #[test]
    fn test_field_visibility_detection() {
        let parser = SorobanParser;
        
        // Test public field
        let pub_field = parser.parse_field("pub admin: Address", 1).unwrap().unwrap();
        assert_eq!(pub_field.visibility, FieldVisibility::Public);
        assert_eq!(pub_field.name, "admin");
        assert_eq!(pub_field.type_name, "Address");
        
        // Test private field
        let priv_field = parser.parse_field("counter: u64", 1).unwrap().unwrap();
        assert_eq!(priv_field.visibility, FieldVisibility::Private);
        assert_eq!(priv_field.name, "counter");
        assert_eq!(priv_field.type_name, "u64");
    }
    
    #[test]
    fn test_extract_between_parentheses() {
        let parser = SorobanParser;
        
        let result = parser.extract_between_parentheses("fn test(param1: u64, param2: String)");
        assert_eq!(result, Some("param1: u64, param2: String".to_string()));
        
        let result = parser.extract_between_parentheses("no parens here");
        assert_eq!(result, None);
    }
    
    #[test]
    fn test_split_preserving_parentheses() {
        let parser = SorobanParser;
        
        let result = parser.split_preserving_parentheses("param1: u64, param2: (u32, String)", ',');
        assert_eq!(result.len(), 2);
        assert_eq!(result[0], "param1: u64");
        assert_eq!(result[1], "param2: (u32, String)");
    }
    
    #[test]
    fn test_soroban_analyzer_basic_checks() {
        let contract = SorobanContract {
            name: "TestContract".to_string(),
            contract_types: vec![SorobanStruct {
                name: "TestContract".to_string(),
                fields: vec![
                    SorobanField {
                        name: "admin".to_string(),
                        type_name: "Address".to_string(),
                        visibility: FieldVisibility::Public,
                        line_number: 3,
                    },
                    SorobanField {
                        name: "unused_var".to_string(),
                        type_name: "String".to_string(),
                        visibility: FieldVisibility::Public,
                        line_number: 4,
                    }
                ],
                line_number: 2,
                raw_definition: "".to_string(),
            }],
            implementations: vec![],
            source: r#"
use soroban_sdk::{contract, contractimpl, contracttype, Address};

#[contracttype]
pub struct TestContract {
    pub admin: Address,
    pub unused_var: String,
}
"#.to_string(),
            file_path: "test.rs".to_string(),
        };
        
        let violations = SorobanAnalyzer::analyze_contract(&contract);
        
        // Should detect unused variable
        let unused_found = violations.iter().any(|v| 
            v.rule_name == "unused-state-variable" && v.variable_name == "unused_var"
        );
        assert!(unused_found);
    }
    
    #[test]
    fn test_soroban_rule_engine_unused_variables_rule() {
        let rule = UnusedStateVariablesRule::default();
        assert_eq!(rule.id(), "soroban-unused-state-variables");
        assert_eq!(rule.name(), "Unused State Variables");
        assert_eq!(rule.severity(), crate::ViolationSeverity::Warning);
        assert!(rule.is_enabled());
        
        let contract = SorobanContract {
            name: "Test".to_string(),
            contract_types: vec![SorobanStruct {
                name: "Test".to_string(),
                fields: vec![SorobanField {
                    name: "never_used".to_string(),
                    type_name: "u64".to_string(),
                    visibility: FieldVisibility::Public,
                    line_number: 1,
                }],
                line_number: 1,
                raw_definition: "".to_string(),
            }],
            implementations: vec![],
            source: "struct Test { never_used: u64 }".to_string(),
            file_path: "test.rs".to_string(),
        };
        
        let violations = rule.apply(&contract);
        assert!(!violations.is_empty());
        assert_eq!(violations[0].rule_name, "soroban-unused-state-variables");
    }
    
    #[test]
    fn test_soroban_parse_error_handling() {
        let parser = SorobanParser;
        
        // Test parsing invalid contract (missing #[contracttype])
        let invalid_source = r#"
struct Test {
    field: u64,
}
"#;
        
        let result = parser.parse_contract(invalid_source, "invalid.rs");
        assert!(result.is_err());
        
        match result.unwrap_err() {
            SorobanParseError::MissingMacro(msg) => {
                assert!(msg.contains("contract name"));
            }
            _ => panic!("Expected MissingMacro error"),
        }
    }
}