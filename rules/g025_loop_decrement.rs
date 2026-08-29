//! Rule G025: Flag post-decrement loop indexing patterns.

pub struct RuleG025LoopDecrement;

impl RuleG025LoopDecrement {
    pub fn name() -> &'static str {
        "G025_loop_decrement"
    }

    pub fn check(source_code: &str) -> Vec<String> {
        let mut warnings = Vec::new();
        let bytes = source_code.as_bytes();
        let mut search_from = 0;

        while let Some(relative_for) = source_code[search_from..].find("for") {
            let for_start = search_from + relative_for;
            let after_for = for_start + 3;
            if after_for < bytes.len()
                && (bytes[after_for].is_ascii_alphanumeric() || bytes[after_for] == b'_')
            {
                search_from = after_for;
                continue;
            }

            let Some(open_paren) = source_code[after_for..].find('(').map(|offset| after_for + offset)
            else {
                break;
            };
            let mut depth = 0;
            let mut close_paren = None;
            for (offset, byte) in bytes[open_paren..].iter().enumerate() {
                match byte {
                    b'(' => depth += 1,
                    b')' => {
                        depth -= 1;
                        if depth == 0 {
                            close_paren = Some(open_paren + offset);
                            break;
                        }
                    }
                    _ => {}
                }
            }

            let Some(close_paren) = close_paren else {
                break;
            };
            let header = &source_code[open_paren + 1..close_paren];
            let parts: Vec<_> = header.split(';').map(str::trim).collect();
            if parts.len() == 3 {
                if let Some(counter) = Self::counter_name(parts[0]) {
                    let step = parts[2].replace(char::is_whitespace, "");
                    if step == format!("{}--", counter) {
                        warnings.push(
                            "Recommendation: Replace post-decrement loop indexing with pre-decrement (--i)"
                                .to_string(),
                        );
                    }
                }
            }
            search_from = close_paren + 1;
        }

        warnings
    }

    fn counter_name(initializer: &str) -> Option<&str> {
        let assignment = initializer.find('=')?;
        let left = initializer[..assignment].trim();
        left.split_whitespace().last()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flags_post_decrement_loop_counter() {
        let warnings = RuleG025LoopDecrement::check(
            "for (uint256 i = 10; i > 0; i--) { total += i; }",
        );
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("pre-decrement"));
    }

    #[test]
    fn does_not_flag_pre_decrement_loop_counter() {
        let warnings = RuleG025LoopDecrement::check(
            "for (uint256 i = 10; i > 0; --i) { total += i; }",
        );
        assert!(warnings.is_empty());
    }

    #[test]
    fn does_not_flag_post_decrement_outside_loop_step() {
        let warnings = RuleG025LoopDecrement::check(
            "uint256 i = 10; i--; for (uint256 j = 10; j > 0; --j) { i--; }",
        );
        assert!(warnings.is_empty());
    }
}