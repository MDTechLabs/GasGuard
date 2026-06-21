//! DSL lexer — converts raw source text into a flat token stream.
//!
//! # DSL token grammar (informal)
//!
//! ```text
//! rule <id> {
//!     name:        "<string>"
//!     description: "<string>"
//!     severity:    info | warning | error | critical
//!     language:    solidity | rust | vyper | any
//!     tags:        [<ident>, ...]
//!
//!     when {
//!         <predicate>(<arg>, ...)
//!         and | or
//!         not <predicate>(...)
//!     }
//!
//!     message: "<string>"
//!     suggestion: "<string>"
//! }
//! ```

use super::error::{DslError, DslResult, Span};

// ---------------------------------------------------------------------------
// Token kinds
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub enum TokenKind {
    // Keywords
    Rule,
    When,
    And,
    Or,
    Not,

    // Punctuation
    LBrace,   // {
    RBrace,   // }
    LParen,   // (
    RParen,   // )
    LBracket, // [
    RBracket, // ]
    Comma,    // ,
    Colon,    // :
    Dot,      // .

    // Literals
    Ident(String),
    StringLit(String),
    IntLit(i64),
    FloatLit(f64),
    BoolLit(bool),

    // End of file
    Eof,
}

impl std::fmt::Display for TokenKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TokenKind::Rule => write!(f, "rule"),
            TokenKind::When => write!(f, "when"),
            TokenKind::And => write!(f, "and"),
            TokenKind::Or => write!(f, "or"),
            TokenKind::Not => write!(f, "not"),
            TokenKind::LBrace => write!(f, "{{"),
            TokenKind::RBrace => write!(f, "}}"),
            TokenKind::LParen => write!(f, "("),
            TokenKind::RParen => write!(f, ")"),
            TokenKind::LBracket => write!(f, "["),
            TokenKind::RBracket => write!(f, "]"),
            TokenKind::Comma => write!(f, ","),
            TokenKind::Colon => write!(f, ":"),
            TokenKind::Dot => write!(f, "."),
            TokenKind::Ident(s) => write!(f, "{}", s),
            TokenKind::StringLit(s) => write!(f, "\"{}\"", s),
            TokenKind::IntLit(n) => write!(f, "{}", n),
            TokenKind::FloatLit(n) => write!(f, "{}", n),
            TokenKind::BoolLit(b) => write!(f, "{}", b),
            TokenKind::Eof => write!(f, "<eof>"),
        }
    }
}

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct Token {
    pub kind: TokenKind,
    pub span: Span,
}

impl Token {
    pub fn new(kind: TokenKind, span: Span) -> Self {
        Self { kind, span }
    }
}

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------

pub struct Lexer<'src> {
    src: &'src str,
    chars: std::iter::Peekable<std::str::CharIndices<'src>>,
    pos: usize,
    line: usize,
    col: usize,
}

impl<'src> Lexer<'src> {
    pub fn new(src: &'src str) -> Self {
        Self {
            src,
            chars: src.char_indices().peekable(),
            pos: 0,
            line: 1,
            col: 1,
        }
    }

