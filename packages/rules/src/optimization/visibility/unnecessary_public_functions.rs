//! Detect Unnecessary Public Functions (#338)
//!
//! Flags Solidity `public` functions that are never called internally within
//! the same contract. Changing them to `external` allows the EVM to read
//! arguments directly from calldata instead of copying to memory, saving gas.

use crate::rule_engine::{Rule, RuleViolation, ViolationSeverity};
use syn::Item;

pub struct UnnecessaryPublicFunctionRule;

impl UnnecessaryPublicFunctionRule {
    /// Extract all `public` function names from a Solidity-like token stream.
    fn public_function_names(code: &str) -> Vec<(String, usize)> {
        let mut result = Vec::new();
        // Simple line-by-line scan for `function <name>(...) ... public`
        for (i, line) in code.lines().enumerate() {
            if line.contains("function") && line.contains("public") {
                if let Some(name) = Self::extract_function_name(line) {
                    result.push((name, i + 1));
                }
            }
        }
        result
    }

    fn extract_function_name(line: &str) -> Option<String> {
        let after = line.find("function")? + "function".len();
        let rest = line[after..].trim_start();
        let end = rest.find(|c: char| !c.is_alphanumeric() && c != '_')?;
        if end == 0 {
            return None;
        }
        Some(rest[..end].to_string())
    }

    /// Return true if `name` is called somewhere in `code` other than its own
    /// declaration line.
    fn is_called_internally(name: &str, code: &str, decl_line: usize) -> bool {
        let call_pattern = format!("{}(", name);
        for (i, line) in code.lines().enumerate() {
            let lineno = i + 1;
            if lineno == decl_line {
                continue;
            }
            if line.contains(&call_pattern) {
                return true;
            }
        }
        false
    }
}

impl Rule for UnnecessaryPublicFunctionRule {
    fn name(&self) -> &str {
        "unnecessary-public-function"
    }

    fn description(&self) -> &str {
        "Detects public functions that are never called internally. \
         Changing them to `external` saves gas because arguments are read \
         directly from calldata instead of being copied to memory."
    }

    fn check(&self, ast: &[Item]) -> Vec<RuleViolation> {
        let mut violations = Vec::new();

        for item in ast {
            let code = format!("{:?}", item);
            let functions = Self::public_function_names(&code);

            for (name, line) in functions {
                if !Self::is_called_internally(&name, &code, line) {
                    violations.push(RuleViolation {
                        rule_name: self.name().to_string(),
                        description: format!(
                            "Function `{}` is declared `public` but is never called \
                             internally — it can be changed to `external`.",
                            name
                        ),
                        severity: ViolationSeverity::Low,
                        line_number: line,
                        column_number: 0,
                        variable_name: name.clone(),
                        suggestion: format!(
                            "Replace `public` with `external` on `{}`. \
                             External functions read calldata directly, avoiding \
                             the memory-copy overhead of `public`.",
                            name
                        ),
                    });
                }
            }
        }

        violations
    }
}

/// Standalone checker that works on raw Solidity source (not a Rust AST).
pub fn check_unnecessary_public_functions(source: &str) -> Vec<(String, usize)> {
    let mut flagged = Vec::new();
    let functions = UnnecessaryPublicFunctionRule::public_function_names(source);
    for (name, line) in functions {
        if !UnnecessaryPublicFunctionRule::is_called_internally(&name, source, line) {
            flagged.push((name, line));
        }
    }
    flagged
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flags_public_only_called_externally() {
        let src = r#"
            contract Token {
                function transfer(address to, uint256 amount) public returns (bool) {
                    return true;
                }
            }
        "#;
        let result = check_unnecessary_public_functions(src);
        assert!(!result.is_empty(), "should flag transfer as unnecessarily public");
        assert_eq!(result[0].0, "transfer");
    }

    #[test]
    fn does_not_flag_internally_called_public_fn() {
        let src = r#"
            contract Token {
                function transfer(address to, uint256 amount) public returns (bool) {
                    return _transfer(to, amount);
                }
                function batchTransfer(address[] memory to, uint256 amount) public {
                    for (uint i = 0; i < to.length; i++) {
                        transfer(to[i], amount);
                    }
                }
            }
        "#;
        let result = check_unnecessary_public_functions(src);
        // `transfer` is called internally by `batchTransfer`, so only
        // `batchTransfer` (if not called internally) should be flagged.
        let names: Vec<&str> = result.iter().map(|(n, _)| n.as_str()).collect();
        assert!(!names.contains(&"transfer"), "transfer is called internally");
    }

    #[test]
    fn empty_source_produces_no_violations() {
        assert!(check_unnecessary_public_functions("").is_empty());
    }
}
