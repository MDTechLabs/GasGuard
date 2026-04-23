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

pub struct SolidityParser;

impl SolidityParser {
    pub fn parse(source: &str, file_path: &str) -> Result<UnifiedAST, ParserError> {
        let mut contracts = Vec::new();
        let contract_re = Regex::new(r"contract\s+(\w+)\s*\{")?;
        let function_re = Regex::new(r"function\s+(\w+)\s*\(")?;

        for (i, line) in source.lines().enumerate() {
            let line_number = i + 1;
            let trimmed = line.trim();

            if let Some(caps) = contract_re.captures(trimmed) {
                contracts.push(ContractNode {
                    name: caps.get(1).unwrap().as_str().to_string(),
                    functions: Vec::new(),
                    state_variables: Vec::new(),
                    line_number,
                });
            }

            if let Some(caps) = function_re.captures(trimmed) {
                if let Some(last_contract) = contracts.last_mut() {
                    last_contract.functions.push(FunctionNode {
                        name: caps.get(1).unwrap().as_str().to_string(),
                        params: Vec::new(),
                        return_type: None,
                        visibility: Visibility::Public, // Placeholder
                        decorators: Vec::new(),
                        is_constructor: false,
                        is_external: trimmed.contains("external"),
                        is_payable: trimmed.contains("payable"),
                        line_number,
                        body_raw: String::new(),
                    });
                }
            }
        }

        Ok(UnifiedAST {
            language: Language::Solidity,
            source: source.to_string(),
            file_path: file_path.to_string(),
            contracts,
            structs: Vec::new(),
            enums: Vec::new(),
        })
    }
}
