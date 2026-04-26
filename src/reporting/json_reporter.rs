use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use analysis_core::plugin::Finding;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanReport {
    pub metadata: ReportMetadata,
    pub summary: ReportSummary,
    pub findings: Vec<ReportFinding>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReportMetadata {
    pub version: String,
    pub tool: String,
    pub timestamp: String,
    pub scan_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReportSummary {
    pub total_files: usize,
    pub scanned_files: usize,
    pub total_violations: usize,
    pub total_gas_savings: u64,
    pub by_severity: SeverityBreakdown,
    pub by_rule: std::collections::HashMap<String, usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeverityBreakdown {
    pub critical: usize,
    pub high: usize,
    pub medium: usize,
    pub low: usize,
    pub info: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReportFinding {
    pub file: String,
    pub line: u32,
    pub rule_id: String,
    pub rule_name: String,
    pub severity: String,
    pub message: String,
    pub suggestion: Option<String>,
    pub gas_savings: Option<u64>,
    pub confidence: Option<f64>,
    pub category: String,
}

pub struct JsonReporter;

impl JsonReporter {
    pub fn new() -> Self {
        Self
    }

    pub fn generate_report<P: AsRef<Path>>(
        &self,
        findings: &[Finding],
        scan_path: &str,
        output_path: P,
    ) -> Result<(), String> {
        let report = self.create_report(findings, scan_path);
        
        let json = serde_json::to_string_pretty(&report)
            .map_err(|e| format!("Failed to serialize report: {}", e))?;
        
        fs::write(output_path, json)
            .map_err(|e| format!("Failed to write report: {}", e))?;
        
        Ok(())
    }

    pub fn create_report(&self, findings: &[Finding], scan_path: &str) -> ScanReport {
        let total_violations = findings.len();
        let total_gas_savings: u64 = findings.iter()
            .filter_map(|f| self.estimate_gas_savings(f))
            .sum();

        let by_severity = self.calculate_severity_breakdown(findings);
        let by_rule = self.calculate_rule_breakdown(findings);

        let report_findings = findings.iter()
            .map(|f| self.convert_finding(f))
            .collect();

        ScanReport {
            metadata: ReportMetadata {
                version: "1.0.0".to_string(),
                tool: "GasGuard".to_string(),
                timestamp: chrono::Utc::now().to_rfc3339(),
                scan_path: scan_path.to_string(),
            },
            summary: ReportSummary {
                total_files: findings.len(), // This would be actual file count in real implementation
                scanned_files: findings.len(),
                total_violations,
                total_gas_savings,
                by_severity,
                by_rule,
            },
            findings: report_findings,
        }
    }

    fn convert_finding(&self, finding: &Finding) -> ReportFinding {
        ReportFinding {
            file: finding.file.clone(),
            line: finding.line,
            rule_id: finding.rule_id.clone(),
            rule_name: finding.rule_id.clone(), // Would be actual rule name in real implementation
            severity: format!("{:?}", finding.severity),
            message: finding.message.clone(),
            suggestion: finding.suggestion.clone(),
            gas_savings: self.estimate_gas_savings(finding),
            confidence: Some(0.8), // Would be calculated in real implementation
            category: self.categorize_finding(finding),
        }
    }

    fn categorize_finding(&self, finding: &Finding) -> String {
        if finding.rule_id.starts_with("SOL-") {
            "solidity".to_string()
        } else if finding.rule_id.starts_with("VY-") {
            "vyper".to_string()
        } else if finding.rule_id.starts_with("RS-") {
            "rust".to_string()
        } else if finding.rule_id.starts_with("SOR-") {
            "soroban".to_string()
        } else {
            "general".to_string()
        }
    }

    fn calculate_severity_breakdown(&self, findings: &[Finding]) -> SeverityBreakdown {
        let mut breakdown = SeverityBreakdown {
            critical: 0,
            high: 0,
            medium: 0,
            low: 0,
            info: 0,
        };

        for finding in findings {
            match finding.severity {
                analysis_core::plugin::Severity::Critical => breakdown.critical += 1,
                analysis_core::plugin::Severity::Error => breakdown.high += 1,
                analysis_core::plugin::Severity::Warning => breakdown.medium += 1,
                analysis_core::plugin::Severity::Info => breakdown.low += 1,
            }
        }

        breakdown
    }

    fn calculate_rule_breakdown(&self, findings: &[Finding]) -> std::collections::HashMap<String, usize> {
        let mut breakdown = std::collections::HashMap::new();
        
        for finding in findings {
            *breakdown.entry(finding.rule_id.clone()).or_insert(0) += 1;
        }
        
        breakdown
    }

    fn estimate_gas_savings(&self, finding: &Finding) -> Option<u64> {
        // Simple heuristic based on rule type
        let savings = match finding.rule_id.as_str() {
            "SOL-001" => Some(5000),
            "SOL-002" => Some(2100),
            "SOL-003" => Some(100),
            _ => None,
        };
        
        savings
    }
}

impl Default for JsonReporter {
    fn default() -> Self {
        Self::new()
    }
}
