// Re-export the three major subsystems.
pub mod dsl;
pub mod gas;
pub mod plugin;

// Convenience top-level re-exports.
pub use dsl::compile_str;
pub use gas::{GasReport, PatternGasCost};
pub use plugin::{
    AnalysisInput, AnalysisOutput, BaseRule, Finding, Language, PluginRegistry, RuleConfig,
    RuleMeta, SessionOutput, Severity,
};
