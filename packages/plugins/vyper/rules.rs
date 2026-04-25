
use analysis_core::plugin::{BaseRule, Finding, Language, RuleMeta, Severity};

// ---------------------------------------------------------------------------
// VY-001: Detect unbounded loops (no length cap on dynamic arrays)
// ---------------------------------------------------------------------------

pub struct UnboundedLoopRule;

impl Default for UnboundedLoopRule {
    fn default() -> Self { Self }
}

const VY001_META: RuleMeta = RuleMeta {
    id: "VY-001",
    name: "Unbounded loop over dynamic array",
    description: "Iterating over a dynamically-sized array without an explicit length cap \
                  can cause out-of-gas reverts and potential DoS vectors.",
    languages: &[Language::Vyper],
    default_severity: Severity::Error,
};

impl BaseRule for UnboundedLoopRule {
    fn meta(&self) -> &RuleMeta { &VY001_META }

    fn analyze(&self, file_path: &str, source: &str) -> Vec<Finding> {
        let mut findings = Vec::new();
        for (i, line) in source.lines().enumerate() {
            // Detect `for x in array:` without an explicit `range(len(array))` guard
            if line.trim_start().starts_with("for ") && line.contains(" in ") && !line.contains("range(") {
                findings.push(Finding {
                    rule_id: self.meta().id.to_string(),
                    severity: Severity::Error,
                    message: "Potential unbounded loop — consider using `range(len(arr), bound=MAX)`.".into(),
                    file: file_path.to_string(),
                    line: (i + 1) as u32,
                    column: None,
                    suggestion: Some("for i: uint256 in range(len(arr), bound=MAX_ITEMS):".into()),
                });
            }
        }
        findings
    }
}

// ---------------------------------------------------------------------------
// VY-002: Non-payable public function that does not need to be public
// ---------------------------------------------------------------------------

pub struct OverlyPublicFunctionRule;

impl Default for OverlyPublicFunctionRule {
    fn default() -> Self { Self }
}

const VY002_META: RuleMeta = RuleMeta {
    id: "VY-002",
    name: "Consider restricting function visibility",
    description: "Functions marked `external` that are only called internally should be \
                  `internal` to save selector dispatch overhead.",
    languages: &[Language::Vyper],
    default_severity: Severity::Info,
};

impl BaseRule for OverlyPublicFunctionRule {
    fn meta(&self) -> &RuleMeta { &VY002_META }

    fn analyze(&self, file_path: &str, source: &str) -> Vec<Finding> {
        // Collect all defined `def` names and those actually called internally.
        let mut external_defs: Vec<(u32, String)> = Vec::new();
        let mut called_internally: std::collections::HashSet<String> = Default::default();

        for (i, line) in source.lines().enumerate() {
            if line.starts_with("@external") {
                // next line should be the `def`
                if let Some(def_line) = source.lines().nth(i + 1) {
                    if let Some(name) = def_line.trim().strip_prefix("def ").and_then(|s| s.split('(').next()) {
                        external_defs.push((i as u32 + 2, name.to_string()));
                    }
                }
            }
            // Detect `self.<name>(` calls
            if let Some(rest) = line.split("self.").nth(1) {
                if let Some(name) = rest.split('(').next() {
                    called_internally.insert(name.to_string());
                }
            }
        }

        external_defs
            .into_iter()
            .filter(|(_, name)| called_internally.contains(name))
            .map(|(line, name)| Finding {
                rule_id: self.meta().id.to_string(),
                severity: Severity::Info,
                message: format!(
                    "Function `{}` is `@external` but is also called via `self.{}(...)`. Consider making it `@internal`.",
                    name, name
                ),
                file: file_path.to_string(),
                line,
                column: None,
                suggestion: Some(format!("Change `@external` to `@internal` for `{}`.", name)),
            })
            .collect()
    }
}