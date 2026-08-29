//! Rule G017: Flag Unbounded Iteration Over Enum Types in Solidity loops.
//!
//! Detects `for` and `while` loops whose body casts the loop index (or a
//! variable derived from it) into an `enum` type on every iteration. This
//! pattern re-validates enum bounds and performs a type conversion on each
//! pass instead of using a precomputed bitmask or lookup table.

pub struct RuleG017EnumIteration;

impl RuleG017EnumIteration {
    pub fn name() -> &'static str {
        "G017_enum_iteration"
    }

    /// Extracts the declared names of every `enum` type defined in the source.
    fn enum_names(source_code: &str) -> Vec<String> {
        let mut names = Vec::new();
        for line in source_code.lines() {
            let trimmed = line.trim_start();
            if let Some(rest) = trimmed.strip_prefix("enum ") {
                if let Some(name) = rest.split(|c: char| c == '{' || c.is_whitespace()).next() {
                    if !name.is_empty() {
                        names.push(name.to_string());
                    }
                }
            }
        }
        names
    }

    /// Finds every `for (...) { ... }` / `while (...) { ... }` loop body in
    /// the source, returning the raw body text for each match. This is a
    /// lightweight brace-matching scan rather than a full parser, but it is
    /// sufficient to isolate loop bodies (including nested loops, which are
    /// each returned as their own entry) for pattern inspection.
    fn loop_bodies(source_code: &str) -> Vec<String> {
        let mut bodies = Vec::new();
        let bytes = source_code.as_bytes();
        let mut i = 0;
        while i < source_code.len() {
            let is_for = source_code[i..].starts_with("for (") || source_code[i..].starts_with("for(");
            let is_while =
                source_code[i..].starts_with("while (") || source_code[i..].starts_with("while(");
            if is_for || is_while {
                // Find the opening brace of the loop body, skipping the
                // condition/header parens first.
                if let Some(rel_paren) = source_code[i..].find('(') {
                    let mut depth = 0i32;
                    let mut j = i + rel_paren;
                    let mut header_end = None;
                    while j < bytes.len() {
                        match bytes[j] {
                            b'(' => depth += 1,
                            b')' => {
                                depth -= 1;
                                if depth == 0 {
                                    header_end = Some(j + 1);
                                    break;
                                }
                            }
                            _ => {}
                        }
                        j += 1;
                    }
                    if let Some(mut k) = header_end {
                        while k < bytes.len() && (bytes[k] as char).is_whitespace() {
                            k += 1;
                        }
                        if k < bytes.len() && bytes[k] == b'{' {
                            let mut brace_depth = 0i32;
                            let start = k;
                            let mut end = k;
                            while k < bytes.len() {
                                match bytes[k] {
                                    b'{' => brace_depth += 1,
                                    b'}' => {
                                        brace_depth -= 1;
                                        if brace_depth == 0 {
                                            end = k + 1;
                                            break;
                                        }
                                    }
                                    _ => {}
                                }
                                k += 1;
                            }
                            if end > start {
                                bodies.push(source_code[start..end].to_string());
                            }
                        }
                    }
                }
            }
            i += 1;
        }
        bodies
    }

    /// Returns true if `body` contains a cast of the form `EnumName(expr)`
    /// for one of the known enum type names.
    fn casts_to_enum(body: &str, enum_names: &[String]) -> bool {
        enum_names.iter().any(|name| {
            let pattern = format!("{}(", name);
            body.contains(&pattern)
        })
    }

    pub fn check(source_code: &str) -> Vec<String> {
        let mut warnings = Vec::new();
        let enums = Self::enum_names(source_code);
        if enums.is_empty() {
            return warnings;
        }

        for body in Self::loop_bodies(source_code) {
            if Self::casts_to_enum(&body, &enums) {
                warnings.push(
                    "Warning: Unbounded iteration over enum type detected via sequential \
                     integer-to-enum casting; consider a bitmask or lookup mapping instead"
                        .to_string(),
                );
            }
        }

        warnings
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flags_for_loop_casting_index_to_enum() {
        let code = r#"
            enum ActionState { PENDING, ACTIVE, COMPLETED, CANCELLED }

            function iterateEnum() external pure {
                for (uint8 i = 0; i < 4; i++) {
                    ActionState state = ActionState(i);
                }
            }
        "#;
        let warnings = RuleG017EnumIteration::check(code);
        assert_eq!(warnings.len(), 1);
    }

    #[test]
    fn flags_while_loop_casting_index_to_enum() {
        let code = r#"
            enum Phase { INIT, RUNNING, DONE }

            function walk() external pure {
                uint8 i = 0;
                while (i < 3) {
                    Phase p = Phase(i);
                    i++;
                }
            }
        "#;
        let warnings = RuleG017EnumIteration::check(code);
        assert_eq!(warnings.len(), 1);
    }

    #[test]
    fn flags_each_loop_independently_in_nested_loops() {
        let code = r#"
            enum Color { RED, GREEN, BLUE }

            function nested() external pure {
                for (uint8 i = 0; i < 2; i++) {
                    for (uint8 j = 0; j < 3; j++) {
                        Color c = Color(j);
                    }
                }
            }
        "#;
        let warnings = RuleG017EnumIteration::check(code);
        // The outer loop body (which contains the inner loop, which itself
        // casts to Color) and the inner loop body both match.
        assert_eq!(warnings.len(), 2);
    }

    #[test]
    fn does_not_flag_standard_integer_index_loop() {
        let code = r#"
            enum ActionState { PENDING, ACTIVE, COMPLETED, CANCELLED }

            function sum(uint256[] memory arr) external pure returns (uint256 total) {
                for (uint256 i = 0; i < arr.length; i++) {
                    total += arr[i];
                }
            }
        "#;
        let warnings = RuleG017EnumIteration::check(code);
        assert!(warnings.is_empty());
    }

    #[test]
    fn does_not_flag_contract_with_no_enums() {
        let code = r#"
            function sum(uint256[] memory arr) external pure returns (uint256 total) {
                for (uint256 i = 0; i < arr.length; i++) {
                    total += arr[i];
                }
            }
        "#;
        let warnings = RuleG017EnumIteration::check(code);
        assert!(warnings.is_empty());
    }

    #[test]
    fn does_not_flag_enum_cast_outside_a_loop() {
        let code = r#"
            enum ActionState { PENDING, ACTIVE, COMPLETED, CANCELLED }

            function single(uint8 i) external pure returns (ActionState) {
                return ActionState(i);
            }
        "#;
        let warnings = RuleG017EnumIteration::check(code);
        assert!(warnings.is_empty());
    }
}
