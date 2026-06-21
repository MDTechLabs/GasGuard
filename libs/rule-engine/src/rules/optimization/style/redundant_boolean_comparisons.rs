use crate::{Rule, RuleViolation, ViolationSeverity};
use gasguard_ast::{Language, UnifiedAST};

#[derive(Default)]
pub struct RedundantBooleanComparisonsRule;

impl RedundantBooleanComparisonsRule {
    fn scan_line(line: &str) -> Vec<(usize, String, String)> {
        // Returns: (column_number_1_based, matched_comparison, suggested_replacement)
        let bytes = line.as_bytes();
        let mut findings = Vec::new();

        let mut i = 0;
        while i + 1 < bytes.len() {
            let op = match (bytes[i], bytes[i + 1]) {
                (b'=', b'=') => "==",
                (b'!', b'=') => "!=",
                _ => {
                    i += 1;
                    continue;
                }
            };

            // Parse RHS boolean literal: skip whitespace after operator.
            let mut rhs_start = i + 2;
            while rhs_start < bytes.len() && bytes[rhs_start].is_ascii_whitespace() {
                rhs_start += 1;
            }

            let rhs_is_true = bytes.get(rhs_start..rhs_start + 4) == Some(b"true");
            let rhs_is_false = bytes.get(rhs_start..rhs_start + 5) == Some(b"false");

            // Parse LHS token: skip whitespace before operator, then grab a "token-ish" span.
            let mut lhs_end = i;
            while lhs_end > 0 && bytes[lhs_end - 1].is_ascii_whitespace() {
                lhs_end -= 1;
            }
            let mut lhs_start = lhs_end;
            while lhs_start > 0 {
                let c = bytes[lhs_start - 1];
                let ok = c.is_ascii_alphanumeric()
                    || matches!(c, b'_' | b'.' | b'!' | b')' | b'(' | b']' | b'[');
                if !ok {
                    break;
                }
                lhs_start -= 1;
            }
            let lhs_token_raw = line.get(lhs_start..lhs_end).unwrap_or("").trim();
            let lhs_token = lhs_token_raw.trim_matches(|c| c == '(' || c == ')');

            // Also support "true == x" / "false != x" (literal on LHS).
            let lhs_is_true = lhs_token == "true";
            let lhs_is_false = lhs_token == "false";

            // Parse RHS token if boolean literal is on LHS.
            let rhs_token = if lhs_is_true || lhs_is_false {
                // Skip whitespace after operator.
                let mut tok_start = rhs_start;
                while tok_start < bytes.len() && bytes[tok_start].is_ascii_whitespace() {
                    tok_start += 1;
                }
                let mut tok_end = tok_start;
                while tok_end < bytes.len() {
                    let c = bytes[tok_end];
                    let ok = c.is_ascii_alphanumeric()
                        || matches!(c, b'_' | b'.' | b'!' | b')' | b'(' | b']' | b'[');
                    if !ok {
                        break;
                    }
                    tok_end += 1;
                }
                let tok = line.get(tok_start..tok_end).unwrap_or("").trim();
                tok.trim_matches(|c| c == '(' || c == ')')
            } else {
                ""
            };

            let (expr, literal, literal_on_rhs) = if rhs_is_true || rhs_is_false {
                (lhs_token, if rhs_is_true { "true" } else { "false" }, true)
            } else if lhs_is_true || lhs_is_false {
                (rhs_token, if lhs_is_true { "true" } else { "false" }, false)
            } else {
                i += 2;
                continue;
            };

            // Avoid empty expr (malformed token capture).
            if expr.is_empty() {
                i += 2;
                continue;
            }

            let simplified = simplify(expr, op, literal);
            let comparison = if literal_on_rhs {
                format!("{expr} {op} {literal}")
            } else {
                format!("{literal} {op} {expr}")
            };

            // Column is position of operator start (1-based).
            findings.push((i + 1, comparison, simplified));

            i += 2;
        }

        findings
    }
}

impl Rule for RedundantBooleanComparisonsRule {
    fn id(&self) -> &str {
        "solidity-redundant-boolean-comparisons"
    }

    fn name(&self) -> &str {
        "Redundant Boolean Comparisons"
    }

    fn description(&self) -> &str {
        "Detects unnecessary boolean comparisons like `== true` or `!= false` and suggests simplified expressions"
    }

    fn dependencies(&self) -> Vec<String> {
        Vec::new()
    }

    fn check(&self, ast: &UnifiedAST) -> Vec<RuleViolation> {
        if ast.language != Language::Solidity {
            return Vec::new();
        }

        let mut violations = Vec::new();

        for (line_idx, line) in ast.source.lines().enumerate() {
            let line_number = line_idx + 1;
            for (column_number, comparison, simplified) in Self::scan_line(line) {
                violations.push(RuleViolation {
                    rule_name: self.id().to_string(),
                    description: format!(
                        "Redundant boolean comparison `{}` can be simplified",
                        comparison
                    ),
                    severity: ViolationSeverity::Info,
                    line_number,
                    column_number,
                    variable_name: comparison.clone(),
                    suggestion: format!("Replace `{}` with `{}`.", comparison, simplified),
                });
            }
        }

        violations
    }
}

fn simplify(expr: &str, op: &str, literal: &str) -> String {
    let want_truthy = match (op, literal) {
        ("==", "true") => true,
        ("==", "false") => false,
        ("!=", "true") => false,
        ("!=", "false") => true,
        _ => true,
    };

    if want_truthy {
        // Prefer `x` over `!!x` if we can avoid it.
        expr.trim().to_string()
    } else {
        let trimmed = expr.trim();
        if let Some(rest) = trimmed.strip_prefix('!') {
            rest.trim().to_string()
        } else {
            format!("!{trimmed}")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gasguard_ast::{ContractNode, FunctionNode, Visibility};

    #[test]
    fn detects_common_boolean_comparisons() {
        let source = r#"
contract C {
  function f(bool x) public {
    if (x == true) { }
    if (x != false) { }
    if (true == x) { }
    if (false != x) { }
    if (x == false) { }
    if (x != true) { }
  }
}
"#;

        let ast = UnifiedAST {
            language: Language::Solidity,
            source: source.to_string(),
            file_path: "C.sol".to_string(),
            contracts: vec![ContractNode {
                name: "C".to_string(),
                functions: vec![FunctionNode {
                    name: "f".to_string(),
                    params: vec![],
                    return_type: None,
                    visibility: Visibility::Public,
                    decorators: vec![],
                    is_constructor: false,
                    is_external: false,
                    is_payable: false,
                    line_number: 3,
                    body_raw: String::new(),
                }],
                state_variables: vec![],
                line_number: 2,
            }],
            structs: vec![],
            enums: vec![],
        };

        let rule = RedundantBooleanComparisonsRule::default();
        let violations = rule.check(&ast);

        assert_eq!(violations.len(), 6);
        assert!(violations
            .iter()
            .any(|v| v.suggestion.contains("Replace `x == true` with `x`")));
        assert!(violations
            .iter()
            .any(|v| v.suggestion.contains("Replace `x != false` with `x`")));
        assert!(violations
            .iter()
            .any(|v| v.suggestion.contains("Replace `x == false` with `!x`")));
        assert!(violations
            .iter()
            .any(|v| v.suggestion.contains("Replace `x != true` with `!x`")));
    }
}
