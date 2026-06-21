//! Built-in predicates available in the DSL `when` block.
//!
//! Each predicate is a named function that takes a list of [`Arg`]s and
//! evaluates against a source file, returning a list of [`Match`]es (line
//! numbers + optional captured text).
//!
//! # Catalogue
//!
//! | Predicate | Args | Description |
//! |-----------|------|-------------|
//! | `contains_pattern(pattern)` | 1 string (literal or regex) | True when the source contains the pattern |
//! | `matches_regex(pattern)` | 1 string regex | True when any line matches the regex |
//! | `line_count_exceeds(n)` | 1 int | True when the file has more than `n` lines |
//! | `function_count_exceeds(n)` | 1 int | True when the file has more than `n` function definitions |
//! | `has_keyword(kw)` | 1 string/ident | True when the source contains the keyword as a whole word |
//! | `lacks_keyword(kw)` | 1 string/ident | True when the source does NOT contain the keyword |
//! | `identifier_matches(pattern)` | 1 string regex | True when any identifier matches the regex |
//! | `comment_ratio_below(pct)` | 1 float (0.0–1.0) | True when comment lines / total lines < pct |
//! | `nesting_depth_exceeds(n)` | 1 int | True when brace nesting depth exceeds `n` |
//! | `always()` | 0 | Always true (useful for unconditional rules) |
//! | `never()` | 0 | Always false (useful for disabled rules) |

use super::{
    ast::Arg,
    error::{DslError, DslResult, Span},
};
use regex::Regex;

// ---------------------------------------------------------------------------
// Match — a single location where a predicate fired
// ---------------------------------------------------------------------------

/// A location in the source where a predicate matched.
#[derive(Debug, Clone)]
pub struct PredicateMatch {
    /// 1-based line number.
    pub line: u32,
    /// Optional column offset.
    pub column: Option<u32>,
    /// The matched text snippet (may be empty).
    pub snippet: String,
}

impl PredicateMatch {
    pub fn new(line: u32, snippet: impl Into<String>) -> Self {
        Self {
            line,
            column: None,
            snippet: snippet.into(),
        }
    }

    pub fn with_column(mut self, col: u32) -> Self {
        self.column = Some(col);
        self
    }
}

// ---------------------------------------------------------------------------
// Predicate descriptor
// ---------------------------------------------------------------------------

/// Metadata about a built-in predicate.
#[derive(Debug, Clone)]
pub struct PredicateDescriptor {
    pub name: &'static str,
    pub description: &'static str,
    /// Expected number of arguments (`None` = variadic).
    pub arity: Option<usize>,
}

/// All registered built-in predicates.
pub fn all_descriptors() -> Vec<PredicateDescriptor> {
    vec![
        PredicateDescriptor {
            name: "contains_pattern",
            description: "True when source contains the literal or regex pattern",
            arity: Some(1),
        },
        PredicateDescriptor {
            name: "matches_regex",
            description: "True when any line matches the regex",
            arity: Some(1),
        },
        PredicateDescriptor {
            name: "line_count_exceeds",
            description: "True when file has more than N lines",
            arity: Some(1),
        },
        PredicateDescriptor {
            name: "function_count_exceeds",
            description: "True when file has more than N function definitions",
            arity: Some(1),
        },
        PredicateDescriptor {
            name: "has_keyword",
            description: "True when source contains the keyword as a whole word",
            arity: Some(1),
        },
        PredicateDescriptor {
            name: "lacks_keyword",
            description: "True when source does NOT contain the keyword",
            arity: Some(1),
        },
        PredicateDescriptor {
            name: "identifier_matches",
            description: "True when any identifier matches the regex",
            arity: Some(1),
        },
        PredicateDescriptor {
            name: "comment_ratio_below",
            description: "True when comment ratio < threshold",
            arity: Some(1),
        },
        PredicateDescriptor {
            name: "nesting_depth_exceeds",
            description: "True when brace nesting depth exceeds N",
            arity: Some(1),
        },
        PredicateDescriptor {
            name: "always",
            description: "Always true",
            arity: Some(0),
        },
        PredicateDescriptor {
            name: "never",
            description: "Always false",
            arity: Some(0),
        },
    ]
}

/// Returns `true` if `name` is a known built-in predicate.
pub fn is_known(name: &str) -> bool {
    all_descriptors().iter().any(|d| d.name == name)
}

// ---------------------------------------------------------------------------
// Evaluation context
// ---------------------------------------------------------------------------

/// Everything a predicate needs to evaluate itself.
pub struct EvalContext<'a> {
    pub file_path: &'a str,
    pub source: &'a str,
}

