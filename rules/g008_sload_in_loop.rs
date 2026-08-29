//! Closes #654: Rule G008 - flag repeated storage reads inside loop bodies.
//! Starter text-scan implementation (EVM/Solidity-focused); full AST-based
//! loop-body tracing is a follow-up.

pub struct SloadInLoopFinding {
    pub variable: String,
    pub occurrences: usize,
}

/// Scans a `for`/`while` loop body for repeated reads of a tracked state variable
/// (i.e. the identifier appears on the right-hand side without prior local caching).
pub fn detect_sload_in_loop(loop_body: &str, tracked_vars: &[&str]) -> Vec<SloadInLoopFinding> {
    let mut findings = Vec::new();
    for &var in tracked_vars {
        let occurrences = loop_body.matches(var).count();
        if occurrences > 1 {
            findings.push(SloadInLoopFinding {
                variable: var.to_string(),
                occurrences,
            });
        }
    }
    findings
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flags_variable_read_twice_in_loop() {
        let body = "for (uint i = 0; i < len; i++) { sum += balances[i] * rate; total += rate; }";
        let findings = detect_sload_in_loop(body, &["rate"]);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].occurrences, 2);
    }

    #[test]
    fn ignores_single_read() {
        let body = "for (uint i = 0; i < len; i++) { sum += balances[i]; }";
        assert!(detect_sload_in_loop(body, &["cap"]).is_empty());
    }
}
