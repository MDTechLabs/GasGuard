use anyhow::{Context, Result};
use gasguard_ast::{UnifiedAST, Language as AstLanguage};
use gasguard_rule_engine::{RuleEngine, RuleViolation};
use gasguard_parser_rust::RustParser;
use gasguard_parser_solidity::SolidityParser;
use gasguard_parser_vyper::VyperParser;
use std::path::Path;

/// Supported languages for scanning
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Language {
    Rust,
    Vyper,
    Solidity,
    Soroban,
}

pub struct ContractScanner {
    rule_engine: RuleEngine,
}

impl ContractScanner {
    pub fn new() -> Self {
        let rule_engine = RuleEngine::new();
        // Rules will be added here or via plugins
        Self { rule_engine }
    }

    pub fn scan_file(&self, file_path: &Path) -> Result<ScanResult> {
        let content = std::fs::read_to_string(file_path)
            .with_context(|| format!("Failed to read file: {:?}", file_path))?;

        let extension = file_path.extension().and_then(|e| e.to_str()).unwrap_or("");
        let file_path_str = file_path.to_string_lossy().to_string();

        let ast = match extension {
            "rs" => RustParser::parse(&content, &file_path_str)
                .map_err(|e| anyhow::anyhow!("Rust parse error: {}", e))?,
            "sol" => SolidityParser::parse(&content, &file_path_str)
                .map_err(|e| anyhow::anyhow!("Solidity parse error: {}", e))?,
            "vy" => VyperParser::parse(&content, &file_path_str)
                .map_err(|e| anyhow::anyhow!("Vyper parse error: {}", e))?,
            _ => return Err(anyhow::anyhow!("Unsupported file extension: {}", extension)),
        };

        let violations = self.rule_engine.run(&ast);

        Ok(ScanResult {
            source: file_path_str,
            violations,
            scan_time: chrono::Utc::now(),
        })
    }

    pub fn scan_content_with_language(
        &self,
        content: &str,
        source: String,
        language: Language,
    ) -> Result<ScanResult> {
        let ast = match language {
            AstLanguage::Rust | AstLanguage::Soroban => RustParser::parse(content, &source)
                .map_err(|e| anyhow::anyhow!("Rust parse error: {}", e))?,
            AstLanguage::Solidity => SolidityParser::parse(content, &source)
                .map_err(|e| anyhow::anyhow!("Solidity parse error: {}", e))?,
            AstLanguage::Vyper => VyperParser::parse(content, &source)
                .map_err(|e| anyhow::anyhow!("Vyper parse error: {}", e))?,
        };

        let violations = self.rule_engine.run(&ast);

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
                    ext_str == "rs" || ext_str == "vy" || ext_str == "sol"
                })
            })
        {
            if let Ok(result) = self.scan_file(entry.path()) {
                if !result.violations.is_empty() {
                    results.push(result);
                }
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
    pub violations: Vec<RuleViolation>,
    pub scan_time: chrono::DateTime<chrono::Utc>,
}

impl ScanResult {
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string_pretty(self)
    }
}
