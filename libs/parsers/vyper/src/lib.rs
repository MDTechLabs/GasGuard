use gasguard_ast::{UnifiedAST, Language, ContractNode, FunctionNode, Visibility};
use regex::Regex;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ParserError {
    #[error("Regex error: {0}")]
    RegexError(#[from] regex::Error),
    #[error("Parse error: {0}")]
    ParseError(String),
}

pub struct VyperParser;

impl VyperParser {
    pub fn parse(source: &str, file_path: &str) -> Result<UnifiedAST, ParserError> {
        let mut functions = Vec::new();
        let function_re = Regex::new(r"def\s+(\w+)\s*\(")?;
        let mut current_decorators = Vec::new();

        for (i, line) in source.lines().enumerate() {
            let line_number = i + 1;
            let trimmed = line.trim();

            if trimmed.starts_with('@') {
                current_decorators.push(trimmed[1..].to_string());
            } else if let Some(caps) = function_re.captures(trimmed) {
                functions.push(FunctionNode {
                    name: caps.get(1).unwrap().as_str().to_string(),
                    params: Vec::new(),
                    return_type: None,
                    visibility: Visibility::Public, // Placeholder
                    decorators: current_decorators.clone(),
                    is_constructor: false,
                    is_external: current_decorators.contains(&"external".to_string()),
                    is_payable: current_decorators.contains(&"payable".to_string()),
                    line_number,
                    body_raw: String::new(),
                });
                current_decorators.clear();
            }
        }

        let contract_name = file_path.split(['/', '\\']).last().unwrap_or("Contract").split('.').next().unwrap_or("Contract").to_string();

        Ok(UnifiedAST {
            language: Language::Vyper,
            source: source.to_string(),
            file_path: file_path.to_string(),
            contracts: vec![ContractNode {
                name: contract_name,
                functions,
                state_variables: Vec::new(),
                line_number: 1,
            }],
            structs: Vec::new(),
            enums: Vec::new(),
        })
    }
}
