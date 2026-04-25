use super::interface::Finding;

// ---------------------------------------------------------------------------
// Standard Input
// ---------------------------------------------------------------------------

/// Everything a rule receives when analysing a single file.
#[derive(Debug, Clone)]
pub struct AnalysisInput {
    /// Absolute or workspace-relative file path.
    pub file_path: String,
    /// Full UTF-8 source content.
    pub source: String,
    /// Parsed AST represented as a JSON value (optional – rules that don't
    /// need an AST may ignore this field).
    pub ast: Option<serde_json::Value>,
    /// Arbitrary metadata (e.g. compiler version, import graph).
    pub metadata: std::collections::HashMap<String, String>,
}

impl AnalysisInput {
    pub fn new(file_path: impl Into<String>, source: impl Into<String>) -> Self {
        Self {
            file_path: file_path.into(),
            source: source.into(),
            ast: None,
            metadata: Default::default(),
        }
    }

    pub fn with_ast(mut self, ast: serde_json::Value) -> Self {
        self.ast = Some(ast);
        self
    }

    pub fn with_meta(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.metadata.insert(key.into(), value.into());
        self
    }
}

// ---------------------------------------------------------------------------
// Standard Output
// ---------------------------------------------------------------------------

/// The structured result produced after running one rule on one file.
#[derive(Debug, Clone)]
pub struct AnalysisOutput {
    /// Which rule produced this output.
    pub rule_id: String,
    /// File that was analysed.
    pub file_path: String,
    /// All findings discovered.
    pub findings: Vec<Finding>,
    /// Whether the rule completed successfully.
    pub success: bool,
    /// Optional diagnostic message when `success == false`.
    pub error: Option<String>,
}

impl AnalysisOutput {
    pub fn ok(rule_id: impl Into<String>, file_path: impl Into<String>, findings: Vec<Finding>) -> Self {
        Self {
            rule_id: rule_id.into(),
            file_path: file_path.into(),
            findings,
            success: true,
            error: None,
        }
    }

    pub fn err(rule_id: impl Into<String>, file_path: impl Into<String>, msg: impl Into<String>) -> Self {
        Self {
            rule_id: rule_id.into(),
            file_path: file_path.into(),
            findings: vec![],
            success: false,
            error: Some(msg.into()),
        }
    }

    /// Convenience: true when there are no findings.
    pub fn is_clean(&self) -> bool {
        self.findings.is_empty()
    }
}

// ---------------------------------------------------------------------------
// Session-level aggregate output
// ---------------------------------------------------------------------------

/// Collected results for an entire analysis session.
#[derive(Debug, Default)]
pub struct SessionOutput {
    pub outputs: Vec<AnalysisOutput>,
}

impl SessionOutput {
    pub fn push(&mut self, output: AnalysisOutput) {
        self.outputs.push(output);
    }

    /// Flatten all findings across every file and rule.
    pub fn all_findings(&self) -> Vec<&Finding> {
        self.outputs.iter().flat_map(|o| &o.findings).collect()
    }

    /// Total number of findings.
    pub fn finding_count(&self) -> usize {
        self.outputs.iter().map(|o| o.findings.len()).sum()
    }

    /// `true` when every output succeeded with zero findings.
    pub fn is_clean(&self) -> bool {
        self.outputs.iter().all(|o| o.is_clean() && o.success)
    }
}