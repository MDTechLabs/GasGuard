use gasguard_ast::{UnifiedAST, Language, ContractNode, FunctionNode, StructNode, Visibility, VariableNode, ParamNode};
use regex::Regex;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ParserError {
    #[error("Regex error: {0}")]
    RegexError(#[from] regex::Error),
    #[error("Parse error: {0}")]
    ParseError(String),
}

pub struct RustParser;

impl RustParser {
    pub fn parse(source: &str, file_path: &str) -> Result<UnifiedAST, ParserError> {
        let lines: Vec<&str> = source.lines().collect();
        
        let mut structs = Vec::new();
        let mut contracts = Vec::new();

        // Very basic extraction logic similar to the existing one but mapped to UnifiedAST
        let contract_name = Self::extract_contract_name(source)?;
        
        // Extract structs
        let mut i = 0;
        while i < lines.len() {
            if lines[i].trim().starts_with("#[contracttype]") {
                let start_line = i + 1;
                i += 1;
                while i < lines.len() && !lines[i].trim().contains("struct") {
                    i += 1;
                }
                if i < lines.len() {
                    if let Some(s) = Self::parse_struct(&lines[i..], start_line)? {
                        structs.push(s);
                    }
                }
            }
            i += 1;
        }

        // Extract functions from impl blocks
        let mut functions = Vec::new();
        i = 0;
        while i < lines.len() {
            if lines[i].trim().starts_with("#[contractimpl]") {
                let start_line = i + 1;
                i += 1;
                while i < lines.len() && !lines[i].trim().starts_with("impl") {
                    i += 1;
                }
                if i < lines.len() {
                    let (funcs, _) = Self::parse_impl(&lines[i..], start_line)?;
                    functions.extend(funcs);
                }
            }
            i += 1;
        }

        contracts.push(ContractNode {
            name: contract_name,
            functions,
            state_variables: Vec::new(), // In Soroban, state variables are often in the struct or handled via Env
            line_number: 1,
        });

        Ok(UnifiedAST {
            language: Language::Rust,
            source: source.to_string(),
            file_path: file_path.to_string(),
            contracts,
            structs,
            enums: Vec::new(),
        })
    }

    fn extract_contract_name(source: &str) -> Result<String, ParserError> {
        let contract_re = Regex::new(r#"#\s*\[\s*contract\s*\(\s*(.*?)\s*\)\s*\]"#)?;
        if let Some(captures) = contract_re.captures(source) {
            if let Some(name) = captures.get(1) {
                return Ok(name.as_str().trim().to_string());
            }
        }
        Ok("UnknownContract".to_string())
    }

    fn parse_struct(lines: &[&str], start_line: usize) -> Result<Option<StructNode>, ParserError> {
        let line = lines[0].trim();
        let name_re = Regex::new(r"struct\s+(\w+)")?;
        let name = name_re.captures(line)
            .and_then(|caps| caps.get(1))
            .map(|m| m.as_str().to_string())
            .ok_or_else(|| ParserError::ParseError("Could not parse struct name".into()))?;

        Ok(Some(StructNode {
            name,
            fields: Vec::new(), // Simplifying for now
            line_number: start_line,
        }))
    }

    fn parse_impl(lines: &[&str], start_line: usize) -> Result<(Vec<FunctionNode>, usize), ParserError> {
        let mut functions = Vec::new();
        let mut brace_count = 0;
        let mut i = 0;

        if lines[i].contains('{') {
            brace_count += 1;
        }
        i += 1;

        while i < lines.len() {
            let line = lines[i].trim();
            if line.contains('{') { brace_count += 1; }
            if line.contains('}') { 
                brace_count -= 1; 
                if brace_count == 0 { break; }
            }

            if line.starts_with("pub ") && line.contains("fn ") {
                let name_re = Regex::new(r"fn\s+(\w+)")?;
                if let Some(caps) = name_re.captures(line) {
                    let name = caps.get(1).unwrap().as_str().to_string();
                    functions.push(FunctionNode {
                        name,
                        params: Vec::new(),
                        return_type: None,
                        visibility: Visibility::Public,
                        decorators: Vec::new(),
                        is_constructor: false,
                        is_external: true,
                        is_payable: false,
                        line_number: start_line + i,
                        body_raw: String::new(),
                    });
                }
            }
            i += 1;
        }

        Ok((functions, i))
    }
}
