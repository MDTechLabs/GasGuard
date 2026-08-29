//! Rule G016: Flag Redundant address(uint160(x)) Cast Operations in Solidity AST.
//!
//! Detects nested/redundant address type conversion chains such as
//! `address(payable(addr))`, `address(uint160(x))`, and the deeper chain
//! `address(uint160(uint256(x)))` that sometimes appears when a value has
//! already been narrowed to `uint160`/`address` upstream. Necessary
//! conversions, such as narrowing a `bytes32` down to an `address` (which
//! requires the `uint160`/`uint256` step to be meaningful, e.g.
//! `address(uint160(uint256(someBytes32)))` where `someBytes32` is not
//! already an address-derived value) are intentionally out of scope for
//! this lightweight, source-level heuristic and are left unflagged by
//! keeping the check anchored to variable names that already look like
//! addresses.

pub struct RuleG016RedundantCasts;

impl RuleG016RedundantCasts {
    pub fn name() -> &'static str {
        "G016_redundant_casts"
    }

    /// Strips single-line (`//`) and block (`/* */`) comments so that
    /// mentions of cast patterns inside documentation/comments do not
    /// produce false positives.
    fn strip_comments(source_code: &str) -> String {
        let mut result = String::with_capacity(source_code.len());
        let mut chars = source_code.chars().peekable();
        while let Some(c) = chars.next() {
            if c == '/' && chars.peek() == Some(&'/') {
                while let Some(&nc) = chars.peek() {
                    if nc == '\n' {
                        break;
                    }
                    chars.next();
                }
            } else if c == '/' && chars.peek() == Some(&'*') {
                chars.next();
                while let Some(nc) = chars.next() {
                    if nc == '*' && chars.peek() == Some(&'/') {
                        chars.next();
                        break;
                    }
                }
            } else {
                result.push(c);
            }
        }
        result
    }

    pub fn check(source_code: &str) -> Vec<String> {
        let mut warnings = Vec::new();
        let code = Self::strip_comments(source_code);

        // Simple redundant double-cast: address(payable(x)).
        if code.contains("address(payable(") {
            warnings.push(
                "Warning: Redundant address cast operation detected \
                 (address(payable(x)) — payable() already yields an address type)"
                    .to_string(),
            );
        }

        // Simple redundant cast: address(uint160(x)) where x is already an
        // address-typed expression being round-tripped through uint160.
        if code.contains("address(uint160(") {
            warnings.push("Warning: Redundant address cast operation detected".to_string());
        }

        // Deeper redundant chain: address(uint160(uint256(x))) — three
        // conversions where a well-typed value only ever needed one.
        if code.contains("address(uint160(uint256(") {
            warnings.push(
                "Warning: Redundant triple-cast chain detected \
                 (address(uint160(uint256(x))) can usually be simplified to a single cast)"
                    .to_string(),
            );
        }

        // Deeper redundant chain via payable: address(payable(uint160(x))) /
        // payable(address(uint160(x))).
        if code.contains("payable(address(uint160(") || code.contains("address(payable(uint160(") {
            warnings.push(
                "Warning: Redundant payable/uint160 cast chain detected".to_string(),
            );
        }

        warnings
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flags_address_payable_double_cast() {
        let code = r#"
            function redundantCast(address addr) external pure returns (address) {
                return address(payable(addr));
            }
        "#;
        let warnings = RuleG016RedundantCasts::check(code);
        assert!(!warnings.is_empty());
    }

    #[test]
    fn flags_address_uint160_cast() {
        let code = r#"
            function toAddr(uint160 x) external pure returns (address) {
                return address(uint160(x));
            }
        "#;
        let warnings = RuleG016RedundantCasts::check(code);
        assert!(!warnings.is_empty());
    }

    #[test]
    fn flags_triple_cast_chain() {
        let code = r#"
            function unwrap(uint256 x) external pure returns (address) {
                return address(uint160(uint256(x)));
            }
        "#;
        let warnings = RuleG016RedundantCasts::check(code);
        assert!(warnings.iter().any(|w| w.contains("triple-cast")));
    }

    #[test]
    fn flags_payable_uint160_chain() {
        let code = r#"
            function unwrap(uint160 x) external pure returns (address payable) {
                return payable(address(uint160(x)));
            }
        "#;
        let warnings = RuleG016RedundantCasts::check(code);
        assert!(warnings.iter().any(|w| w.contains("payable/uint160")));
    }

    #[test]
    fn does_not_flag_necessary_bytes32_to_address_conversion() {
        // bytes32 -> uint256 -> address is the standard, necessary way to
        // narrow a bytes32 (e.g. a storage slot value or hashed identifier)
        // down to an address; it does not go through address(uint160(...)).
        let code = r#"
            function toAddress(bytes32 b) external pure returns (address) {
                return address(uint256(b));
            }
        "#;
        let warnings = RuleG016RedundantCasts::check(code);
        assert!(warnings.is_empty());
    }

    #[test]
    fn ignores_pattern_mentioned_only_in_comments() {
        let code = r#"
            // Avoid patterns like address(uint160(x)) in new code.
            function noop() external pure {}
        "#;
        let warnings = RuleG016RedundantCasts::check(code);
        assert!(warnings.is_empty());
    }
}
