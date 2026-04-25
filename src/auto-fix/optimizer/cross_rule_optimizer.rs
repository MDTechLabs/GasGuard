use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use analysis_core::plugin::Finding;
use super::conflict_detector::{ConflictDetector, ConflictInfo};
use super::optimization_merger::{OptimizationMerger, MergeResult, MergedOptimization};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OptimizationPlan {
    pub id: String,
    pub merged_optimizations: Vec<MergedOptimization>,
    pub conflicts: Vec<ConflictInfo>,
    pub total_gas_savings: u64,
    pub confidence_score: f64,
    pub execution_order: Vec<String>, // Order to apply optimizations
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OptimizationResult {
    pub success: bool,
    pub plan: OptimizationPlan,
    pub applied_optimizations: Vec<String>,
    pub failed_optimizations: Vec<String>,
    pub final_gas_savings: u64,
    pub errors: Vec<String>,
}

pub struct CrossRuleOptimizer {
    conflict_detector: ConflictDetector,
    optimization_merger: OptimizationMerger,
}

impl CrossRuleOptimizer {
    pub fn new() -> Self {
        Self {
            conflict_detector: ConflictDetector::new(),
            optimization_merger: OptimizationMerger::new(),
        }
    }

    pub fn optimize_findings(&self, findings: &[Finding]) -> OptimizationResult {
        // Step 1: Detect conflicts
        let conflicts = self.conflict_detector.detect_conflicts(findings);
        
        // Step 2: Merge compatible optimizations
        let merge_result = self.optimization_merger.merge_optimizations(findings, &conflicts);
        
        // Step 3: Create execution plan
        let plan = self.create_optimization_plan(&merge_result, &conflicts);
        
        // Step 4: Execute optimizations (in a real implementation)
        let execution_result = self.execute_optimization_plan(&plan);
        
        execution_result
    }

    fn create_optimization_plan(
        &self,
        merge_result: &MergeResult,
        conflicts: &[ConflictInfo]
    ) -> OptimizationPlan {
        let execution_order = self.determine_execution_order(&merge_result.merged_optimizations, conflicts);
        let confidence_score = self.calculate_plan_confidence(&merge_result.merged_optimizations, conflicts);

        OptimizationPlan {
            id: format!("plan-{}", uuid::Uuid::new_v4()),
            merged_optimizations: merge_result.merged_optimizations.clone(),
            conflicts: conflicts.to_vec(),
            total_gas_savings: merge_result.total_gas_savings,
            confidence_score,
            execution_order,
        }
    }

    fn determine_execution_order(
        &self,
        optimizations: &[MergedOptimization],
        conflicts: &[ConflictInfo]
    ) -> Vec<String> {
        let mut order = Vec::new();
        let mut used = std::collections::HashSet::new();

        // Sort optimizations by gas savings (highest first) and confidence
        let mut sorted_optimizations = optimizations.to_vec();
        sorted_optimizations.sort_by(|a, b| {
            b.gas_savings.cmp(&a.gas_savings)
                .then(b.confidence.partial_cmp(&a.confidence).unwrap_or(std::cmp::Ordering::Equal))
        });

        // Add optimizations in order, respecting dependencies
        for opt in &sorted_optimizations {
            if !used.contains(&opt.id) {
                order.push(opt.id.clone());
                used.insert(opt.id.clone());
            }
        }

        order
    }

    fn calculate_plan_confidence(
        &self,
        optimizations: &[MergedOptimization],
        conflicts: &[ConflictInfo]
    ) -> f64 {
        let mut confidence = 0.8; // Base confidence

        // Adjust based on optimization confidence
        if !optimizations.is_empty() {
            let avg_opt_confidence: f64 = optimizations.iter()
                .map(|o| o.confidence)
                .sum::<f64>() / optimizations.len() as f64;
            confidence = (confidence + avg_opt_confidence) / 2.0;
        }

        // Reduce confidence based on conflicts
        for conflict in conflicts {
            match conflict.severity {
                super::conflict_detector::ConflictSeverity::Low => confidence -= 0.05,
                super::conflict_detector::ConflictSeverity::Medium => confidence -= 0.1,
                super::conflict_detector::ConflictSeverity::High => confidence -= 0.2,
            }
        }

        confidence.max(0.1).min(1.0)
    }

    fn execute_optimization_plan(&self, plan: &OptimizationPlan) -> OptimizationResult {
        let mut applied = Vec::new();
        let mut failed = Vec::new();
        let mut errors = Vec::new();
        let mut actual_savings = 0u64;

        // In a real implementation, this would apply the optimizations to the code
        // For now, we'll simulate the execution
        for opt_id in &plan.execution_order {
            if let Some(opt) = plan.merged_optimizations.iter().find(|o| o.id == *opt_id) {
                // Simulate application success based on confidence
                if opt.confidence > 0.5 {
                    applied.push(opt_id.clone());
                    actual_savings += opt.gas_savings;
                } else {
                    failed.push(opt_id.clone());
                    errors.push(format!("Low confidence optimization: {}", opt_id));
                }
            } else {
                failed.push(opt_id.clone());
                errors.push(format!("Optimization not found: {}", opt_id));
            }
        }

        OptimizationResult {
            success: failed.is_empty(),
            plan: plan.clone(),
            applied_optimizations: applied,
            failed_optimizations: failed,
            final_gas_savings: actual_savings,
            errors,
        }
    }

    pub fn get_optimization_summary(&self, result: &OptimizationResult) -> String {
        format!(
            "Optimization Plan Summary:\n\
            - Total Optimizations: {}\n\
            - Applied: {}\n\
            - Failed: {}\n\
            - Expected Gas Savings: {}\n\
            - Actual Gas Savings: {}\n\
            - Confidence Score: {:.2}",
            result.plan.merged_optimizations.len(),
            result.applied_optimizations.len(),
            result.failed_optimizations.len(),
            result.plan.total_gas_savings,
            result.final_gas_savings,
            result.plan.confidence_score
        )
    }

    pub fn get_conflict_report(&self, conflicts: &[ConflictInfo]) -> String {
        if conflicts.is_empty() {
            return "No conflicts detected. All optimizations are compatible.".to_string();
        }

        let mut report = format!("Conflict Report ({} conflicts found):\n", conflicts.len());
        for (i, conflict) in conflicts.iter().enumerate() {
            report.push_str(&format!(
                "\n{}. {} ({:?})\n   Involved: {}\n   Description: {}\n   Suggestion: {}",
                i + 1,
                match conflict.conflict_type {
                    super::conflict_detector::ConflictType::OverlappingModification => "Overlapping Modification",
                    super::conflict_detector::ConflictType::ContradictoryOptimization => "Contradictory Optimization",
                    super::conflict_detector::ConflictType::DependencyViolation => "Dependency Violation",
                    super::conflict_detector::ConflictType::ScopeConflict => "Scope Conflict",
                },
                conflict.severity,
                conflict.involved_findings.join(", "),
                conflict.description,
                self.conflict_detector.get_resolution_suggestion(conflict)
            ));
        }
        report
    }

    pub fn validate_optimization_plan(&self, plan: &OptimizationPlan) -> Vec<String> {
        let mut warnings = Vec::new();

        // Check for low confidence optimizations
        for opt in &plan.merged_optimizations {
            if opt.confidence < 0.6 {
                warnings.push(format!(
                    "Low confidence optimization: {} (confidence: {:.2})",
                    opt.id, opt.confidence
                ));
            }
        }

        // Check for high severity conflicts
        for conflict in &plan.conflicts {
            if matches!(conflict.severity, super::conflict_detector::ConflictSeverity::High) {
                warnings.push(format!(
                    "High severity conflict between: {}",
                    conflict.involved_findings.join(", ")
                ));
            }
        }

        // Check if total gas savings seem unrealistic
        if plan.total_gas_savings > 100000 {
            warnings.push("Very high gas savings estimate - please verify".to_string());
        }

        warnings
    }
}

impl Default for CrossRuleOptimizer {
    fn default() -> Self {
        Self::new()
    }
}
