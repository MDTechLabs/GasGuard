//! DSL parser — converts a flat token stream into a [`DslFile`] AST.

use super::{
    ast::{Arg, Condition, DslFile, DslLanguage, DslSeverity, RuleDefinition},
    error::{DslError, DslResult, Span},
    lexer::{Token, TokenKind},
};

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

pub struct Parser {
    tokens: Vec<Token>,
    pos: usize,
}

impl Parser {
    pub fn new(tokens: Vec<Token>) -> Self {
        Self { tokens, pos: 0 }
    }

    // -----------------------------------------------------------------------
    // Token navigation helpers
    // -----------------------------------------------------------------------

    #[allow(dead_code)]
    fn peek(&self) -> &Token {
        &self.tokens[self.pos]
    }

    fn peek_kind(&self) -> &TokenKind {
        &self.tokens[self.pos].kind
    }

    fn advance(&mut self) -> &Token {
        let tok = &self.tokens[self.pos];
        if self.pos + 1 < self.tokens.len() {
            self.pos += 1;
        }
        tok
    }

    fn current_span(&self) -> Span {
        self.tokens[self.pos].span.clone()
    }

    /// Consume the next token and assert it matches `expected_kind`.
    fn expect(&mut self, expected: &TokenKind) -> DslResult<&Token> {
        let tok = self.advance();
        if &tok.kind == expected {
            // SAFETY: we just advanced, so pos > 0
            Ok(&self.tokens[self.pos - 1])
        } else {
            Err(DslError::UnexpectedToken {
                found: tok.kind.to_string(),
                expected: expected.to_string(),
                span: tok.span.clone(),
            })
        }
    }

    /// Consume the next token if it matches `kind`, returning true.
    fn eat(&mut self, kind: &TokenKind) -> bool {
        if self.peek_kind() == kind {
            self.advance();
            true
        } else {
            false
        }
    }

    fn is_eof(&self) -> bool {
        matches!(self.peek_kind(), TokenKind::Eof)
    }

    // -----------------------------------------------------------------------
    // Top-level parse
    // -----------------------------------------------------------------------

    pub fn parse(mut self) -> DslResult<DslFile> {
        let mut rules = Vec::new();
        while !self.is_eof() {
            rules.push(self.parse_rule()?);
        }
        Ok(DslFile { rules })
    }

    // -----------------------------------------------------------------------
    // Rule definition
    // -----------------------------------------------------------------------