impl<'a> EvalContext<'a> {
    pub fn new(file_path: &'a str, source: &'a str) -> Self {
        Self { file_path, source }
    }
}

// ---------------------------------------------------------------------------
// Predicate evaluation
// ---------------------------------------------------------------------------

/// Evaluate a named predicate against the given context.
///
/// Returns `Ok(Vec<PredicateMatch>)` — an empty vec means the predicate did
/// not match; a non-empty vec means it matched (each entry is a location).
pub fn evaluate(
    name: &str,
    args: &[Arg],
    ctx: &EvalContext<'_>,
    span: &Span,
) -> DslResult<Vec<PredicateMatch>> {
    match name {
        "contains_pattern" => eval_contains_pattern(args, ctx, span),
        "matches_regex" => eval_matches_regex(args, ctx, span),
        "line_count_exceeds" => eval_line_count_exceeds(args, ctx, span),
        "function_count_exceeds" => eval_function_count_exceeds(args, ctx, span),
        "has_keyword" => eval_has_keyword(args, ctx, span),
        "lacks_keyword" => eval_lacks_keyword(args, ctx, span),
        "identifier_matches" => eval_identifier_matches(args, ctx, span),
        "comment_ratio_below" => eval_comment_ratio_below(args, ctx, span),
        "nesting_depth_exceeds" => eval_nesting_depth_exceeds(args, ctx, span),
        "always" => Ok(vec![PredicateMatch::new(1, "always")]),
        "never" => Ok(vec![]),
        unknown => Err(DslError::UnknownPredicate {
            name: unknown.to_string(),
            span: span.clone(),
        }),
    }
}

// ---------------------------------------------------------------------------
// Individual predicate implementations
// ---------------------------------------------------------------------------

fn require_string_arg<'a>(args: &'a [Arg], predicate: &str, span: &Span) -> DslResult<&'a str> {
    if args.len() != 1 {
        return Err(DslError::WrongArgCount {
            name: predicate.to_string(),
            expected: 1,
            got: args.len(),
            span: span.clone(),
        });
    }
    match &args[0] {
        Arg::String(s) | Arg::Ident(s) => Ok(s.as_str()),
        _ => Err(DslError::TypeMismatch {
            name: predicate.to_string(),
            arg_index: 0,
            detail: "expected a string or identifier".into(),
            span: span.clone(),
        }),
    }
}

fn require_int_arg(args: &[Arg], predicate: &str, span: &Span) -> DslResult<i64> {
    if args.len() != 1 {
        return Err(DslError::WrongArgCount {
            name: predicate.to_string(),
            expected: 1,
            got: args.len(),
            span: span.clone(),
        });
    }
    match &args[0] {
        Arg::Int(n) => Ok(*n),
        _ => Err(DslError::TypeMismatch {
            name: predicate.to_string(),
            arg_index: 0,
            detail: "expected an integer".into(),
            span: span.clone(),
        }),
    }
}

fn require_float_arg(args: &[Arg], predicate: &str, span: &Span) -> DslResult<f64> {
    if args.len() != 1 {
        return Err(DslError::WrongArgCount {
            name: predicate.to_string(),
            expected: 1,
            got: args.len(),
            span: span.clone(),
        });
    }
    match &args[0] {
        Arg::Float(f) => Ok(*f),
        Arg::Int(n) => Ok(*n as f64),
        _ => Err(DslError::TypeMismatch {
            name: predicate.to_string(),
            arg_index: 0,
            detail: "expected a number".into(),
            span: span.clone(),
        }),
    }
}

fn compile_regex(pattern: &str, predicate: &str) -> DslResult<Regex> {
    Regex::new(pattern).map_err(|e| DslError::InvalidRegex {
        name: predicate.to_string(),
        detail: e.to_string(),
    })
}

// --- contains_pattern -------------------------------------------------------

fn eval_contains_pattern(
    args: &[Arg],
    ctx: &EvalContext<'_>,
    span: &Span,
) -> DslResult<Vec<PredicateMatch>> {
    let pattern = require_string_arg(args, "contains_pattern", span)?;
    let re = compile_regex(pattern, "contains_pattern")?;
    let mut matches = Vec::new();
    for (line_idx, line) in ctx.source.lines().enumerate() {
        if let Some(m) = re.find(line) {
            matches.push(
                PredicateMatch::new((line_idx + 1) as u32, m.as_str())
                    .with_column((m.start() + 1) as u32),
            );
        }
    }
    Ok(matches)
}

// --- matches_regex ----------------------------------------------------------

