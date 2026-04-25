pub mod rules;

pub use rules::{OverlyPublicFunctionRule, UnboundedLoopRule};

pub fn register_all(registry: &mut analysis_core::plugin::PluginRegistry) -> Result<(), String> {
    registry.register_default(Box::new(UnboundedLoopRule::default()))?;
    registry.register_default(Box::new(OverlyPublicFunctionRule::default()))?;
    Ok(())
}