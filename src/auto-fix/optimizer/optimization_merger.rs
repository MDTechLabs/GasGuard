use std::collections::{HashMap, HashSet};
use serde::{Deserialize, Serialize};
use analysis_core::plugin::Finding;
use super::conflict_detector::{ConflictInfo, ConflictType, ConflictSeverity};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergedOptimization {
    pub id: String,
    pub description: String,
    pub file: String,
    pub lines_affected: Vec<u32>,
    pub gas_savings: u64,
    pub severity: String,
    pub original_findings: Vec<String>, // IDs of merged findings
    pub merged_suggestion: String,
    pub confidence: f64, // 0.0 to 1.0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeResult {
    pub merged_optimizations: Vec<MergedOptimization>,
    pub rejected_findings: Vec<String>, // Finding IDs that couldn't be merged
    pub conflicts_resolved: Vec<ConflictInfo>,
    pub total_gas_savings: u64,
}

pub struct OptimizationMerger {
    merge_strategies: HashMap<String, MergeStrategy>,
}

#[derive(Debug, Clone)]
enum MergeStrategy {
    Sequential,     // Apply in order
    Parallel,       // Apply simultaneously if compatible
    Conditional,    // Apply based on conditions
    Hierarchical,   // Apply based on dependency hierarchy
}

impl OptimizationMerger {
    pub fn new() -> Self {
        let mut merger = Self {
            merge_strategies: HashMap::new(),
        };
        merger.initialize_strategies();
        merger
    }

    pub fn merge_optimizations(
        &self,
        findings: &[Finding],
        conflicts: &[ConflictInfo]
    ) -> MergeResult {
        let mut merged = Vec::new();
        let mut rejected = Vec::new();
        let mut conflicts_resolved = Vec::new();
        let mut used_findings: HashSet<String> = HashSet::new();

        // Group findings by file and rule type
        let mut grouped_findings: HashMap<String, Vec<&Finding>> = HashMap::new();
        for finding in findings {
            let key = format!("{}:{}", finding.file, finding.rule_id);
            grouped_findings.entry(key).or_insert_with(Vec::new).push(finding);
        }

        // Process each group
        for (group_key, group_findings) in grouped_findings {
            let group_conflicts: Vec<&ConflictInfo> = conflicts
                .iter()
                .filter(|c| {
                    group_findings.iter().any(|f| c.involved_findings.contains(&f.rule_id))
                })
                .collect();

            if let Some(merged_opt) = self.merge_group(&group_findings, &group_conflicts) {
                // Mark findings as used
                for finding in &group_findings {
                    used_findings.insert(finding.rule_id.clone());
                }
                merged.push(merged_opt);
            } else {
                // Couldn't merge, add to rejected
                for finding in &group_findings {
                    rejected.push(finding.rule_id.clone());
                }
            }
        }

        // Add individual findings that weren't part of any group
        for finding in findings {
            if !used_findings.contains(&finding.rule_id) {
                // Convert to individual optimization
                merged.push(MergedOptimization {
                    id: format!("individual-{}", finding.rule_id),
                    description: finding.message.clone(),
                    file: finding.file.clone(),
                    lines_affected: vec![finding.line],
                    gas_savings: self.estimate_gas_savings(finding),
                    severity: format!("{:?}", finding.severity),
                    original_findings: vec![finding.rule_id.clone()],
                    merged_suggestion: finding.suggestion.clone().unwrap_or_default(),
                    confidence: 0.8,
                });
            }
        }

        let total_savings = merged.iter().map(|m| m.gas_savings).sum();

        MergeResult {
            merged_optimizations: merged,
            rejected_findings: rejected,
            conflicts_resolved: conflicts_resolved,
            total_gas_savings: total_savings,
        }
    }

    fn merge_group(
        &self,
        findings: &[&Finding],
        conflicts: &[&ConflictInfo]
    ) -> Option<MergedOptimization> {
        if findings.is_empty() {
            return None;
        }

        // Check if we can merge this group
        if !self.can_merge_group(findings, conflicts) {
            return None;
        }

        let first_finding = &findings[0];
        let mut total_gas_savings = 0u64;
        let mut lines_affected = HashSet::new();
        let mut original_findings = Vec::new();

        for finding in findings {
            total_gas_savings += self.estimate_gas_savings(finding);
            lines_affected.insert(finding.line);
            original_findings.push(finding.rule_id.clone());
        }

        // Create merged suggestion
        let merged_suggestion = self.create_merged_suggestion(findings);

        Some(MergedOptimization {
            id: format!("merged-{}", first_finding.rule_id),
            description: self.create_merged_description(findings),
            file: first_finding.file.clone(),
            lines_affected: lines_affected.into_iter().collect(),
            gas_savings: total_gas_savings,
            severity: format!("{:?}", first_finding.severity),
            original_findings,
            merged_suggestion,
            confidence: self.calculate_merge_confidence(findings, conflicts),
        })
    }

