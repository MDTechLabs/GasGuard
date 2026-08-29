//! DSL error types.

use thiserror::Error;

/// Span within DSL source text (byte offsets, 0-based).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Span {
    pub start: usize,
    pub end: usize,
    /// 1-based line number.
    pub line: usize,
    /// 1-based column number.
    pub col: usize,
}

impl Span {
    pub fn new(start: usize, end: usize, line: usize, col: usize) -> Self {
        Self {
            start,
            end,
            line,
            col,
        }
    }
}

impl std::fmt::Display for Span {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "line {}, col {}", self.line, self.col)
    }
}

/// All errors that can occur during DSL processing.
#[derive(Debug, Error)]
pub enum DslError {
    // ---- Lexer errors -------------------------------------------------------
    #[error("Unexpected character '{ch}' at {span}")]
    UnexpectedChar { ch: char, span: Span },

    #[error("Unterminated string literal starting at {span}")]
    UnterminatedString { span: Span },

    // ---- Parser errors ------------------------------------------------------
    #[error("Unexpected token '{found}' at {span}, expected {expected}")]
    UnexpectedToken {
        found: String,
        expected: String,
        span: Span,
    },

    #[error("Unexpected end of input, expected {expected}")]
    UnexpectedEof { expected: String },

    #[error("Duplicate field '{field}' in rule block at {span}")]
    DuplicateField { field: String, span: Span },

    #[error("Missing required field '{field}' in rule definition")]
    MissingField { field: String },

    // ---- Compiler errors ----------------------------------------------------
    #[error("Unknown predicate '{name}' at {span}")]
    UnknownPredicate { name: String, span: Span },

    #[error("Wrong number of arguments for predicate '{name}': expected {expected}, got {got} at {span}")]
    WrongArgCount {
        name: String,
        expected: usize,
        got: usize,
        span: Span,
    },

    #[error("Type mismatch in predicate '{name}' argument {arg_index}: {detail} at {span}")]
    TypeMismatch {
        name: String,
        arg_index: usize,
        detail: String,
        span: Span,
    },

    #[error(
        "Invalid severity '{value}' at {span}; expected one of: info, warning, error, critical"
    )]
    InvalidSeverity { value: String, span: Span },

    #[error("Invalid language '{value}' at {span}; expected one of: solidity, rust, vyper, any")]
    InvalidLanguage { value: String, span: Span },

    #[error("Regex compilation error in predicate '{name}': {detail}")]
    InvalidRegex { name: String, detail: String },

    // ---- Generic ------------------------------------------------------------
    #[error("{0}")]
    Other(String),
}

/// Convenience alias.
pub type DslResult<T> = Result<T, DslError>;
