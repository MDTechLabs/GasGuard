use std::collections::{HashMap, HashSet};
use serde::{Deserialize, Serialize};
use analysis_core::plugin::Finding;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConflictInfo {
    pub conflict_type: ConflictType,
    pub severity: ConflictSeverity,
    pub description: String,
    pub involved_findings: Vec<String>, // Finding IDs
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ConflictType {
    OverlappingModification,
    ContradictoryOptimization,
    DependencyViolation,
    ScopeConflict,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ConflictSeverity {
    Low,     // Can be resolved automatically
    Medium,  // Requires user choice
    High,    // Should not be merged
}

pub struct ConflictDetector {
    conflict_rules: HashMap<String, Vec<ConflictRule>>,
}

#[derive(Debug, Clone)]
struct ConflictRule {
    rule_id_pattern: String,
    conflicts_with: Vec<String>,
    conflict_type: ConflictType,
    resolution_strategy: ResolutionStrategy,
}

#[derive(Debug, Clone)]
enum ResolutionStrategy {
    PreferFirst,
    PreferSecond,
    MergeIfCompatible,
    RequireUserInput,
}

impl ConflictDetector {
    pub fn new() -> Self {
        let mut detector = Self {
            conflict_rules: HashMap::new(),
        };
        detector.initialize_default_rules();
        detector
    }

    pub fn detect_conflicts(&self, findings: &[Finding]) -> Vec<ConflictInfo> {
        let mut conflicts = Vec::new();
        
        // Check for conflicts between all pairs of findings
        for (i, finding1) in findings.iter().enumerate() {
            for finding2 in findings.iter().skip(i + 1) {
                if let Some(conflict) = self.check_pair_conflict(finding1, finding2) {
                    conflicts.push(conflict);
                }
            }
        }

        // Check for multi-finding conflicts
        conflicts.extend(self.check_multi_finding_conflicts(findings));

        conflicts
    }

    fn check_pair_conflict(&self, finding1: &Finding, finding2: &Finding) -> Option<ConflictInfo> {
        // Check if findings are on the same line and have conflicting suggestions
        if finding1.line == finding2.line && finding1.file == finding2.file {
            if let (Some(suggestion1), Some(suggestion2)) = (&finding1.suggestion, &finding2.suggestion) {
                if self.are_suggestions_conflicting(suggestion1, suggestion2) {
                    return Some(ConflictInfo {
                        conflict_type: ConflictType::OverlappingModification,
                        severity: ConflictSeverity::Medium,
                        description: format!(
                            "Conflicting suggestions on line {} of {}",
                            finding1.line, finding1.file
                        ),
                        involved_findings: vec![finding1.rule_id.clone(), finding2.rule_id.clone()],
                    });
                }
            }
        }

        // Check rule-specific conflicts
        if let Some(rule_conflicts) = self.conflict_rules.get(&finding1.rule_id) {
            for rule in rule_conflicts {
                if finding2.rule_id.contains(&rule.conflicts_with[0]) {
                    return Some(ConflictInfo {
                        conflict_type: rule.conflict_type.clone(),
                        severity: self.determine_severity(&rule.conflict_type),
                        description: format!(
                            "Rule conflict between {} and {}",
                            finding1.rule_id, finding2.rule_id
                        ),
                        involved_findings: vec![finding1.rule_id.clone(), finding2.rule_id.clone()],
                    });
                }
            }
        }

        None
    }

    fn check_multi_finding_conflicts(&self, findings: &[Finding]) -> Vec<ConflictInfo> {
        let mut conflicts = Vec::new();
        
        // Group findings by file and check for scope conflicts
        let mut file_groups: HashMap<String, Vec<&Finding>> = HashMap::new();
        for finding in findings {
            file_groups.entry(finding.file.clone()).or_insert_with(Vec::new).push(finding);
        }

        for (file, file_findings) in file_groups {
            conflicts.extend(self.check_scope_conflicts(&file_findings));
        }

        conflicts
    }

    fn check_scope_conflicts(&self, findings: &[&Finding]) -> Vec<ConflictInfo> {
        let mut conflicts = Vec::new();
        
        // Check for variable removal vs usage conflicts
        let mut removal_findings: Vec<&Finding> = Vec::new();
        let mut usage_findings: Vec<&Finding> = Vec::new();
        
        for finding in findings {
            if finding.rule_id.contains("SOL-003") && finding.message.contains("unused") {
                removal_findings.push(finding);
            } else if finding.message.contains("use") || finding.message.contains("access") {
                usage_findings.push(finding);
            }
        }

        for removal in &removal_findings {
            for usage in &usage_findings {
                if self.variable_usage_conflicts(removal, usage) {
                    conflicts.push(ConflictInfo {
                        conflict_type: ConflictType::DependencyViolation,
                        severity: ConflictSeverity::High,
                        description: format!(
                            "Variable removal conflicts with usage: {} vs {}",
                            removal.message, usage.message
                        ),
                        involved_findings: vec![removal.rule_id.clone(), usage.rule_id.clone()],
                    });
                }
            }
        }

        conflicts
    }

    fn variable_usage_conflicts(&self, removal: &Finding, usage: &Finding) -> bool {
        // Simple heuristic: if they're close in the same file, might conflict
        removal.file == usage.file && 
        (removal.line as i32 - usage.line as i32).abs() < 10
    }

    fn are_suggestions_conflicting(&self, suggestion1: &str, suggestion2: &str) -> bool {
        // Simple heuristic: if suggestions are different and both modify code
        suggestion1 != suggestion2 && 
        (suggestion1.contains("Remove") || suggestion1.contains("Replace") || 
         suggestion2.contains("Remove") || suggestion2.contains("Replace"))
    }

    fn determine_severity(&self, conflict_type: &ConflictType) -> ConflictSeverity {
        match conflict_type {
            ConflictType::OverlappingModification => ConflictSeverity::Medium,
            ConflictType::ContradictoryOptimization => ConflictSeverity::High,
            ConflictType::DependencyViolation => ConflictSeverity::High,
            ConflictType::ScopeConflict => ConflictSeverity::Low,
        }
    }

    fn initialize_default_rules(&mut self) {
        // SOL-001 (string to bytes32) conflicts with SOL-003 (unused code) if removing the string
        self.conflict_rules.insert("SOL-001".to_string(), vec![
            ConflictRule {
                rule_id_pattern: "SOL-001".to_string(),
                conflicts_with: vec!["SOL-003".to_string()],
                conflict_type: ConflictType::DependencyViolation,
                resolution_strategy: ResolutionStrategy::PreferFirst,
            }
        ]);

        // SOL-002 (redundant SLOAD) conflicts with variable removal
        self.conflict_rules.insert("SOL-002".to_string(), vec![
            ConflictRule {
                rule_id_pattern: "SOL-002".to_string(),
                conflicts_with: vec!["SOL-003".to_string()],
                conflict_type: ConflictType::ContradictoryOptimization,
                resolution_strategy: ResolutionStrategy::RequireUserInput,
            }
        ]);
    }

    pub fn get_resolution_suggestion(&self, conflict: &ConflictInfo) -> String {
        match conflict.conflict_type {
            ConflictType::OverlappingModification => {
                "Consider applying only one of the conflicting optimizations or merge manually.".to_string()
            }
            ConflictType::ContradictoryOptimization => {
                "These optimizations contradict each other. Choose the one with higher gas savings.".to_string()
            }
            ConflictType::DependencyViolation => {
                "One optimization depends on code that another wants to remove. Review dependencies.".to_string()
            }
            ConflictType::ScopeConflict => {
                "Scope-related conflict. Check if optimizations affect the same variable/function scope.".to_string()
            }
        }
    }
}
