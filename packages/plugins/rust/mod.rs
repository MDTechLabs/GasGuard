pub mod rules;

pub use rules::{CloneInLoopRule, UnnecessaryHeapAllocRule};

pub fn register_all(registry: &mut analysis_core::plugin::PluginRegistry) -> Result<(), String> {
    registry.register_default(Box::new(UnnecessaryHeapAllocRule::default()))?;
    registry.register_default(Box::new(CloneInLoopRule::default()))?;
    Ok(())
}