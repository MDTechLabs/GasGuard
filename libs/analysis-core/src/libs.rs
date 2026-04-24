// Re-export the two major subsystems.
pub mod gas;
pub mod plugin;

// Convenience top-level re-exports.
pub use gas::{GasReport, PatternGasCost};
pub use plugin::{
    AnalysisInput, AnalysisOutput, BaseRule, Finding, Language, PluginRegistry, RuleConfig,
    RuleMeta, SessionOutput, Severity,
};