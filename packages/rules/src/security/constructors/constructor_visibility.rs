//! Detect Constructor Visibility Issues (#337)
//!
//! Solidity ≥ 0.7.0 removed visibility modifiers (`public` / `internal`) on
//! constructors. Their presence is a compile error. In earlier versions the
//! modifiers were redundant (`public`) or used to mark abstract contracts
//! (`internal`). This rule flags both patterns and suggests the correct fix.

use crate::rule_engine::{Rule, RuleViolation, ViolationSeverity};
use syn::Item;

pub struct ConstructorVisibilityRule;

#[derive(Debug, PartialEq)]
enum CtorKind {
    ModernPublic,
    ModernInternal,
    LegacyPublic,
    LegacyInternal,
}

impl ConstructorVisibilityRule {
    fn scan(source: &str) -> Vec<(CtorKind, usize, String)> {
        let mut findings = Vec::new();

        // Collect contract names for legacy constructor detection.
        let mut contract_names: Vec<String> = Vec::new();
        for line in source.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("contract ") || trimmed.contains(" contract ") {
                if let Some(name) = Self::extract_word_after(trimmed, "contract") {
                    contract_names.push(name);
                }
            }
        }

        for (i, line) in source.lines().enumerate() {
            let lineno = i + 1;
            let trimmed = line.trim();

            // Modern constructor: `constructor(...)` with visibility modifier
            if trimmed.starts_with("constructor") {
                if Self::contains_word(trimmed, "public") {
                    findings.push((CtorKind::ModernPublic, lineno, trimmed.to_string()));
                } else if Self::contains_word(trimmed, "internal") {
                    findings.push((CtorKind::ModernInternal, lineno, trimmed.to_string()));
                }
            }

            // Legacy constructor: `function <ContractName>(...)`
            for name in &contract_names {
                let legacy_sig = format!("function {}(", name);
                if trimmed.contains(&legacy_sig) || trimmed.contains(&format!("function {} (", name)) {
                    if Self::contains_word(trimmed, "public") {
                        findings.push((CtorKind::LegacyPublic, lineno, trimmed.to_string()));
                    } else if Self::contains_word(trimmed, "internal") {
                        findings.push((CtorKind::LegacyInternal, lineno, trimmed.to_string()));
                    }
                }
            }
        }

        findings
    }

    fn contains_word(s: &str, word: &str) -> bool {
        let pat = format!(r"\b{}\b", word);
        // Simple word-boundary check without regex crate dependency.
        if let Some(idx) = s.find(word) {
            let before = idx == 0 || !s.as_bytes()[idx - 1].is_ascii_alphanumeric();
            let after_idx = idx + word.len();
            let after = after_idx >= s.len() || !s.as_bytes()[after_idx].is_ascii_alphanumeric();
            before && after
        } else {
            let _ = pat; // suppress unused warning
            false
        }
    }

    fn extract_word_after(s: &str, keyword: &str) -> Option<String> {
        let idx = s.find(keyword)? + keyword.len();
        let rest = s[idx..].trim_start();
        let end = rest.find(|c: char| !c.is_alphanumeric() && c != '_')?;
        if end == 0 {
            return None;
        }
        Some(rest[..end].to_string())
    }
}

impl Rule for ConstructorVisibilityRule {
    fn name(&self) -> &str {
        "constructor-visibility"
    }

    fn description(&self) -> &str {
        "Detects constructors with visibility modifiers (`public` or `internal`). \
         These modifiers are a compile error in Solidity ≥ 0.7.0. \
         For abstract contracts use the `abstract` keyword instead."
    }

    fn check(&self, ast: &[Item]) -> Vec<RuleViolation> {
        let mut violations = Vec::new();

        for item in ast {
            let code = format!("{:?}", item);
            let findings = Self::scan(&code);

            for (kind, line, snippet) in findings {
                let (description, suggestion, severity) = match kind {
                    CtorKind::ModernPublic => (
                        "Constructor declares `public` visibility — redundant and illegal in Solidity ≥ 0.7.0.".to_string(),
                        "Remove the `public` modifier from the constructor.".to_string(),
                        ViolationSeverity::Medium,
                    ),
                    CtorKind::ModernInternal => (
                        "Constructor declares `internal` visibility — illegal in Solidity ≥ 0.7.0.".to_string(),
                        "Remove `internal` and declare the contract `abstract` instead.".to_string(),
                        ViolationSeverity::High,
                    ),
                    CtorKind::LegacyPublic => (
                        "Legacy function-style constructor with `public` modifier is outdated.".to_string(),
                        "Migrate to `constructor(...)` syntax and remove the visibility modifier.".to_string(),
                        ViolationSeverity::Medium,
                    ),
                    CtorKind::LegacyInternal => (
                        "Legacy function-style constructor with `internal` modifier is outdated.".to_string(),
                        "Migrate to `abstract contract` with `constructor(...)` syntax.".to_string(),
                        ViolationSeverity::High,
                    ),
                };

                violations.push(RuleViolation {
                    rule_name: self.name().to_string(),
                    description,
                    severity,
                    line_number: line,
                    column_number: 0,
                    variable_name: snippet,
                    suggestion,
                });
            }
        }

        violations
    }
}

/// Standalone checker that works on raw Solidity source strings.
pub fn check_constructor_visibility(source: &str) -> Vec<(String, usize)> {
    ConstructorVisibilityRule::scan(source)
        .into_iter()
        .map(|(kind, line, _snippet)| {
            let label = match kind {
                CtorKind::ModernPublic => "constructor-public",
                CtorKind::ModernInternal => "constructor-internal",
                CtorKind::LegacyPublic => "legacy-constructor-public",
                CtorKind::LegacyInternal => "legacy-constructor-internal",
            };
            (label.to_string(), line)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flags_public_constructor() {
        let src = r#"
            contract Token {
                constructor(uint256 supply) public {
                    totalSupply = supply;
                }
            }
        "#;
        let result = check_constructor_visibility(src);
        assert!(!result.is_empty());
        assert_eq!(result[0].0, "constructor-public");
    }

    #[test]
    fn flags_internal_constructor() {
        let src = r#"
            contract Base {
                constructor() internal {}
            }
        "#;
        let result = check_constructor_visibility(src);
        assert!(!result.is_empty());
        assert_eq!(result[0].0, "constructor-internal");
    }

    #[test]
    fn flags_legacy_public_constructor() {
        let src = r#"
            contract OldToken {
                function OldToken(uint256 supply) public {
                    totalSupply = supply;
                }
            }
        "#;
        let result = check_constructor_visibility(src);
        assert!(!result.is_empty());
        assert_eq!(result[0].0, "legacy-constructor-public");
    }

    #[test]
    fn clean_constructor_no_violation() {
        let src = r#"
            contract Modern {
                constructor(uint256 supply) {
                    totalSupply = supply;
                }
            }
        "#;
        let result = check_constructor_visibility(src);
        assert!(result.is_empty());
    }
}