fn eval_matches_regex(
    args: &[Arg],
    ctx: &EvalContext<'_>,
    span: &Span,
) -> DslResult<Vec<PredicateMatch>> {
    // Same implementation as contains_pattern — regex is always used
    eval_contains_pattern(args, ctx, span)
}

// --- line_count_exceeds -----------------------------------------------------

fn eval_line_count_exceeds(
    args: &[Arg],
    ctx: &EvalContext<'_>,
    span: &Span,
) -> DslResult<Vec<PredicateMatch>> {
    let threshold = require_int_arg(args, "line_count_exceeds", span)?;
    let count = ctx.source.lines().count() as i64;
    if count > threshold {
        Ok(vec![PredicateMatch::new(
            1,
            format!("{} lines (threshold: {})", count, threshold),
        )])
    } else {
        Ok(vec![])
    }
}

// --- function_count_exceeds -------------------------------------------------

fn eval_function_count_exceeds(
    args: &[Arg],
    ctx: &EvalContext<'_>,
    span: &Span,
) -> DslResult<Vec<PredicateMatch>> {
    let threshold = require_int_arg(args, "function_count_exceeds", span)?;
    // Heuristic: count `fn ` occurrences (Rust) or `function ` (Solidity/JS)
    let fn_re = Regex::new(r"\b(fn|function|def)\s+\w+").unwrap();
    let count = fn_re.find_iter(ctx.source).count() as i64;
    if count > threshold {
        Ok(vec![PredicateMatch::new(
            1,
            format!("{} functions (threshold: {})", count, threshold),
        )])
    } else {
        Ok(vec![])
    }
}

// --- has_keyword ------------------------------------------------------------

fn eval_has_keyword(
    args: &[Arg],
    ctx: &EvalContext<'_>,
    span: &Span,
) -> DslResult<Vec<PredicateMatch>> {
    let kw = require_string_arg(args, "has_keyword", span)?;
    let pattern = format!(r"\b{}\b", regex::escape(kw));
    let re = compile_regex(&pattern, "has_keyword")?;
    let mut matches = Vec::new();
    for (line_idx, line) in ctx.source.lines().enumerate() {
        if let Some(m) = re.find(line) {
            matches.push(
                PredicateMatch::new((line_idx + 1) as u32, m.as_str())
                    .with_column((m.start() + 1) as u32),
            );
        }
    }
    Ok(matches)
}

// --- lacks_keyword ----------------------------------------------------------

fn eval_lacks_keyword(
    args: &[Arg],
    ctx: &EvalContext<'_>,
    span: &Span,
) -> DslResult<Vec<PredicateMatch>> {
    let kw = require_string_arg(args, "lacks_keyword", span)?;
    let pattern = format!(r"\b{}\b", regex::escape(kw));
    let re = compile_regex(&pattern, "lacks_keyword")?;
    // Fires once (at line 1) if the keyword is absent from the entire file
    if !re.is_match(ctx.source) {
        Ok(vec![PredicateMatch::new(
            1,
            format!("keyword '{}' not found", kw),
        )])
    } else {
        Ok(vec![])
    }
}

// --- identifier_matches -----------------------------------------------------

fn eval_identifier_matches(
    args: &[Arg],
    ctx: &EvalContext<'_>,
    span: &Span,
) -> DslResult<Vec<PredicateMatch>> {
    let pattern = require_string_arg(args, "identifier_matches", span)?;
    // Wrap in word boundaries so we match whole identifiers
    let full_pattern = format!(r"\b{}\b", pattern);
    let re = compile_regex(&full_pattern, "identifier_matches")?;
    let mut matches = Vec::new();
    for (line_idx, line) in ctx.source.lines().enumerate() {
        for m in re.find_iter(line) {
            matches.push(
                PredicateMatch::new((line_idx + 1) as u32, m.as_str())
                    .with_column((m.start() + 1) as u32),
            );
        }
    }
    Ok(matches)
}

// --- comment_ratio_below ----------------------------------------------------

fn eval_comment_ratio_below(
    args: &[Arg],
    ctx: &EvalContext<'_>,
    span: &Span,
) -> DslResult<Vec<PredicateMatch>> {
    let threshold = require_float_arg(args, "comment_ratio_below", span)?;
    let lines: Vec<&str> = ctx.source.lines().collect();
    let total = lines.len();
    if total == 0 {
        return Ok(vec![]);
    }
    let comment_re = Regex::new(r"^\s*(//|#|/\*|\*)").unwrap();
    let comment_count = lines.iter().filter(|l| comment_re.is_match(l)).count();
    let ratio = comment_count as f64 / total as f64;
    if ratio < threshold {
        Ok(vec![PredicateMatch::new(
            1,
            format!("comment ratio {:.2} < threshold {:.2}", ratio, threshold),
        )])
    } else {
        Ok(vec![])
    }
}

