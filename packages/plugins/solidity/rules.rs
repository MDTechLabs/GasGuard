use analysis_core::plugin::{BaseRule, Finding, Language, RuleMeta, Severity};

// ---------------------------------------------------------------------------
// SOL-001: Avoid using `string` storage variables (prefer `bytes32`)
// ---------------------------------------------------------------------------

pub struct StringStorageRule;

impl Default for StringStorageRule {
    fn default() -> Self { Self }
}

const SOL001_META: RuleMeta = RuleMeta {
    id: "SOL-001",
    name: "Prefer bytes32 over string for short fixed-length values",
    description: "Using `string` for storage variables that hold short, fixed-length data \
                  wastes gas.  Replacing them with `bytes32` is cheaper for reads/writes.",
    languages: &[Language::Solidity],
    default_severity: Severity::Warning,
};

impl BaseRule for StringStorageRule {
    fn meta(&self) -> &RuleMeta { &SOL001_META }

    fn analyze(&self, file_path: &str, source: &str) -> Vec<Finding> {
        let mut findings = Vec::new();
        for (i, line) in source.lines().enumerate() {
            // Very simplified pattern: `string public/private/internal <name>;`
            if line.contains("string ") && (line.contains("public") || line.contains("private") || line.contains("internal"))
                && line.trim_end().ends_with(';')
            {
                findings.push(Finding {
                    rule_id: self.meta().id.to_string(),
                    severity: Severity::Warning,
                    message: "Consider replacing `string` with `bytes32` if the value is short and fixed-length.".into(),
                    file: file_path.to_string(),
                    line: (i + 1) as u32,
                    column: None,
                    suggestion: Some(line.replace("string ", "bytes32 ")),
                });
            }
        }
        findings
    }
}

// ---------------------------------------------------------------------------
// SOL-002: Avoid redundant SLOAD (reading the same state var twice in a function)
// ---------------------------------------------------------------------------

pub struct RedundantSloadRule {
    seen: std::collections::HashSet<String>,
}

impl Default for RedundantSloadRule {
    fn default() -> Self { Self { seen: Default::default() } }
}

const SOL002_META: RuleMeta = RuleMeta {
    id: "SOL-002",
    name: "Cache state variables read more than once",
    description: "Each SLOAD costs 100–2100 gas.  Reading the same state variable \
                  multiple times within a single function should be cached in a local variable.",
    languages: &[Language::Solidity],
    default_severity: Severity::Warning,
};

impl BaseRule for RedundantSloadRule {
    fn meta(&self) -> &RuleMeta { &SOL002_META }

    fn on_start(&mut self) { self.seen.clear(); }

    fn analyze(&self, file_path: &str, source: &str) -> Vec<Finding> {
        let mut findings = Vec::new();
        let mut in_function = false;
        let mut var_counts: std::collections::HashMap<String, (u32, u32)> = Default::default(); // name -> (first_line, count)

        for (i, line) in source.lines().enumerate() {
            if line.contains("function ") { in_function = true; var_counts.clear(); }
            if in_function && line.contains('}') { in_function = false; }

            if in_function {
                // Naive: count occurrences of `self.<word>` patterns used in expressions
                for word in line.split_whitespace() {
                    let clean = word.trim_matches(|c: char| !c.is_alphanumeric() && c != '_');
                    if clean.len() > 2 {
                        let entry = var_counts.entry(clean.to_string()).or_insert((i as u32 + 1, 0));
                        entry.1 += 1;
                        if entry.1 == 2 {
                            findings.push(Finding {
                                rule_id: self.meta().id.to_string(),
                                severity: Severity::Warning,
                                message: format!("'{}' may be read from storage more than once — consider caching in a local variable.", clean),
                                file: file_path.to_string(),
                                line: i as u32 + 1,
                                column: None,
                                suggestion: Some(format!("uint256 cached_{clean} = {clean};  // use cached_{clean} below")),
                            });
                        }
                    }
                }
            }
        }
        findings
    }
}