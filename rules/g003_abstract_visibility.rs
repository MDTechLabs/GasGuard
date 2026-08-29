//! Closes #650: Rule G003 - flag public variables in abstract/internal contracts.
//! Starter line-scan implementation; full AST-based scoping is a follow-up.

pub struct PublicVarFinding {
    pub variable_name: String,
}

/// Scans declaration lines inside an `abstract contract` body for `public` state vars.
pub fn detect_public_vars_in_abstract(declaration_lines: &[&str]) -> Vec<PublicVarFinding> {
    let mut findings = Vec::new();
    for line in declaration_lines {
        let trimmed = line.trim();
        if trimmed.contains("public") && trimmed.ends_with(';') && !trimmed.contains('(') {
            if let Some(name) = trimmed.split_whitespace().last() {
                findings.push(PublicVarFinding {
                    variable_name: name.trim_end_matches(';').to_string(),
                });
            }
        }
    }
    findings
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flags_public_state_variable() {
        let lines = ["uint256 public totalSupply;"];
        let findings = detect_public_vars_in_abstract(&lines);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].variable_name, "totalSupply");
    }

    #[test]
    fn ignores_internal_variable() {
        let lines = ["uint256 internal totalSupply;"];
        assert!(detect_public_vars_in_abstract(&lines).is_empty());
    }
}
