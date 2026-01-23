//! Soroban contract parsing and analysis module
//!
//! This module provides AST structures and parsing utilities for Soroban smart contracts
//! built on the Stellar network. It handles parsing of Soroban-specific macros like
//! `#[contract]`, `#[contractimpl]`, and `#[contracttype]`.

pub mod parser;
pub mod analyzer;
pub mod rule_engine;

pub use parser::*;
pub use analyzer::*;
pub use rule_engine::*;

/// Represents a Soroban contract structure
#[derive(Debug, Clone, PartialEq)]
pub struct SorobanContract {
    /// The name of the contract
    pub name: String,
    /// Struct definitions marked with #[contracttype]
    pub contract_types: Vec<SorobanStruct>,
    /// Implementation blocks marked with #[contractimpl]
    pub implementations: Vec<SorobanImpl>,
    /// Raw contract source code
    pub source: String,
    /// File path of the contract
    pub file_path: String,
}

/// Represents a struct definition with #[contracttype] macro
#[derive(Debug, Clone, PartialEq)]
pub struct SorobanStruct {
    /// Name of the struct
    pub name: String,
    /// Fields in the struct
    pub fields: Vec<SorobanField>,
    /// Line number where the struct is defined
    pub line_number: usize,
    /// Raw struct definition
    pub raw_definition: String,
}

/// Represents a field in a Soroban struct
#[derive(Debug, Clone, PartialEq)]
pub struct SorobanField {
    /// Name of the field
    pub name: String,
    /// Type of the field
    pub type_name: String,
    /// Visibility modifier
    pub visibility: FieldVisibility,
    /// Line number of the field
    pub line_number: usize,
}

/// Visibility modifiers for struct fields
#[derive(Debug, Clone, PartialEq)]
pub enum FieldVisibility {
    Public,
    Private,
}

/// Represents an implementation block with #[contractimpl] macro
#[derive(Debug, Clone, PartialEq)]
pub struct SorobanImpl {
    /// Name of the impl block (usually the struct name)
    pub target: String,
    /// Functions defined in the impl block
    pub functions: Vec<SorobanFunction>,
    /// Line number where the impl starts
    pub line_number: usize,
    /// Raw impl definition
    pub raw_definition: String,
}

/// Represents a function in a Soroban contract
#[derive(Debug, Clone, PartialEq)]
pub struct SorobanFunction {
    /// Name of the function
    pub name: String,
    /// Function parameters
    pub params: Vec<SorobanParam>,
    /// Return type
    pub return_type: Option<String>,
    /// Visibility (public, private)
    pub visibility: FunctionVisibility,
    /// Whether it's a constructor function
    pub is_constructor: bool,
    /// Line number where the function is defined
    pub line_number: usize,
    /// Raw function definition
    pub raw_definition: String,
}

/// Represents a function parameter
#[derive(Debug, Clone, PartialEq)]
pub struct SorobanParam {
    /// Parameter name
    pub name: String,
    /// Parameter type
    pub type_name: String,
}

/// Function visibility modifiers
#[derive(Debug, Clone, PartialEq)]
pub enum FunctionVisibility {
    Public,
    Private,
}

/// Error types for Soroban parsing
#[derive(Debug, thiserror::Error)]
pub enum SorobanParseError {
    #[error("Failed to parse Soroban contract: {0}")]
    ParseError(String),
    
    #[error("Missing required Soroban macro: {0}")]
    MissingMacro(String),
    
    #[error("Invalid contract structure: {0}")]
    InvalidStructure(String),
    
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
}

/// Result type for Soroban parsing operations
pub type SorobanResult<T> = Result<T, SorobanParseError>;