    fn can_merge_group(&self, findings: &[&Finding], conflicts: &[&ConflictInfo]) -> bool {
        // Check for high severity conflicts
        for conflict in conflicts {
            if matches!(conflict.severity, ConflictSeverity::High) {
                return false;
            }
        }

        // Check if findings are compatible
        if findings.len() == 1 {
            return true;
        }

        // Check if findings are on the same or adjacent lines
        let lines: Vec<u32> = findings.iter().map(|f| f.line).collect();
        let max_line = lines.iter().max().unwrap();
        let min_line = lines.iter().min().unwrap();
        
        // Only merge if findings are close (within 5 lines)
        max_line - min_line <= 5
    }

    fn create_merged_suggestion(&self, findings: &[&Finding]) -> String {
        if findings.len() == 1 {
            return findings[0].suggestion.clone().unwrap_or_default();
        }

        let mut suggestions = Vec::new();
        for finding in findings {
            if let Some(suggestion) = &finding.suggestion {
                if !suggestion.trim().is_empty() && !suggestion.starts_with("//") {
                    suggestions.push(suggestion.clone());
                }
            }
        }

        if suggestions.is_empty() {
            "Apply multiple optimizations for maximum gas savings".to_string()
        } else if suggestions.len() == 1 {
            suggestions[0].clone()
        } else {
            format!("Combined optimizations: {}", suggestions.join("; "))
        }
    }

    fn create_merged_description(&self, findings: &[&Finding]) -> String {
        if findings.len() == 1 {
            return findings[0].message.clone();
        }

        let rule_names: Vec<String> = findings.iter()
            .map(|f| f.rule_id.clone())
            .collect();
        
        format!(
            "Combined optimization from {} rules affecting same code region",
            rule_names.len()
        )
    }

    fn calculate_merge_confidence(&self, findings: &[&Finding], conflicts: &[&ConflictInfo]) -> f64 {
        let mut confidence = 0.8; // Base confidence

        // Reduce confidence based on conflicts
        for conflict in conflicts {
            match conflict.severity {
                ConflictSeverity::Low => confidence -= 0.1,
                ConflictSeverity::Medium => confidence -= 0.2,
                ConflictSeverity::High => confidence -= 0.4,
            }
        }

        // Increase confidence for compatible findings
        if findings.len() > 1 {
            confidence += 0.1;
        }

        confidence.max(0.1).min(1.0)
    }

    fn estimate_gas_savings(&self, finding: &Finding) -> u64 {
        // Simple heuristic based on rule type and severity
        let base_savings = match finding.rule_id.as_str() {
            "SOL-001" => 5000, // string to bytes32
            "SOL-002" => 2100, // redundant SLOAD
            "SOL-003" => 100,  // unused code (varies)
            _ => 1000,
        };

        let severity_multiplier = match finding.severity {
            analysis_core::plugin::Severity::Info => 0.5,
            analysis_core::plugin::Severity::Warning => 1.0,
            analysis_core::plugin::Severity::Error => 1.5,
            analysis_core::plugin::Severity::Critical => 2.0,
        };

        (base_savings as f64 * severity_multiplier) as u64
    }

    fn initialize_strategies(&mut self) {
        // Initialize merge strategies for different rule combinations
        self.merge_strategies.insert("SOL-001,SOL-002".to_string(), MergeStrategy::Sequential);
        self.merge_strategies.insert("SOL-003,SOL-003".to_string(), MergeStrategy::Parallel);
        self.merge_strategies.insert("default".to_string(), MergeStrategy::Hierarchical);
    }

    pub fn get_merge_explanation(&self, merged: &MergedOptimization) -> String {
        if merged.original_findings.len() == 1 {
            format!("Individual optimization: {}", merged.description)
        } else {
            format!(
                "Merged {} optimizations ({}): {}",
                merged.original_findings.len(),
                merged.original_findings.join(", "),
                merged.description
            )
        }
    }
}