    /// Tokenise the entire source and return a `Vec<Token>` ending with `Eof`.
    pub fn tokenize(mut self) -> DslResult<Vec<Token>> {
        let mut tokens = Vec::new();
        loop {
            let tok = self.next_token()?;
            let is_eof = tok.kind == TokenKind::Eof;
            tokens.push(tok);
            if is_eof {
                break;
            }
        }
        Ok(tokens)
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    fn current_span(&self, start: usize, start_line: usize, start_col: usize) -> Span {
        Span::new(start, self.pos, start_line, start_col)
    }

    fn peek_char(&mut self) -> Option<char> {
        self.chars.peek().map(|(_, c)| *c)
    }

    fn advance(&mut self) -> Option<char> {
        if let Some((idx, ch)) = self.chars.next() {
            self.pos = idx + ch.len_utf8();
            if ch == '\n' {
                self.line += 1;
                self.col = 1;
            } else {
                self.col += 1;
            }
            Some(ch)
        } else {
            None
        }
    }

    fn skip_whitespace_and_comments(&mut self) {
        loop {
            match self.peek_char() {
                Some(c) if c.is_whitespace() => {
                    self.advance();
                }
                // Line comment: // ...
                Some('/') => {
                    // Peek two chars
                    let rest = &self.src[self.pos..];
                    if rest.starts_with("//") {
                        while let Some(c) = self.peek_char() {
                            if c == '\n' {
                                break;
                            }
                            self.advance();
                        }
                    } else {
                        break;
                    }
                }
                // Block comment: /* ... */
                Some('*') => {
                    let rest = &self.src[self.pos..];
                    if rest.starts_with("/*") {
                        self.advance(); // /
                        self.advance(); // *
                        loop {
                            match self.advance() {
                                None => break,
                                Some('*') => {
                                    if self.peek_char() == Some('/') {
                                        self.advance();
                                        break;
                                    }
                                }
                                _ => {}
                            }
                        }
                    } else {
                        break;
                    }
                }
                _ => break,
            }
        }
    }

    fn next_token(&mut self) -> DslResult<Token> {
        self.skip_whitespace_and_comments();

        let start = self.pos;
        let start_line = self.line;
        let start_col = self.col;

        let ch = match self.advance() {
            None => {
                return Ok(Token::new(
                    TokenKind::Eof,
                    Span::new(start, start, start_line, start_col),
                ))
            }
            Some(c) => c,
        };

        let kind = match ch {
            '{' => TokenKind::LBrace,
            '}' => TokenKind::RBrace,
            '(' => TokenKind::LParen,
            ')' => TokenKind::RParen,
            '[' => TokenKind::LBracket,
            ']' => TokenKind::RBracket,
            ',' => TokenKind::Comma,
            ':' => TokenKind::Colon,
            '.' => TokenKind::Dot,

            // String literal
            '"' => self.lex_string(start, start_line, start_col)?,

            // Number literal
            c if c.is_ascii_digit()
                || (c == '-' && self.peek_char().map_or(false, |p| p.is_ascii_digit())) =>
            {
                self.lex_number(c, start, start_line, start_col)?
            }

            // Identifier or keyword
            c if c.is_alphabetic() || c == '_' => {
                self.lex_ident_or_keyword(c, start, start_line, start_col)
            }

            other => {
                return Err(DslError::UnexpectedChar {
                    ch: other,
                    span: Span::new(start, self.pos, start_line, start_col),
                })
            }
        };

        Ok(Token::new(
            kind,
            self.current_span(start, start_line, start_col),
        ))
    }

    fn lex_string(&mut self, start: usize, line: usize, col: usize) -> DslResult<TokenKind> {
        let mut s = String::new();
        loop {
            match self.advance() {
                None => {
                    return Err(DslError::UnterminatedString {
                        span: Span::new(start, self.pos, line, col),
                    })
                }
                Some('"') => break,
                Some('\\') => {
                    // Escape sequences
                    match self.advance() {
                        Some('n') => s.push('\n'),
                        Some('t') => s.push('\t'),
                        Some('r') => s.push('\r'),
                        Some('\\') => s.push('\\'),
                        Some('"') => s.push('"'),
                        Some(c) => {
                            s.push('\\');
                            s.push(c);
                        }
                        None => {
                            return Err(DslError::UnterminatedString {
                                span: Span::new(start, self.pos, line, col),
                            })
                        }
                    }
                }
                Some(c) => s.push(c),
            }
        }
        Ok(TokenKind::StringLit(s))
    }

    fn lex_number(
        &mut self,
        first: char,
        start: usize,
        line: usize,
        col: usize,
    ) -> DslResult<TokenKind> {
        let mut raw = String::from(first);
        let mut is_float = false;

        while let Some(c) = self.peek_char() {
            if c.is_ascii_digit() {
                raw.push(c);
                self.advance();
            } else if c == '.' && !is_float {
                is_float = true;
                raw.push(c);
                self.advance();
            } else {
                break;
            }
        }

        if is_float {
            raw.parse::<f64>()
                .map(TokenKind::FloatLit)
                .map_err(|_| DslError::UnexpectedChar {
                    ch: '.',
                    span: Span::new(start, self.pos, line, col),
                })
        } else {
            raw.parse::<i64>()
                .map(TokenKind::IntLit)
                .map_err(|_| DslError::UnexpectedChar {
                    ch: first,
                    span: Span::new(start, self.pos, line, col),
                })
        }
    }

    fn lex_ident_or_keyword(
        &mut self,
        first: char,
        _start: usize,
        _line: usize,
        _col: usize,
    ) -> TokenKind {
        let mut ident = String::from(first);
        while let Some(c) = self.peek_char() {
            if c.is_alphanumeric() || c == '_' || c == '-' {
                ident.push(c);
                self.advance();
            } else {
                break;
            }
        }

        match ident.as_str() {
            "rule" => TokenKind::Rule,
            "when" => TokenKind::When,
            "and" => TokenKind::And,
            "or" => TokenKind::Or,
            "not" => TokenKind::Not,
            "true" => TokenKind::BoolLit(true),
            "false" => TokenKind::BoolLit(false),
            _ => TokenKind::Ident(ident),
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(src: &str) -> Vec<TokenKind> {
        Lexer::new(src)
            .tokenize()
            .unwrap()
            .into_iter()
            .map(|t| t.kind)
            .collect()
    }

    #[test]
    fn test_basic_tokens() {
        let toks = kinds("rule my-rule { }");
        assert_eq!(
            toks,
            vec![
                TokenKind::Rule,
                TokenKind::Ident("my-rule".into()),
                TokenKind::LBrace,
                TokenKind::RBrace,
                TokenKind::Eof,
            ]
        );
    }

    #[test]
    fn test_string_literal() {
        let toks = kinds(r#"name: "hello world""#);
        assert_eq!(
            toks,
            vec![
                TokenKind::Ident("name".into()),
                TokenKind::Colon,
                TokenKind::StringLit("hello world".into()),
                TokenKind::Eof,
            ]
        );
    }

    #[test]
    fn test_line_comment_skipped() {
        let toks = kinds("rule // this is a comment\n foo");
        assert_eq!(
            toks,
            vec![
                TokenKind::Rule,
                TokenKind::Ident("foo".into()),
                TokenKind::Eof,
            ]
        );
    }

    #[test]
    fn test_integer_literal() {
        let toks = kinds("42");
        assert_eq!(toks, vec![TokenKind::IntLit(42), TokenKind::Eof]);
    }

    #[test]
    fn test_bool_literals() {
        let toks = kinds("true false");
        assert_eq!(
            toks,
            vec![
                TokenKind::BoolLit(true),
                TokenKind::BoolLit(false),
                TokenKind::Eof
            ]
        );
    }

    #[test]
    fn test_when_and_or_not() {
        let toks = kinds("when and or not");
        assert_eq!(
            toks,
            vec![
                TokenKind::When,
                TokenKind::And,
                TokenKind::Or,
                TokenKind::Not,
                TokenKind::Eof,
            ]
        );
    }
}
