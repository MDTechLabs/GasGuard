//! Closes #660: Rule G011 - detect unused state variable declarations.
//! Starter text-scan implementation; full AST-based cross-function
// reference tracking is a follow-up.

pub struct UnusedStorageFinding {
    pub variable_name: String,
    pub line_number: usize,
}

/// Flags state variables declared in a contract scope that are never
/// read or written to within any function body.
///
/// `declared_vars` is a list of (variable_name, line_number) tuples
/// extracted from state variable declarations.
/// `function_bodies` is a list of raw source slices for each function
/// body in the contract. A variable is considered used if its identifier
/// appears in any function body as a read or write reference.
pub fn detect_unused_storage(
    declared_vars: &[(String, usize)],
    function_bodies: &[&str],
) -> Vec<UnusedStorageFinding> {
    let mut findings = Vec::new();

    for (var_name, line_number) in declared_vars {
        let mut is_used = false;

        for body in function_bodies {
            // Check for read references: the variable name appears
            // as a standalone identifier (not as part of a declaration).
            // We look for the variable name surrounded by non-identifier
            // characters or at the start/end of the body.
            if contains_identifier_reference(body, var_name) {
                is_used = true;
                break;
            }
        }

        if !is_used {
            findings.push(UnusedStorageFinding {
                variable_name: var_name.clone(),
                line_number: *line_number,
            });
        }
    }

    findings
}

/// Checks whether `source` contains a reference to `identifier` that
/// is not a declaration. A reference is identified when the identifier
/// appears as a standalone token (surrounded by non-identifier characters).
fn contains_identifier_reference(source: &str, identifier: &str) -> bool {
    let bytes = source.as_bytes();
    let id_bytes = identifier.as_bytes();
    let id_len = id_bytes.len();

    if id_len == 0 {
        return false;
    }

    let mut i = 0;
    while i + id_len <= bytes.len() {
        if &bytes[i..i + id_len] == id_bytes {
            let before_ok = i == 0 || !is_ident_byte(bytes[i - 1]);
            let after_ok = i + id_len >= bytes.len()
                || !is_ident_byte(bytes[i + id_len]);

            // Skip if this is a declaration (e.g., "uint256 varName" or "varName =")
            // A declaration has a type keyword before the identifier or
            // the identifier is followed by `=` or `;` in a declaration context.
            if before_ok && after_ok {
                // Check if preceded by a type keyword (declaration context)
                let preceding = if i > 0 {
                    &source[..i]
                } else {
                    ""
                };
                let last_word = preceding
                    .split_whitespace()
                    .last()
                    .unwrap_or("");

                // If the preceding word looks like a type keyword, this is
                // a declaration, not a reference.
                if is_type_keyword(last_word) {
                    i += id_len;
                    continue;
                }

                // If followed by `=`, it could be a write reference (usage).
                // If followed by `;` or whitespace, it could be a read reference.
                return true;
            }
        }
        i += 1;
    }

    false
}

/// Returns true if `word` looks like a Solidity type keyword.
fn is_type_keyword(word: &str) -> bool {
    matches!(
        word,
        "uint256"
            | "uint128"
            | "uint64"
            | "uint32"
            | "uint16"
            | "uint8"
            | "int256"
            | "int128"
            | "int64"
            | "int32"
            | "int16"
            | "int8"
            | "bool"
            | "address"
            | "bytes32"
            | "bytes16"
            | "bytes8"
            | "bytes4"
            | "bytes2"
            | "bytes1"
            | "string"
            | "bytes"
            | "mapping"
            | "enum"
            | "struct"
            | "contract"
            | "library"
            | "interface"
            | "calldata"
            | "memory"
            | "storage"
            | "public"
            | "private"
            | "internal"
            | "external"
            | "view"
            | "pure"
            | "payable"
            | "virtual"
            | "override"
            | "returns"
            | "constant"
            | "immutable"
    )
}

/// Returns true if `b` is a valid identifier character.
fn is_ident_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flags_unused_variable() {
        let declared = vec![("unusedVar".to_string(), 5)];
        let bodies = vec!["function foo() public { uint256 x = 1; }"];
        let findings = detect_unused_storage(&declared, &bodies);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].variable_name, "unusedVar");
    }

    #[test]
    fn ignores_used_variable_read() {
        let declared = vec![("balance".to_string(), 5)];
        let bodies = vec!["function foo() public { return balance; }"];
        let findings = detect_unused_storage(&declared, &bodies);
        assert!(findings.is_empty());
    }

    #[test]
    fn ignores_used_variable_write() {
        let declared = vec![("totalSupply".to_string(), 5)];
        let bodies = vec!["function foo() public { totalSupply = 100; }"];
        let findings = detect_unused_storage(&declared, &bodies);
        assert!(findings.is_empty());
    }

    #[test]
    fn ignores_variable_used_in_multiple_functions() {
        let declared = vec![("count".to_string(), 5)];
        let bodies = vec![
            "function foo() public { count += 1; }",
            "function bar() public { return count; }",
        ];
        let findings = detect_unused_storage(&declared, &bodies);
        assert!(findings.is_empty());
    }

    #[test]
    fn flags_multiple_unused_variables() {
        let declared = vec![
            ("unusedA".to_string(), 5),
            ("unusedB".to_string(), 6),
            ("used".to_string(), 7),
        ];
        let bodies = vec!["function foo() public { used = 1; }"];
        let findings = detect_unused_storage(&declared, &bodies);
        assert_eq!(findings.len(), 2);
        assert_eq!(findings[0].variable_name, "unusedA");
        assert_eq!(findings[1].variable_name, "unusedB");
    }

    #[test]
    fn ignores_type_keyword_prefix() {
        // "uint256 balance" should not count as a reference to "balance"
        let declared = vec![("balance".to_string(), 5)];
        let bodies = vec!["uint256 balance;"];
        let findings = detect_unused_storage(&declared, &bodies);
        assert_eq!(findings.len(), 1);
    }

    #[test]
    fn empty_inputs() {
        let findings = detect_unused_storage(&[], &[]);
        assert!(findings.is_empty());
    }

    #[test]
    fn no_declared_vars() {
        let findings = detect_unused_storage(&[], &["function foo() public { x = 1; }"]);
        assert!(findings.is_empty());
    }

    #[test]
    fn no_function_bodies() {
        let declared = vec![("x".to_string(), 5)];
        let findings = detect_unused_storage(&declared, &[]);
        assert_eq!(findings.len(), 1);
    }
}