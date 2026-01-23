use anyhow::{Context, Result};
use gasguard_rules::{RuleEngine, UnusedStateVariablesRule, VyperRuleEngine, SorobanRuleEngine};
use std::path::Path;

/// Supported languages for scanning
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Language {
    Rust,
    Vyper,
    Soroban, // Added Soroban support
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
    
    /// Detect language from file content heuristics
    pub fn from_content(content: &str) -> Option<Self> {
        // Check for Soroban-specific patterns
        if content.contains("soroban_sdk") && 
           (content.contains("#[contract]") || 
            content.contains("#[contractimpl]") || 
            content.contains("#[contracttype]")) {
            return Some(Language::Soroban);
        }
        
        // Check for Vyper patterns
        if content.contains("# @version") || content.contains("interface ") {
            return Some(Language::Vyper);
        }
        
        // Default to Rust for .rs files or general Rust code
        if content.contains("fn main(") || content.contains("#[derive(") {
            return Some(Language::Rust);
        }
        
        None
    }
}

pub struct ContractScanner {
    rule_engine: RuleEngine,
    vyper_rule_engine: VyperRuleEngine,
    soroban_rule_engine: SorobanRuleEngine, // Added Soroban rule engine
}

impl ContractScanner {
    pub fn new() -> Self {
        let rule_engine = RuleEngine::new().add_rule(Box::new(UnusedStateVariablesRule));
        let vyper_rule_engine = VyperRuleEngine::with_default_rules();
        let soroban_rule_engine = SorobanRuleEngine::with_default_rules(); // Initialize Soroban engine

        Self {
            rule_engine,
            vyper_rule_engine,
            soroban_rule_engine,
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
        let detected_language = language.or_else(|| Language::from_content(content));
        
        let violations = match detected_language {
            Some(Language::Rust) => self
                .rule_engine
                .analyze(content)
                .map_err(|e| anyhow::anyhow!(e))?,
            Some(Language::Vyper) => self
                .vyper_rule_engine
                .analyze(content)
                .map_err(|e| anyhow::anyhow!(e))?,
            Some(Language::Soroban) => self
                .soroban_rule_engine
                .analyze(content, &source)
                .map_err(|e| anyhow::anyhow!(format!("Soroban analysis failed: {:?}", e)))?,
            None => {
                // Unknown language, try to detect and analyze
                if content.contains("soroban_sdk") {
                    self.soroban_rule_engine
                        .analyze(content, &source)
                        .map_err(|e| anyhow::anyhow!(format!("Soroban analysis failed: {:?}", e)))?
                } else {
                    // Default to general Rust analysis
                    self.rule_engine
                        .analyze(content)
                        .map_err(|e| anyhow::anyhow!(e))?
                }
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
    
    /// Scan a Soroban contract file specifically
    pub fn scan_soroban_file(&self, file_path: &Path) -> Result<ScanResult> {
        let content = std::fs::read_to_string(file_path)
            .with_context(|| format!("Failed to read file: {:?}", file_path))?;

        self.scan_soroban_content(&content, file_path.to_string_lossy().to_string())
    }

    /// Scan Soroban contract content directly
    pub fn scan_soroban_content(&self, content: &str, source: String) -> Result<ScanResult> {
        let violations = self
            .soroban_rule_engine
            .analyze(content, &source)
            .map_err(|e| anyhow::anyhow!(format!("Soroban analysis failed: {:?}", e)))?;

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
                    ext_str == "rs" || ext_str == "vy" // Both Rust and Vyper files
                })
            })
        {
            let content = std::fs::read_to_string(entry.path())
                .with_context(|| format!("Failed to read file: {:?}", entry.path()))?;
            
            // Detect language from content for better accuracy
            let language = Language::from_content(&content).or_else(|| {
                entry.path().extension()
                    .and_then(|ext| Language::from_extension(ext.to_str().unwrap_or("")))
            });
            
            let result = match language {
                Some(Language::Soroban) => {
                    self.scan_soroban_content(&content, entry.path().to_string_lossy().to_string())?
                },
                Some(Language::Vyper) => {
                    self.scan_vyper_content(&content, entry.path().to_string_lossy().to_string())?
                },
                _ => {
                    // Default to general scanning
                    self.scan_content_with_language(&content, entry.path().to_string_lossy().to_string(), language)?
                }
            };
            
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
