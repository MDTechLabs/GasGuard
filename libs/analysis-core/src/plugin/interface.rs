/// Supported smart contract / source languages.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Language {
    Solidity,
    Rust,
    Vyper,
}

/// Severity of a rule finding.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum Severity {
    Info,
    Warning,
    Error,
    Critical,
}

/// A single diagnostic finding produced by a rule.
#[derive(Debug, Clone)]
pub struct Finding {
    /// Unique rule identifier, e.g. "SOL-001".
    pub rule_id: String,
    pub severity: Severity,
    /// Human-readable description of the issue.
    pub message: String,
    /// Path to the file containing the issue.
    pub file: String,
    /// 1-based line number.
    pub line: u32,
    /// Optional column offset.
    pub column: Option<u32>,
    /// Optional suggested fix snippet.
    pub suggestion: Option<String>,
}

/// Metadata every rule must expose.
#[derive(Debug, Clone)]
pub struct RuleMeta {
    /// Stable unique identifier.
    pub id: &'static str,
    /// Short human-readable name.
    pub name: &'static str,
    /// Detailed description of what the rule checks.
    pub description: &'static str,
    /// Languages this rule applies to.
    pub languages: &'static [Language],
    pub default_severity: Severity,
}

// ---------------------------------------------------------------------------
// Plugin lifecycle
// ---------------------------------------------------------------------------

/// Contextual configuration passed to a rule before analysis begins.
#[derive(Debug, Default, Clone)]
pub struct RuleConfig {
    /// Arbitrary key-value options (mirrors JSON/TOML config).
    pub options: std::collections::HashMap<String, String>,
}

/// The **unified base trait** every GasGuard rule must implement.
///
/// Lifecycle order:
///   1. `on_init`  – called once when the rule is loaded into the registry.
///   2. `on_start` – called once per analysis session before any file is seen.
///   3. `analyze`  – called once per file.
///   4. `on_end`   – called after all files have been processed; collect
///                   cross-file findings here.
///   5. `on_teardown` – cleanup; called even if analysis fails.
pub trait BaseRule: Send + Sync {
    // ---- identity ----------------------------------------------------------

    fn meta(&self) -> &RuleMeta;

    // ---- lifecycle hooks ---------------------------------------------------

    /// Initialise internal state.  Called once when the plugin is registered.
    /// Return `Err` to abort registration.
    fn on_init(&mut self, _config: &RuleConfig) -> Result<(), String> {
        Ok(())
    }

    /// Called once at the beginning of a new analysis session.
    fn on_start(&mut self) {}

    /// Analyse a single source file.
    ///
    /// * `file_path` – path to the file.
    /// * `source`    – full UTF-8 source text.
    ///
    /// Returns a (possibly empty) list of [`Finding`]s.
    fn analyze(&self, file_path: &str, source: &str) -> Vec<Finding>;

    /// Called after every file has been analysed.  Override to emit
    /// cross-file / aggregate findings.
    fn on_end(&mut self) -> Vec<Finding> {
        vec![]
    }

    /// Final cleanup.  Always called, even on error.
    fn on_teardown(&mut self) {}
}