    fn parse_rule(&mut self) -> DslResult<RuleDefinition> {
        let start_span = self.current_span();

        // `rule`
        self.expect(&TokenKind::Rule)?;

        // `<id>`
        let id = self.expect_ident("rule identifier")?;

        // `{`
        self.expect(&TokenKind::LBrace)?;

        // Fields
        let mut name: Option<String> = None;
        let mut description: Option<String> = None;
        let mut severity: Option<DslSeverity> = None;
        let mut language: Option<DslLanguage> = None;
        let mut tags: Vec<String> = Vec::new();
        let mut condition: Option<Condition> = None;
        let mut message: Option<String> = None;
        let mut suggestion: Option<String> = None;

        while !matches!(self.peek_kind(), TokenKind::RBrace | TokenKind::Eof) {
            let field_span = self.current_span();

            // `when` is a reserved keyword token, not an Ident — handle it first.
            if self.eat(&TokenKind::When) {
                let cond = self.parse_when_block()?;
                if condition.replace(cond).is_some() {
                    return Err(DslError::DuplicateField {
                        field: "when".into(),
                        span: field_span,
                    });
                }
                continue;
            }

            let field = self.expect_ident("field name")?;

            match field.as_str() {
                "name" => {
                    self.expect(&TokenKind::Colon)?;
                    let v = self.expect_string("name value")?;
                    if name.replace(v).is_some() {
                        return Err(DslError::DuplicateField {
                            field: "name".into(),
                            span: field_span,
                        });
                    }
                }
                "description" => {
                    self.expect(&TokenKind::Colon)?;
                    let v = self.expect_string("description value")?;
                    if description.replace(v).is_some() {
                        return Err(DslError::DuplicateField {
                            field: "description".into(),
                            span: field_span,
                        });
                    }
                }
                "severity" => {
                    self.expect(&TokenKind::Colon)?;
                    let v = self.parse_severity()?;
                    if severity.replace(v).is_some() {
                        return Err(DslError::DuplicateField {
                            field: "severity".into(),
                            span: field_span,
                        });
                    }
                }
                "language" => {
                    self.expect(&TokenKind::Colon)?;
                    let v = self.parse_language()?;
                    if language.replace(v).is_some() {
                        return Err(DslError::DuplicateField {
                            field: "language".into(),
                            span: field_span,
                        });
                    }
                }
                "tags" => {
                    self.expect(&TokenKind::Colon)?;
                    tags = self.parse_tag_list()?;
                }
                "message" => {
                    self.expect(&TokenKind::Colon)?;
                    let v = self.expect_string("message value")?;
                    if message.replace(v).is_some() {
                        return Err(DslError::DuplicateField {
                            field: "message".into(),
                            span: field_span,
                        });
                    }
                }
                "suggestion" => {
                    self.expect(&TokenKind::Colon)?;
                    let v = self.expect_string("suggestion value")?;
                    suggestion = Some(v);
                }
                unknown => {
                    return Err(DslError::UnexpectedToken {
                        found: unknown.to_string(),
                        expected: "name | description | severity | language | tags | when | message | suggestion".into(),
                        span: field_span,
                    });
                }
            }
        }

        // `}`
        let end_span = self.current_span();
        self.expect(&TokenKind::RBrace)?;

        // Validate required fields
        let name = name.ok_or_else(|| DslError::MissingField {
            field: "name".into(),
        })?;
        let description = description.ok_or_else(|| DslError::MissingField {
            field: "description".into(),
        })?;
        let severity = severity.ok_or_else(|| DslError::MissingField {
            field: "severity".into(),
        })?;
        let language = language.unwrap_or(DslLanguage::Any);
        let condition = condition.ok_or_else(|| DslError::MissingField {
            field: "when".into(),
        })?;
        let message = message.ok_or_else(|| DslError::MissingField {
            field: "message".into(),
        })?;

        Ok(RuleDefinition {
            id,
            name,
            description,
            severity,
            language,
            tags,
            condition,
            message,
            suggestion,
            span: Span::new(
                start_span.start,
                end_span.end,
                start_span.line,
                start_span.col,
            ),
        })
    }

    // -----------------------------------------------------------------------
    // Field value parsers
    // -----------------------------------------------------------------------

    fn parse_severity(&mut self) -> DslResult<DslSeverity> {
        let tok = self.advance();
        let span = tok.span.clone();
        match &tok.kind {
            TokenKind::Ident(s) => match s.as_str() {
                "info" => Ok(DslSeverity::Info),
                "warning" => Ok(DslSeverity::Warning),
                "error" => Ok(DslSeverity::Error),
                "critical" => Ok(DslSeverity::Critical),
                other => Err(DslError::InvalidSeverity {
                    value: other.to_string(),
                    span,
                }),
            },
            other => Err(DslError::UnexpectedToken {
                found: other.to_string(),
                expected: "info | warning | error | critical".into(),
                span,
            }),
        }
    }

    fn parse_language(&mut self) -> DslResult<DslLanguage> {
        let tok = self.advance();
        let span = tok.span.clone();
        match &tok.kind {
            TokenKind::Ident(s) => match s.as_str() {
                "solidity" => Ok(DslLanguage::Solidity),
                "rust" => Ok(DslLanguage::Rust),
                "vyper" => Ok(DslLanguage::Vyper),
                "any" => Ok(DslLanguage::Any),
                other => Err(DslError::InvalidLanguage {
                    value: other.to_string(),
                    span,
                }),
            },
            other => Err(DslError::UnexpectedToken {
                found: other.to_string(),
                expected: "solidity | rust | vyper | any".into(),
                span,
            }),
        }
    }

