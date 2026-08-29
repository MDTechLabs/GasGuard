//! Closes #657: Rule G009 - detect redundant double storage writes.
//! Starter text-scan implementation; full CFG-based tracking is a follow-up.

pub struct RedundantWriteFinding {
    pub variable: String,
    pub write_count: usize,
}

/// Flags state variables assigned more than once within a single function body.
/// `function_body` is the raw source slice between a function's braces.
pub fn detect_redundant_sstore(function_body: &str, tracked_vars: &[&str]) -> Vec<RedundantWriteFinding> {
    let mut findings = Vec::new();
    for &var in tracked_vars {
        let needle = format!("{} =", var);
        let count = function_body.matches(&needle).count();
        if count > 1 {
            findings.push(RedundantWriteFinding {
                variable: var.to_string(),
                write_count: count,
            });
        }
    }
    findings
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flags_variable_written_twice() {
        let body = "totalSupply = 0; totalSupply = 100;";
        let findings = detect_redundant_sstore(body, &["totalSupply"]);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].write_count, 2);
    }

    #[test]
    fn ignores_single_write() {
        let body = "balance = 100;";
        assert!(detect_redundant_sstore(body, &["balance"]).is_empty());
    }
}
