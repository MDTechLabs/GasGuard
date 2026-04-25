use std::collections::HashMap;
use super::interface::{BaseRule, Language, RuleConfig};
use super::io::{AnalysisInput, AnalysisOutput, SessionOutput};

/// Central store for all registered [`BaseRule`] implementations.
///
/// Usage:
/// ```rust
/// let mut registry = PluginRegistry::new();
/// registry.register(Box::new(MyRule::default()))?;
/// let session = registry.run_session(&inputs);
/// ```
pub struct PluginRegistry {
    rules: HashMap<String, Box<dyn BaseRule>>,
}

impl PluginRegistry {
    pub fn new() -> Self {
        Self { rules: HashMap::new() }
    }

    /// Register a rule with the given config.  Calls `on_init` and returns
    /// an error if initialisation fails or the rule id is already registered.
    pub fn register(
        &mut self,
        mut rule: Box<dyn BaseRule>,
        config: &RuleConfig,
    ) -> Result<(), String> {
        let id = rule.meta().id.to_string();
        if self.rules.contains_key(&id) {
            return Err(format!("Rule '{}' is already registered", id));
        }
        rule.on_init(config)?;
        self.rules.insert(id, rule);
        Ok(())
    }

    /// Register with default (empty) config.
    pub fn register_default(&mut self, rule: Box<dyn BaseRule>) -> Result<(), String> {
        self.register(rule, &RuleConfig::default())
    }

    /// Returns the number of registered rules.
    pub fn len(&self) -> usize {
        self.rules.len()
    }

    /// Returns IDs of all registered rules.
    pub fn rule_ids(&self) -> Vec<&str> {
        self.rules.keys().map(String::as_str).collect()
    }

    /// Returns rules that target a specific language.
    pub fn rules_for(&self, lang: &Language) -> Vec<&dyn BaseRule> {
        self.rules
            .values()
            .filter(|r| r.meta().languages.contains(lang))
            .map(|r| r.as_ref())
            .collect()
    }

    // -----------------------------------------------------------------------
    // Session execution
    // -----------------------------------------------------------------------

    /// Run a full analysis session over a list of inputs.
    ///
    /// 1. Calls `on_start` on every rule.
    /// 2. For each input, calls `analyze` on every applicable rule.
    /// 3. Calls `on_end` on every rule and collects cross-file findings.
    /// 4. Calls `on_teardown` on every rule.
    pub fn run_session(&mut self, inputs: &[AnalysisInput]) -> SessionOutput {
        let mut session = SessionOutput::default();

        // Phase 1 – start
        for rule in self.rules.values_mut() {
            rule.on_start();
        }

        // Phase 2 – per-file analysis
        for input in inputs {
            for rule in self.rules.values() {
                let applicable = rule
                    .meta()
                    .languages
                    .iter()
                    .any(|l| language_matches(l, &input.file_path));

                if !applicable {
                    continue;
                }

                let findings = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    rule.analyze(&input.file_path, &input.source)
                }));

                let output = match findings {
                    Ok(f) => AnalysisOutput::ok(rule.meta().id, &input.file_path, f),
                    Err(_) => AnalysisOutput::err(
                        rule.meta().id,
                        &input.file_path,
                        "Rule panicked during analysis",
                    ),
                };
                session.push(output);
            }
        }

        // Phase 3 – end (cross-file findings)
        for rule in self.rules.values_mut() {
            let cross_file = rule.on_end();
            if !cross_file.is_empty() {
                session.push(AnalysisOutput::ok(rule.meta().id, "<session>", cross_file));
            }
        }

        // Phase 4 – teardown
        for rule in self.rules.values_mut() {
            rule.on_teardown();
        }

        session
    }
}

impl Default for PluginRegistry {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Simple extension-based language detection.
fn language_matches(lang: &Language, path: &str) -> bool {
    match lang {
        Language::Solidity => path.ends_with(".sol"),
        Language::Rust => path.ends_with(".rs"),
        Language::Vyper => path.ends_with(".vy") || path.ends_with(".vyper"),
    }
}