    fn parse_tag_list(&mut self) -> DslResult<Vec<String>> {
        self.expect(&TokenKind::LBracket)?;
        let mut tags = Vec::new();
        while !matches!(self.peek_kind(), TokenKind::RBracket | TokenKind::Eof) {
            let tag = self.expect_ident_or_string("tag")?;
            tags.push(tag);
            if !self.eat(&TokenKind::Comma) {
                break;
            }
        }
        self.expect(&TokenKind::RBracket)?;
        Ok(tags)
    }

    // -----------------------------------------------------------------------
    // `when` block
    // -----------------------------------------------------------------------

    fn parse_when_block(&mut self) -> DslResult<Condition> {
        self.expect(&TokenKind::LBrace)?;
        let cond = self.parse_condition()?;
        self.expect(&TokenKind::RBrace)?;
        Ok(cond)
    }

    // -----------------------------------------------------------------------
    // Condition expression (recursive descent)
    // -----------------------------------------------------------------------

    fn parse_condition(&mut self) -> DslResult<Condition> {
        self.parse_or_expr()
    }

    fn parse_or_expr(&mut self) -> DslResult<Condition> {
        let mut left = self.parse_and_expr()?;
        while self.eat(&TokenKind::Or) {
            let right = self.parse_and_expr()?;
            left = Condition::Or(Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    fn parse_and_expr(&mut self) -> DslResult<Condition> {
        let mut left = self.parse_unary()?;
        while self.eat(&TokenKind::And) {
            let right = self.parse_unary()?;
            left = Condition::And(Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    fn parse_unary(&mut self) -> DslResult<Condition> {
        if self.eat(&TokenKind::Not) {
            let inner = self.parse_unary()?;
            return Ok(Condition::Not(Box::new(inner)));
        }
        self.parse_primary()
    }

    fn parse_primary(&mut self) -> DslResult<Condition> {
        // Parenthesised sub-expression
        if self.eat(&TokenKind::LParen) {
            let cond = self.parse_condition()?;
            self.expect(&TokenKind::RParen)?;
            return Ok(cond);
        }

        // Predicate call: `name(args...)`
        let span = self.current_span();
        let name = self.expect_ident("predicate name")?;
        self.expect(&TokenKind::LParen)?;
        let args = self.parse_arg_list()?;
        self.expect(&TokenKind::RParen)?;

        Ok(Condition::Predicate { name, args, span })
    }

    fn parse_arg_list(&mut self) -> DslResult<Vec<Arg>> {
        let mut args = Vec::new();
        while !matches!(self.peek_kind(), TokenKind::RParen | TokenKind::Eof) {
            args.push(self.parse_arg()?);
            if !self.eat(&TokenKind::Comma) {
                break;
            }
        }
        Ok(args)
    }

    fn parse_arg(&mut self) -> DslResult<Arg> {
        let tok = self.advance();
        match &tok.kind {
            TokenKind::StringLit(s) => Ok(Arg::String(s.clone())),
            TokenKind::IntLit(n) => Ok(Arg::Int(*n)),
            TokenKind::FloatLit(f) => Ok(Arg::Float(*f)),
            TokenKind::BoolLit(b) => Ok(Arg::Bool(*b)),
            TokenKind::Ident(s) => Ok(Arg::Ident(s.clone())),
            other => Err(DslError::UnexpectedToken {
                found: other.to_string(),
                expected: "argument value (string, number, bool, or identifier)".into(),
                span: tok.span.clone(),
            }),
        }
    }

    // -----------------------------------------------------------------------
    // Utility helpers
    // -----------------------------------------------------------------------

    fn expect_ident(&mut self, context: &str) -> DslResult<String> {
        let tok = self.advance();
        match &tok.kind {
            TokenKind::Ident(s) => Ok(s.clone()),
            other => Err(DslError::UnexpectedToken {
                found: other.to_string(),
                expected: format!("{} (identifier)", context),
                span: tok.span.clone(),
            }),
        }
    }

    fn expect_string(&mut self, context: &str) -> DslResult<String> {
        let tok = self.advance();
        match &tok.kind {
            TokenKind::StringLit(s) => Ok(s.clone()),
            other => Err(DslError::UnexpectedToken {
                found: other.to_string(),
                expected: format!("{} (string literal)", context),
                span: tok.span.clone(),
            }),
        }
    }

    fn expect_ident_or_string(&mut self, context: &str) -> DslResult<String> {
        let tok = self.advance();
        match &tok.kind {
            TokenKind::Ident(s) | TokenKind::StringLit(s) => Ok(s.clone()),
            other => Err(DslError::UnexpectedToken {
                found: other.to_string(),
                expected: format!("{} (identifier or string)", context),
                span: tok.span.clone(),
            }),
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsl::lexer::Lexer;

    fn parse(src: &str) -> DslFile {
        let tokens = Lexer::new(src).tokenize().expect("lex failed");
        Parser::new(tokens).parse().expect("parse failed")
    }

    #[test]
    fn test_minimal_rule() {
        let src = r#"
            rule no-unbounded-loop {
                name:        "No Unbounded Loop"
                description: "Detects loops without a fixed bound"
                severity:    warning
                language:    rust
                when {
                    contains_pattern("loop")
                }
                message: "Unbounded loop detected"
            }
        "#;
        let file = parse(src);
        assert_eq!(file.rules.len(), 1);
        let rule = &file.rules[0];
        assert_eq!(rule.id, "no-unbounded-loop");
        assert_eq!(rule.name, "No Unbounded Loop");
        assert_eq!(rule.severity, DslSeverity::Warning);
        assert_eq!(rule.language, DslLanguage::Rust);
        assert!(rule.suggestion.is_none());
    }

    #[test]
    fn test_rule_with_and_condition() {
        let src = r#"
            rule complex-rule {
                name:        "Complex"
                description: "A complex rule"
                severity:    error
                when {
                    contains_pattern("unsafe") and not contains_pattern("safe_wrapper")
                }
                message: "Unsafe usage without wrapper"
            }
        "#;
        let file = parse(src);
        assert_eq!(file.rules.len(), 1);
        let cond = &file.rules[0].condition;
        assert!(matches!(cond, Condition::And(_, _)));
    }

    #[test]
    fn test_rule_with_tags_and_suggestion() {
        let src = r#"
            rule tagged-rule {
                name:        "Tagged"
                description: "Has tags"
                severity:    info
                tags:        [gas, optimization]
                when {
                    contains_pattern("expensive_op")
                }
                message:    "Expensive operation found"
                suggestion: "Use a cheaper alternative"
            }
        "#;
        let file = parse(src);
        let rule = &file.rules[0];
        assert_eq!(rule.tags, vec!["gas", "optimization"]);
        assert_eq!(
            rule.suggestion.as_deref(),
            Some("Use a cheaper alternative")
        );
    }

    #[test]
    fn test_multiple_rules() {
        let src = r#"
            rule rule-a {
                name: "A" description: "desc a" severity: info
                when { contains_pattern("a") }
                message: "msg a"
            }
            rule rule-b {
                name: "B" description: "desc b" severity: warning
                when { contains_pattern("b") }
                message: "msg b"
            }
        "#;
        let file = parse(src);
        assert_eq!(file.rules.len(), 2);
    }

    #[test]
    fn test_or_condition() {
        let src = r#"
            rule or-rule {
                name: "Or" description: "d" severity: info
                when { contains_pattern("a") or contains_pattern("b") }
                message: "m"
            }
        "#;
        let file = parse(src);
        assert!(matches!(file.rules[0].condition, Condition::Or(_, _)));
    }

    #[test]
    fn test_not_condition() {
        let src = r#"
            rule not-rule {
                name: "Not" description: "d" severity: info
                when { not contains_pattern("safe") }
                message: "m"
            }
        "#;
        let file = parse(src);
        assert!(matches!(file.rules[0].condition, Condition::Not(_)));
    }

    #[test]
    fn test_missing_required_field_error() {
        let src = r#"
            rule bad-rule {
                name: "Bad"
                severity: info
                when { contains_pattern("x") }
                message: "m"
            }
        "#;
        let tokens = Lexer::new(src).tokenize().unwrap();
        let result = Parser::new(tokens).parse();
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(
            err.contains("description"),
            "expected missing-field error for 'description', got: {}",
            err
        );
    }
}
