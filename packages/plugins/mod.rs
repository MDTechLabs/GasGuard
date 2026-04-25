pub mod rust;
pub mod solidity;
pub mod vyper;

use analysis_core::plugin::PluginRegistry;

/// Register every built-in rule for all supported languages.
pub fn register_all_plugins(registry: &mut PluginRegistry) -> Result<(), String> {
    solidity::register_all(registry)?;
    rust::register_all(registry)?;
    vyper::register_all(registry)?;
    Ok(())
}