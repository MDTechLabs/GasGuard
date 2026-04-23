use gasguard_rule_engine::Rule;
use libloading::{Library, Symbol};
use std::path::Path;

pub struct PluginLoader;

impl PluginLoader {
    pub fn new() -> Self {
        Self
    }

    /// Load a rule plugin from a dynamic library (.so, .dll, .dylib)
    /// 
    /// Note: This requires the plugin to export a function named `create_rule`
    /// that returns a pointer to a Box<dyn Rule>.
    /// In a production system, you'd want to use a stable ABI or WASM.
    pub unsafe fn load_rule<P: AsRef<Path>>(&self, path: P) -> Result<Box<dyn Rule>, String> {
        let lib = Library::new(path).map_err(|e| e.to_string())?;
        
        // We leak the library to keep it loaded, as the Rule might use code from it
        let lib = Box::leak(Box::new(lib));
        
        let constructor: Symbol<unsafe fn() -> *mut dyn Rule> = lib.get(b"create_rule")
            .map_err(|e| format!("Failed to find 'create_rule' symbol: {}", e))?;
        
        let rule_ptr = constructor();
        let rule = Box::from_raw(rule_ptr);
        
        Ok(rule)
    }
}

/// Helper macro for plugins to export their rule
#[macro_export]
macro_rules! export_rule {
    ($rule_type:ty) => {
        #[no_mangle]
        pub extern "C" fn create_rule() -> *mut dyn gasguard_rule_engine::Rule {
            let rule = <$rule_type>::default();
            Box::into_raw(Box::new(rule))
        }
    };
}