// --- nesting_depth_exceeds --------------------------------------------------

fn eval_nesting_depth_exceeds(
    args: &[Arg],
    ctx: &EvalContext<'_>,
    span: &Span,
) -> DslResult<Vec<PredicateMatch>> {
    let threshold = require_int_arg(args, "nesting_depth_exceeds", span)?;
    let mut depth: i64 = 0;
    let mut max_depth: i64 = 0;
    let mut max_line: u32 = 1;

    for (line_idx, line) in ctx.source.lines().enumerate() {
        for ch in line.chars() {
            match ch {
                '{' => {
                    depth += 1;
                    if depth > max_depth {
                        max_depth = depth;
                        max_line = (line_idx + 1) as u32;
                    }
                }
                '}' => {
                    depth = depth.saturating_sub(1);
                }
                _ => {}
            }
        }
    }

    if max_depth > threshold {
        Ok(vec![PredicateMatch::new(
            max_line,
            format!("max nesting depth {} (threshold: {})", max_depth, threshold),
        )])
    } else {
        Ok(vec![])
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsl::error::Span;

    fn dummy_span() -> Span {
        Span::new(0, 0, 1, 1)
    }

    fn ctx<'a>(source: &'a str) -> EvalContext<'a> {
        EvalContext::new("test.rs", source)
    }

    #[test]
    fn test_contains_pattern_match() {
        let args = vec![Arg::String("unsafe".into())];
        let result = evaluate(
            "contains_pattern",
            &args,
            &ctx("fn foo() { unsafe { } }"),
            &dummy_span(),
        )
        .unwrap();
        assert!(!result.is_empty());
        assert_eq!(result[0].line, 1);
    }

    #[test]
    fn test_contains_pattern_no_match() {
        let args = vec![Arg::String("unsafe".into())];
        let result = evaluate(
            "contains_pattern",
            &args,
            &ctx("fn foo() { }"),
            &dummy_span(),
        )
        .unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_has_keyword_whole_word() {
        let args = vec![Arg::String("loop".into())];
        // "loop" as a whole word
        let result = evaluate("has_keyword", &args, &ctx("loop { }"), &dummy_span()).unwrap();
        assert!(!result.is_empty());
        // "looping" should NOT match
        let result2 = evaluate("has_keyword", &args, &ctx("looping { }"), &dummy_span()).unwrap();
        assert!(result2.is_empty());
    }

    #[test]
    fn test_lacks_keyword() {
        let args = vec![Arg::String("require".into())];
        let result = evaluate("lacks_keyword", &args, &ctx("fn foo() { }"), &dummy_span()).unwrap();
        assert!(!result.is_empty()); // fires because "require" is absent
        let result2 = evaluate(
            "lacks_keyword",
            &args,
            &ctx("require(x > 0);"),
            &dummy_span(),
        )
        .unwrap();
        assert!(result2.is_empty()); // does not fire because "require" is present
    }

    #[test]
    fn test_line_count_exceeds() {
        let src = "a\nb\nc\nd\ne";
        let args = vec![Arg::Int(3)];
        let result = evaluate("line_count_exceeds", &args, &ctx(src), &dummy_span()).unwrap();
        assert!(!result.is_empty());
        let args2 = vec![Arg::Int(10)];
        let result2 = evaluate("line_count_exceeds", &args2, &ctx(src), &dummy_span()).unwrap();
        assert!(result2.is_empty());
    }

    #[test]
    fn test_nesting_depth_exceeds() {
        let src = "fn a() { fn b() { fn c() { fn d() { } } } }";
        let args = vec![Arg::Int(3)];
        let result = evaluate("nesting_depth_exceeds", &args, &ctx(src), &dummy_span()).unwrap();
        assert!(!result.is_empty());
    }

    #[test]
    fn test_always_never() {
        let result = evaluate("always", &[], &ctx(""), &dummy_span()).unwrap();
        assert!(!result.is_empty());
        let result2 = evaluate("never", &[], &ctx(""), &dummy_span()).unwrap();
        assert!(result2.is_empty());
    }

    #[test]
    fn test_unknown_predicate_error() {
        let result = evaluate("does_not_exist", &[], &ctx(""), &dummy_span());
        assert!(result.is_err());
    }

    #[test]
    fn test_wrong_arg_count_error() {
        let result = evaluate("contains_pattern", &[], &ctx(""), &dummy_span());
        assert!(result.is_err());
    }
}
