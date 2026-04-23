use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum Language {
    Solidity,
    Rust,
    Vyper,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UnifiedAST {
    pub language: Language,
    pub source: String,
    pub file_path: String,
    pub contracts: Vec<ContractNode>,
    pub structs: Vec<StructNode>,
    pub enums: Vec<EnumNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ContractNode {
    pub name: String,
    pub functions: Vec<FunctionNode>,
    pub state_variables: Vec<VariableNode>,
    pub line_number: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FunctionNode {
    pub name: String,
    pub params: Vec<ParamNode>,
    pub return_type: Option<String>,
    pub visibility: Visibility,
    pub decorators: Vec<String>,
    pub is_constructor: bool,
    pub is_external: bool,
    pub is_payable: bool,
    pub line_number: usize,
    pub body_raw: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StructNode {
    pub name: String,
    pub fields: Vec<VariableNode>,
    pub line_number: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EnumNode {
    pub name: String,
    pub variants: Vec<String>,
    pub line_number: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VariableNode {
    pub name: String,
    pub type_name: String,
    pub visibility: Visibility,
    pub is_constant: bool,
    pub is_immutable: bool,
    pub line_number: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ParamNode {
    pub name: String,
    pub type_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum Visibility {
    Public,
    Private,
    Internal,
    External,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Param {
    pub name: String,
    pub type_name: String,
}
