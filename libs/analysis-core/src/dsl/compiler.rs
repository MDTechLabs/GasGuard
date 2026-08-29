//! DSL compiler — walks a [`RuleDefinition`] AST and produces a concrete
//! [`BaseRule`] implementation that plugs directly into the [`PluginRegistry`].
//!
//! # Compilation pipeline
//!
//! ```text
//! DSL source text
//!   └─ Lexer        → Vec<Token>
//!   └─ Parser       → DslFile  (Vec<RuleDefinition>)
//!   └─ Compiler     → Vec<Box<dyn BaseRule>>
//!        └─ validate_condition  (unknown predicates, arity)
//!        └─ CompiledRule        (runtime evaluator)
//! ```

use std::sync::Arc;

use super::{
    ast::{Condition, DslFile, DslLanguage, DslSeverity, RuleDefinition},
    builtins::{self, EvalContext, PredicateMatch},
    error::{DslError, DslResult, Span},
    lexer::Lexer,
    parser::Parser,
};
use crate::plugin::interface::{BaseRule, Finding, Language, RuleMeta, Severity};

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/// Parse and compile a DSL source string into a list of ready-to-register
/// [`BaseRule`] implementations.
///
/// # Example
/// ```rust
/// use analysis_core::dsl::compiler::compile_str;
///
/// let rules = compile_str(r#"
///     rule no-unsafe {
///         name:        "No Unsafe Blocks"
///         description: "Flags unsafe blocks in Rust code"
///         severity:    error
///         language:    rust
///         when { contains_pattern("unsafe") }
///         message: "Unsafe block detected at line {line}"
///     }
/// "#).unwrap();
/// assert_eq!(rules.len(), 1);
/// ```
pub fn compile_str(src: &str) -> DslResult<Vec<Box<dyn BaseRule>>> {
    let tokens = Lexer::new(src).tokenize()?;
    let file = Parser::new(tokens).parse()?;
    compile_file(file)
}

/// Compile an already-parsed [`DslFile`] into [`BaseRule`] implementations.
pub fn compile_file(file: DslFile) -> DslResult<Vec<Box<dyn BaseRule>>> {
    file.rules.into_iter().map(compile_rule).collect()
}

/// Compile a single [`RuleDefinition`] into a [`BaseRule`].
pub fn compile_rule(def: RuleDefinition) -> DslResult<Box<dyn BaseRule>> {
    // Validate the condition tree (unknown predicates, arity checks)
    validate_condition(&def.condition)?;

    let severity = map_severity(&def.severity);
    let languages: Vec<Language> = map_language(&def.language);

    // Leak static strings for RuleMeta (acceptable for long-lived rules)
    let id: &'static str = Box::leak(def.id.clone().into_boxed_str());
    let name: &'static str = Box::leak(def.name.clone().into_boxed_str());
    let description: &'static str = Box::leak(def.description.clone().into_boxed_str());
    let languages_static: &'static [Language] = Box::leak(languages.into_boxed_slice());

    let meta = RuleMeta {
        id,
        name,
        description,
        languages: languages_static,
        default_severity: severity.clone(),
    };

    Ok(Box::new(CompiledRule {
        meta,
        condition: Arc::new(def.condition),
        message_template: def.message,
        suggestion_template: def.suggestion,
        severity,
        tags: def.tags,
    }))
}

// ---------------------------------------------------------------------------
// Validation pass
// ---------------------------------------------------------------------------

fn validate_condition(cond: &Condition) -> DslResult<()> {
    match cond {
        Condition::Predicate { name, args, span } => validate_predicate(name, args, span),
        Condition::And(l, r) | Condition::Or(l, r) => {
            validate_condition(l)?;
            validate_condition(r)
        }
        Condition::Not(inner) => validate_condition(inner),
    }
}

