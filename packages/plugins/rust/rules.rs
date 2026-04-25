use analysis_core::plugin::{BaseRule, Finding, Language, RuleMeta, Severity};

// ---------------------------------------------------------------------------
// RUST-001: Avoid unnecessary heap allocations (String::from on literals)
// ---------------------------------------------------------------------------

pub struct UnnecessaryHeapAllocRule;

impl Default for UnnecessaryHeapAllocRule {
    fn default() -> Self { Self }
}

const RUST001_META: RuleMeta = RuleMeta {
    id: "RUST-001",
    name: "Avoid unnecessary heap allocations for string literals",
    description: "Using `String::from(\"...\")` or `.to_string()` on a literal \
                  allocates a heap `String` when a `&str` would suffice.",
    languages: &[Language::Rust],
    default_severity: Severity::Info,
};

impl BaseRule for UnnecessaryHeapAllocRule {
    fn meta(&self) -> &RuleMeta { &RUST001_META }

    fn analyze(&self, file_path: &str, source: &str) -> Vec<Finding> {
        let mut findings = Vec::new();
        for (i, line) in source.lines().enumerate() {
            if (line.contains("String::from(\"") || line.contains(".to_string()"))
                && !line.trim_start().starts_with("//")
            {
                findings.push(Finding {
                    rule_id: self.meta().id.to_string(),
                    severity: Severity::Info,
                    message: "Heap allocation detected for a string literal. Consider using `&str` if ownership is not required.".into(),
                    file: file_path.to_string(),
                    line: (i + 1) as u32,
                    column: None,
                    suggestion: None,
                });
            }
        }
        findings
    }
}

// ---------------------------------------------------------------------------
// RUST-002: Detect `clone()` inside hot loops
// ---------------------------------------------------------------------------

pub struct CloneInLoopRule;

impl Default for CloneInLoopRule {
    fn default() -> Self { Self }
}

const RUST002_META: RuleMeta = RuleMeta {
    id: "RUST-002",
    name: "Avoid .clone() inside loops",
    description: "Cloning heap-allocated data inside a loop can cause repeated allocations.  \
                  Move the clone outside the loop or restructure ownership.",
    languages: &[Language::Rust],
    default_severity: Severity::Warning,
};

impl BaseRule for CloneInLoopRule {
    fn meta(&self) -> &RuleMeta { &RUST002_META }

    fn analyze(&self, file_path: &str, source: &str) -> Vec<Finding> {
        let mut findings = Vec::new();
        let mut depth: i32 = 0;
        let mut in_loop = false;
        let mut loop_brace_depth = 0;

        for (i, line) in source.lines().enumerate() {
            let trimmed = line.trim();
            if trimmed.starts_with("for ") || trimmed.starts_with("while ") || trimmed.starts_with("loop {") {
                in_loop = true;
                loop_brace_depth = depth;
            }

            depth += line.chars().filter(|&c| c == '{').count() as i32;
            depth -= line.chars().filter(|&c| c == '}').count() as i32;

            if in_loop && depth <= loop_brace_depth {
                in_loop = false;
            }

            if in_loop && line.contains(".clone()") && !trimmed.starts_with("//") {
                findings.push(Finding {
                    rule_id: self.meta().id.to_string(),
                    severity: Severity::Warning,
                    message: ".clone() inside a loop may cause repeated heap allocations.".into(),
                    file: file_path.to_string(),
                    line: (i + 1) as u32,
                    column: None,
                    suggestion: Some("Consider moving the clone outside the loop or refactoring to use references.".into()),
                });
            }
        }
        findings
    }
}