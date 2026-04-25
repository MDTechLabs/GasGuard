pub mod interface;
pub mod io;
pub mod registry;

// Re-export the most commonly used types so callers can write
// `use analysis_core::plugin::BaseRule` instead of the full path.
pub use interface::{BaseRule, Finding, Language, RuleConfig, RuleMeta, Severity};
pub use io::{AnalysisInput, AnalysisOutput, SessionOutput};
pub use registry::PluginRegistry;