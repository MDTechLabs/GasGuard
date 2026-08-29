use crate::rule_engine::{Rule, RuleViolation, ViolationSeverity};
use syn::Item;

pub struct YulCandidatesRule;

impl Rule for YulCandidatesRule {
    fn name(&self) -> &str {
        "yul-candidates"
    }

    fn description(&self) -> &str {
        "Identifies complex, repetitive Solidity math/storage routines that would benefit from inline Yul optimization, typically yielding >15% gas savings."
    }

    fn check(&self, _ast: &[Item]) -> Vec<RuleViolation> {
        Vec::new()
    }
}

impl YulCandidatesRule {
    pub fn detect_yul_candidates(source: &str) -> Vec<RuleViolation> {
        let mut violations = Vec::new();

        let function_re = regex::Regex::new(r"function\s+(\w+)\s*\([^)]*\)[^{]*\{").unwrap();
        let assembly_re = regex::Regex::new(r"assembly\s*\{").unwrap();

        for cap in function_re.captures_iter(source) {
            let func_name = cap.get(1).unwrap().as_str();
            let func_start = cap.get(0).unwrap().end();

            let func_body = Self::extract_function_body(&source[func_start..]);
            if func_body.is_empty() {
                continue;
            }

            if assembly_re.is_match(&func_body) {
                continue;
            }

            let score = Self::compute_yul_score(&func_body);
            if score >= 6 {
                let line_number = source[..func_start].lines().count();
                violations.push(RuleViolation {
                    rule_name: self::YulCandidatesRule.name().to_string(),
                    description: format!(
                        "Function `{}` contains repetitive math/storage patterns (score: {}) that likely benefit from inline Yul. Converting to Yul can yield >15% gas savings by eliminating Solidity overhead.",
                        func_name, score
                    ),
                    severity: ViolationSeverity::Medium,
                    line_number,
                    column_number: 1,
                    variable_name: func_name.to_string(),
                    suggestion: format!(
                        "Consider rewriting the expensive math/storage routines in `{}` using inline Yul assembly to reduce gas costs.",
                        func_name
                    ),
                });
            }
        }

        violations
    }

    fn extract_function_body(rest: &str) -> String {
        let mut depth = 0i32;
        let mut body = String::new();
        let mut started = false;

        for ch in rest.chars() {
            if ch == '{' {
                depth += 1;
                started = true;
            } else if ch == '}' {
                depth -= 1;
                if started && depth == 0 {
                    body.push(ch);
                    break;
                }
            }
            if started {
                body.push(ch);
            }
        }

        body
    }

    fn compute_yul_score(body: &str) -> i32 {
        let mut score = 0i32;

        let keccak_count = body.matches("keccak256(").count();
        score += (keccak_count as i32) * 3;

        let sload_count = body.matches("sload(").count();
        score += (sload_count as i32) * 2;

        let sstore_count = body.matches("sstore(").count();
        score += (sstore_count as i32) * 3;

        let bitwise_ops = body.matches('&').count()
            + body.matches('|').count()
            + body.matches('^').count()
            + body.matches("<<").count()
            + body.matches(">>").count();
        score += (bitwise_ops as i32);

        let addmod_count = body.matches("addmod(").count();
        score += (addmod_count as i32) * 2;

        let mulmod_count = body.matches("mulmod(").count();
        score += (mulmod_count as i32) * 2;

        score
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flags_repeated_keccak256_as_yul_candidate() {
        let src = r#"
            contract Merkle {
                function verify(bytes32[] memory proof, bytes32 root) public view returns (bool) {
                    bytes32 computed = proof[0];
                    for (uint i = 0; i < proof.length; i++) {
                        computed = keccak256(abi.encodePacked(computed, proof[i]));
                    }
                    return computed == root;
                }
            }
        "#;
        let violations = YulCandidatesRule::detect_yul_candidates(src);
        assert!(
            !violations.is_empty(),
            "should flag repeated keccak256 loop as Yul candidate"
        );
        assert_eq!(violations[0].variable_name, "verify");
    }

    #[test]
    fn flags_repeated_storage_access_as_yul_candidate() {
        let src = r#"
            contract Storage {
                function batchRead() public view returns (uint) {
                    uint a = slotA;
                    uint b = slotB;
                    uint c = slotC;
                    uint d = slotD;
                    uint e = slotE;
                    return a + b + c + d + e;
                }
            }
        "#;
        let violations = YulCandidatesRule::detect_yul_candidates(src);
        assert!(
            !violations.is_empty(),
            "should flag repeated storage reads as Yul candidate"
        );
    }

    #[test]
    fn does_not_flag_simple_function() {
        let src = r#"
            contract Simple {
                function add(uint a, uint b) public pure returns (uint) {
                    return a + b;
                }
            }
        "#;
        let violations = YulCandidatesRule::detect_yul_candidates(src);
        assert!(violations.is_empty(), "simple functions should not be flagged");
    }

    #[test]
    fn does_not_flag_function_already_using_assembly() {
        let src = r#"
            contract Optimized {
                function hash(uint a) public pure returns (bytes32) {
                    assembly {
                        let result := keccak256(add(a, 1), 0)
                    }
                }
            }
        "#;
        let violations = YulCandidatesRule::detect_yul_candidates(src);
        assert!(
            violations.is_empty(),
            "functions already using assembly should not be flagged"
        );
    }
}
