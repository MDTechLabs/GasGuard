pub mod rules;

pub use rules::{RedundantSloadRule, StringStorageRule};

/// Register all Solidity rules into a registry with default config.
pub fn register_all(registry: &mut analysis_core::plugin::PluginRegistry) -> Result<(), String> {
    registry.register_default(Box::new(StringStorageRule::default()))?;
    registry.register_default(Box::new(RedundantSloadRule::default()))?;
    Ok(())
}