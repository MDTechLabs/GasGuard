use std::path::Path;

use serde::Deserialize;
use serde::Serialize;

use crate::plugins::wasm_runtime::RuntimeError;
use crate::plugins::wasm_runtime::WasmRuntime;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginFinding {
    pub severity: Severity,
    pub rule_id: String,
    pub message: String,
    pub location: SourceLocation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Severity {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceLocation {
    pub file: Option<String>,
    pub line: usize,
    pub column: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContractAst {
    pub functions: Vec<FunctionDef>,
    pub state_vars: Vec<StateVar>,
    pub modifiers: Vec<ModifierDef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionDef {
    pub name: String,
    pub visibility: String,
    pub is_payable: bool,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StateVar {
    pub name: String,
    pub typ: String,
    pub visibility: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModifierDef {
    pub name: String,
    pub body: String,
}

#[derive(Debug)]
pub enum PluginError {
    LoadFailed(String),
    ValidationFailed(String),
    ExecutionFailed(String),
    InvalidManifest(String),
}

impl std::fmt::Display for PluginError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PluginError::LoadFailed(msg) => write!(f, "plugin load failed: {msg}"),
            PluginError::ValidationFailed(msg) => write!(f, "plugin validation failed: {msg}"),
            PluginError::ExecutionFailed(msg) => write!(f, "plugin execution failed: {msg}"),
            PluginError::InvalidManifest(msg) => write!(f, "invalid plugin manifest: {msg}"),
        }
    }
}

impl std::error::Error for PluginError {}

impl From<RuntimeError> for PluginError {
    fn from(e: RuntimeError) -> Self {
        PluginError::ExecutionFailed(e.to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    pub name: String,
    pub version: String,
    pub rules: Vec<PluginRuleDef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginRuleDef {
    pub id: String,
    pub description: String,
    pub severity: Severity,
}

pub struct Plugin {
    pub manifest: PluginManifest,
    runtime: WasmRuntime,
}

pub struct PluginEngine {
    plugins: Vec<Plugin>,
}

impl PluginEngine {
    pub fn new() -> Self {
        PluginEngine {
            plugins: Vec::new(),
        }
    }

    pub fn load_plugin(&mut self, path: &Path) -> Result<(), PluginError> {
        let wasm_bytes = std::fs::read(path)
            .map_err(|e| PluginError::LoadFailed(format!("cannot read {}: {e}", path.display())))?;

        let runtime = WasmRuntime::instantiate(&wasm_bytes)?;

        let manifest_json = runtime
            .invoke_manifest()
            .map_err(|e| PluginError::ValidationFailed(format!("manifest retrieval failed: {e}")))?;

        let manifest: PluginManifest = serde_json::from_str(&manifest_json)
            .map_err(|e| PluginError::InvalidManifest(format!("invalid manifest JSON: {e}")))?;

        if manifest.name.is_empty() {
            return Err(PluginError::InvalidManifest("plugin name is empty".into()));
        }
        if manifest.version.is_empty() {
            return Err(PluginError::InvalidManifest("plugin version is empty".into()));
        }
        if manifest.rules.is_empty() {
            return Err(PluginError::InvalidManifest(
                "plugin must declare at least one rule".into(),
            ));
        }

        self.plugins.push(Plugin { manifest, runtime });
        Ok(())
    }

    pub fn run_plugins(&self, ast: &ContractAst) -> Vec<PluginFinding> {
        let ast_json = serde_json::to_string(ast).expect("ContractAst serialization failed");
        let mut findings = Vec::new();

        for plugin in &self.plugins {
            match plugin.runtime.invoke_analyze(&ast_json) {
                Ok(json) => {
                    if let Ok(pf) = serde_json::from_str::<Vec<PluginFinding>>(&json) {
                        findings.extend(pf);
                    }
                }
                Err(e) => {
                    findings.push(PluginFinding {
                        severity: Severity::Error,
                        rule_id: format!("{}/runtime-error", plugin.manifest.name),
                        message: format!("plugin execution failed: {e}"),
                        location: SourceLocation {
                            file: None,
                            line: 0,
                            column: 0,
                        },
                    });
                }
            }
        }

        findings
    }
}

impl Default for PluginEngine {
    fn default() -> Self {
        Self::new()
    }
}
