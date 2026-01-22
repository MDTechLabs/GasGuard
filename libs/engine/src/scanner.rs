use anyhow::{Context, Result};
use gasguard_rules::{RuleEngine, UnusedStateVariablesRule, VyperRuleEngine};
use std::path::Path;

/// Supported languages for scanning
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Language {
    Rust,
    Vyper,
}

impl Language {
    /// Detect language from file extension
    pub fn from_extension(ext: &str) -> Option<Self> {
        match ext.to_lowercase().as_str() {
            "rs" => Some(Language::Rust),
            "vy" => Some(Language::Vyper),
            _ => None,
        }
    }
}

pub struct ContractScanner {
    rule_engine: RuleEngine,
    vyper_rule_engine: VyperRuleEngine,
}

impl ContractScanner {
    pub fn new() -> Self {
        let rule_engine = RuleEngine::new().add_rule(Box::new(UnusedStateVariablesRule));
        let vyper_rule_engine = VyperRuleEngine::with_default_rules();

        Self {
            rule_engine,
            vyper_rule_engine,
        }
    }

    pub fn scan_file(&self, file_path: &Path) -> Result<ScanResult> {
        let content = std::fs::read_to_string(file_path)
            .with_context(|| format!("Failed to read file: {:?}", file_path))?;

        let extension = file_path.extension().and_then(|e| e.to_str()).unwrap_or("");

        let language = Language::from_extension(extension);

        self.scan_content_with_language(&content, file_path.to_string_lossy().to_string(), language)
    }

    pub fn scan_content(&self, content: &str, source: String) -> Result<ScanResult> {
        // Default to Rust for backward compatibility
        self.scan_content_with_language(content, source, Some(Language::Rust))
    }

    pub fn scan_content_with_language(
        &self,
        content: &str,
        source: String,
        language: Option<Language>,
    ) -> Result<ScanResult> {
        let violations = match language {
            Some(Language::Rust) => self
                .rule_engine
                .analyze(content)
                .map_err(|e| anyhow::anyhow!(e))?,
            Some(Language::Vyper) => self
                .vyper_rule_engine
                .analyze(content)
                .map_err(|e| anyhow::anyhow!(e))?,
            None => {
                // Unknown language, return empty violations
                Vec::new()
            }
        };

        Ok(ScanResult {
            source,
            violations,
            scan_time: chrono::Utc::now(),
        })
    }

    /// Scan a Vyper file specifically
    pub fn scan_vyper_file(&self, file_path: &Path) -> Result<ScanResult> {
        let content = std::fs::read_to_string(file_path)
            .with_context(|| format!("Failed to read file: {:?}", file_path))?;

        self.scan_vyper_content(&content, file_path.to_string_lossy().to_string())
    }

    /// Scan Vyper content directly
    pub fn scan_vyper_content(&self, content: &str, source: String) -> Result<ScanResult> {
        let violations = self
            .vyper_rule_engine
            .analyze(content)
            .map_err(|e| anyhow::anyhow!(e))?;

        Ok(ScanResult {
            source,
            violations,
            scan_time: chrono::Utc::now(),
        })
    }

    pub fn scan_directory(&self, dir_path: &Path) -> Result<Vec<ScanResult>> {
        let mut results = Vec::new();

        for entry in walkdir::WalkDir::new(dir_path)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.path().extension().map_or(false, |ext| {
                    let ext_str = ext.to_str().unwrap_or("");
                    Language::from_extension(ext_str).is_some()
                })
            })
        {
            let result = self.scan_file(entry.path())?;
            if !result.violations.is_empty() {
                results.push(result);
            }
        }

        Ok(results)
    }
}

impl Default for ContractScanner {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ScanResult {
    pub source: String,
    pub violations: Vec<gasguard_rules::RuleViolation>,
    pub scan_time: chrono::DateTime<chrono::Utc>,
}

impl ScanResult {
    pub fn has_violations(&self) -> bool {
        !self.violations.is_empty()
    }

    pub fn get_violations_by_severity(
        &self,
        severity: gasguard_rules::ViolationSeverity,
    ) -> Vec<&gasguard_rules::RuleViolation> {
        self.violations
            .iter()
            .filter(|v| std::mem::discriminant(&v.severity) == std::mem::discriminant(&severity))
            .collect()
    }

    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string_pretty(self)
    }
}