fn validate_predicate(name: &str, args: &[super::ast::Arg], span: &Span) -> DslResult<()> {
    if !builtins::is_known(name) {
        return Err(DslError::UnknownPredicate {
            name: name.to_string(),
            span: span.clone(),
        });
    }

    // Check arity against descriptor
    if let Some(descriptor) = builtins::all_descriptors().iter().find(|d| d.name == name) {
        if let Some(expected) = descriptor.arity {
            if args.len() != expected {
                return Err(DslError::WrongArgCount {
                    name: name.to_string(),
                    expected,
                    got: args.len(),
                    span: span.clone(),
                });
            }
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Severity / Language mapping
// ---------------------------------------------------------------------------

fn map_severity(s: &DslSeverity) -> Severity {
    match s {
        DslSeverity::Info => Severity::Info,
        DslSeverity::Warning => Severity::Warning,
        DslSeverity::Error => Severity::Error,
        DslSeverity::Critical => Severity::Critical,
    }
}

fn map_language(l: &DslLanguage) -> Vec<Language> {
    match l {
        DslLanguage::Solidity => vec![Language::Solidity],
        DslLanguage::Rust => vec![Language::Rust],
        DslLanguage::Vyper => vec![Language::Vyper],
        DslLanguage::Any => vec![Language::Solidity, Language::Rust, Language::Vyper],
    }
}

// ---------------------------------------------------------------------------
// CompiledRule — the runtime BaseRule implementation
// ---------------------------------------------------------------------------

/// A rule produced by compiling a DSL definition.
///
/// Implements [`BaseRule`] so it can be registered directly in a
/// [`PluginRegistry`] alongside hand-written rules.
pub struct CompiledRule {
    meta: RuleMeta,
    condition: Arc<Condition>,
    message_template: String,
    suggestion_template: Option<String>,
    severity: Severity,
    tags: Vec<String>,
}

impl CompiledRule {
    /// Evaluate the condition tree against the given source, returning all
    /// matching locations.
    fn eval_condition(
        &self,
        cond: &Condition,
        ctx: &EvalContext<'_>,
    ) -> DslResult<Vec<PredicateMatch>> {
        match cond {
            Condition::Predicate { name, args, span } => builtins::evaluate(name, args, ctx, span),

            Condition::And(left, right) => {
                let left_matches = self.eval_condition(left, ctx)?;
                if left_matches.is_empty() {
                    // Short-circuit: left is false
                    return Ok(vec![]);
                }
                let right_matches = self.eval_condition(right, ctx)?;
                if right_matches.is_empty() {
                    Ok(vec![])
                } else {
                    // Return the union of both match sets
                    let mut combined = left_matches;
                    combined.extend(right_matches);
                    Ok(combined)
                }
            }

            Condition::Or(left, right) => {
                let left_matches = self.eval_condition(left, ctx)?;
                if !left_matches.is_empty() {
                    return Ok(left_matches);
                }
                self.eval_condition(right, ctx)
            }

            Condition::Not(inner) => {
                let inner_matches = self.eval_condition(inner, ctx)?;
                if inner_matches.is_empty() {
                    // Inner did NOT match → NOT fires once at line 1
                    Ok(vec![PredicateMatch::new(1, "not-condition satisfied")])
                } else {
                    Ok(vec![])
                }
            }
        }
    }

    /// Render the message template, substituting `{line}`, `{file}`, and
    /// `{snippet}` placeholders.
    fn render_message(&self, m: &PredicateMatch, file_path: &str) -> String {
        self.message_template
            .replace("{line}", &m.line.to_string())
            .replace("{file}", file_path)
            .replace("{snippet}", &m.snippet)
    }

    /// Render the suggestion template (if any).
    fn render_suggestion(&self, m: &PredicateMatch, file_path: &str) -> Option<String> {
        self.suggestion_template.as_ref().map(|tmpl| {
            tmpl.replace("{line}", &m.line.to_string())
                .replace("{file}", file_path)
                .replace("{snippet}", &m.snippet)
        })
    }
}

impl BaseRule for CompiledRule {
    fn meta(&self) -> &RuleMeta {
        &self.meta
    }

    fn analyze(&self, file_path: &str, source: &str) -> Vec<Finding> {
        let ctx = EvalContext::new(file_path, source);
        let condition = Arc::clone(&self.condition);

        match self.eval_condition(&condition, &ctx) {
            Err(_) => vec![], // evaluation errors produce no findings
            Ok(matches) => matches
                .into_iter()
                .map(|m| Finding {
                    rule_id: self.meta.id.to_string(),
                    severity: self.severity.clone(),
                    message: self.render_message(&m, file_path),
                    file: file_path.to_string(),
                    line: m.line,
                    column: m.column,
                    suggestion: self.render_suggestion(&m, file_path),
                })
                .collect(),
        }
    }
}

// ---------------------------------------------------------------------------
// Tags accessor (not part of BaseRule but useful for filtering)
// ---------------------------------------------------------------------------

impl CompiledRule {
    pub fn tags(&self) -> &[String] {
        &self.tags
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn compile(src: &str) -> Vec<Box<dyn BaseRule>> {
        compile_str(src).expect("compile failed")
    }

    const SIMPLE_RULE: &str = r#"
        rule no-unsafe {
            name:        "No Unsafe Blocks"
            description: "Flags unsafe blocks in Rust code"
            severity:    error
            language:    rust
            when { contains_pattern("unsafe") }
            message:    "Unsafe block at line {line}: {snippet}"
            suggestion: "Wrap in a safe abstraction"
        }
    "#;

    #[test]
    fn test_compile_produces_one_rule() {
        let rules = compile(SIMPLE_RULE);
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].meta().id, "no-unsafe");
        assert_eq!(rules[0].meta().name, "No Unsafe Blocks");
    }

    #[test]
    fn test_rule_fires_on_matching_source() {
        let rules = compile(SIMPLE_RULE);
        let findings = rules[0].analyze("foo.rs", "fn main() { unsafe { do_thing(); } }");
        assert!(!findings.is_empty());
        assert_eq!(findings[0].rule_id, "no-unsafe");
        assert!(findings[0].message.contains("unsafe"));
        assert_eq!(findings[0].severity, Severity::Error);
    }

    #[test]
    fn test_rule_silent_on_clean_source() {
        let rules = compile(SIMPLE_RULE);
        let findings = rules[0].analyze("foo.rs", "fn main() { println!(\"hello\"); }");
        assert!(findings.is_empty());
    }

    #[test]
    fn test_and_condition() {
        let src = r#"
            rule and-rule {
                name: "And Rule" description: "d" severity: warning
                when {
                    contains_pattern("loop") and contains_pattern("unsafe")
                }
                message: "Both loop and unsafe found at line {line}"
            }
        "#;
        let rules = compile(src);
        // Both present → fires
        let findings = rules[0].analyze("f.rs", "loop { unsafe { } }");
        assert!(!findings.is_empty());
        // Only one present → silent
        let findings2 = rules[0].analyze("f.rs", "loop { }");
        assert!(findings2.is_empty());
    }

    #[test]
    fn test_or_condition() {
        let src = r#"
            rule or-rule {
                name: "Or Rule" description: "d" severity: info
                when {
                    contains_pattern("(?i)todo") or contains_pattern("(?i)fixme")
                }
                message: "Found marker at line {line}"
            }
        "#;
        let rules = compile(src);
        let findings = rules[0].analyze("f.rs", "// TODO: fix this");
        assert!(!findings.is_empty());
        let findings2 = rules[0].analyze("f.rs", "// FIXME: also this");
        assert!(!findings2.is_empty());
        let findings3 = rules[0].analyze("f.rs", "// clean code");
        assert!(findings3.is_empty());
    }

    #[test]
    fn test_not_condition() {
        let src = r#"
            rule not-rule {
                name: "Not Rule" description: "d" severity: warning
                when {
                    not contains_pattern("require")
                }
                message: "Missing require() guard"
            }
        "#;
        let rules = compile(src);
        // No require → fires
        let findings = rules[0].analyze("f.sol", "function foo() public { doThing(); }");
        assert!(!findings.is_empty());
        // Has require → silent
        let findings2 = rules[0].analyze("f.sol", "function foo() public { require(x > 0); }");
        assert!(findings2.is_empty());
    }

    #[test]
    fn test_unknown_predicate_compile_error() {
        let src = r#"
            rule bad {
                name: "Bad" description: "d" severity: info
                when { does_not_exist("x") }
                message: "m"
            }
        "#;
        let result = compile_str(src);
        assert!(result.is_err());
        let msg = result.err().unwrap().to_string();
        assert!(
            msg.contains("does_not_exist"),
            "expected unknown predicate error, got: {}",
            msg
        );
    }

    #[test]
    fn test_message_template_substitution() {
        let rules = compile(SIMPLE_RULE);
        let findings = rules[0].analyze("src/main.rs", "unsafe { }");
        assert!(!findings.is_empty());
        let msg = &findings[0].message;
        assert!(
            msg.contains("1"),
            "line number should appear in message: {}",
            msg
        );
        assert!(
            msg.contains("unsafe"),
            "snippet should appear in message: {}",
            msg
        );
    }

    #[test]
    fn test_language_filter_rust() {
        let rules = compile(SIMPLE_RULE);
        // The rule targets Rust — meta should list only Rust
        assert_eq!(rules[0].meta().languages, &[Language::Rust]);
    }

    #[test]
    fn test_any_language_expands_to_all() {
        let src = r#"
            rule any-lang {
                name: "Any" description: "d" severity: info
                language: any
                when { contains_pattern("TODO") }
                message: "TODO found"
            }
        "#;
        let rules = compile(src);
        let langs = rules[0].meta().languages;
        assert!(langs.contains(&Language::Rust));
        assert!(langs.contains(&Language::Solidity));
        assert!(langs.contains(&Language::Vyper));
    }

    #[test]
    fn test_compile_multiple_rules() {
        let src = r#"
            rule rule-a {
                name: "A" description: "da" severity: info
                when { contains_pattern("a") }
                message: "found a"
            }
            rule rule-b {
                name: "B" description: "db" severity: warning
                when { contains_pattern("b") }
                message: "found b"
            }
        "#;
        let rules = compile(src);
        assert_eq!(rules.len(), 2);
    }
}
