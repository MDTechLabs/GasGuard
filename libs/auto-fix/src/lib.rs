use gasguard_rule_engine::RuleViolation;
use std::fs;
use std::path::Path;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixPreview {
    pub original_line: String,
    pub suggested_line: String,
    pub line_number: usize,
    pub rule_name: String,
    pub description: String,
    pub confidence: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixReport {
    pub file_path: String,
    pub previews: Vec<FixPreview>,
    pub total_fixes: usize,
    pub safe_fixes: usize,
    pub unsafe_fixes: usize,
}

pub struct FixEngine;

impl FixEngine {
    pub fn new() -> Self {
        Self
    }

    /// Generates a preview of fixes without applying them
    pub fn preview_fixes<P: AsRef<Path>>(&self, path: P, violations: &[RuleViolation]) -> Result<FixReport, String> {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();
        let mut previews = Vec::new();
        let mut safe_count = 0;
        let mut unsafe_count = 0;

        for violation in violations {
            let line_idx = violation.line_number.saturating_sub(1);
            if line_idx >= lines.len() {
                continue;
            }

            let is_safe = self.is_safe_fix(&violation);
            let confidence = self.calculate_fix_confidence(&violation, is_safe);
            
            if is_safe {
                safe_count += 1;
            } else {
                unsafe_count += 1;
            }

            let original_line = lines[line_idx].clone();
            let suggested_line = self.generate_suggested_line(&original_line, &violation);

            previews.push(FixPreview {
                original_line,
                suggested_line,
                line_number: violation.line_number,
                rule_name: violation.rule_name.clone(),
                description: violation.description.clone(),
                confidence,
            });
        }

        Ok(FixReport {
            file_path: path.as_ref().display().to_string(),
            previews,
            total_fixes: violations.len(),
            safe_fixes: safe_count,
            unsafe_fixes: unsafe_count,
        })
    }

    /// Applies safe fixes to a file based on rule violations
    pub fn apply_fixes<P: AsRef<Path>>(&self, path: P, violations: &[RuleViolation]) -> Result<String, String> {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let mut lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();

        // Sort violations by line number descending to avoid line shift issues if we remove lines
        let mut sorted_violations = violations.to_vec();
        sorted_violations.sort_by(|a, b| b.line_number.cmp(&a.line_number));

        for violation in sorted_violations {
            if self.is_safe_fix(&violation) {
                self.apply_single_fix(&mut lines, &violation)?;
            }
        }

        Ok(lines.join("\n"))
    }

    /// Applies only fixes that meet a minimum confidence threshold
    pub fn apply_fixes_with_confidence<P: AsRef<Path>>(
        &self,
        path: P,
        violations: &[RuleViolation],
        min_confidence: f64
    ) -> Result<String, String> {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let mut lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();

        let mut sorted_violations = violations.to_vec();
        sorted_violations.sort_by(|a, b| b.line_number.cmp(&a.line_number));

        for violation in sorted_violations {
            let is_safe = self.is_safe_fix(&violation);
            let confidence = self.calculate_fix_confidence(&violation, is_safe);
            
            if confidence >= min_confidence {
                self.apply_single_fix(&mut lines, &violation)?;
            }
        }

        Ok(lines.join("\n"))
    }

    /// Determines if a violation can be safely fixed automatically
    fn is_safe_fix(&self, violation: &RuleViolation) -> bool {
        matches!(
            violation.rule_name.as_str(), 
            "unused-state-variable" | "soroban-unused-state-variables" | "redundant-external"
        )
    }

    /// Calculates confidence score for a fix (0.0 to 1.0)
    fn calculate_fix_confidence(&self, violation: &RuleViolation, is_safe: bool) -> f64 {
        let mut confidence: f64 = if is_safe { 0.9 } else { 0.5 };

        // Adjust based on severity
        match violation.severity {
            gasguard_rule_engine::ViolationSeverity::Info => confidence += 0.05,
            gasguard_rule_engine::ViolationSeverity::Warning => confidence += 0.0,
            gasguard_rule_engine::ViolationSeverity::Medium => confidence -= 0.1,
            gasguard_rule_engine::ViolationSeverity::High => confidence -= 0.2,
            gasguard_rule_engine::ViolationSeverity::Error => confidence -= 0.3,
        }

        // Adjust based on suggestion quality
        if violation.suggestion.is_empty() || violation.suggestion.len() < 10 {
            confidence -= 0.15;
        }

        confidence.max(0.1).min(1.0)
    }

    /// Generates the suggested line for a fix
    fn generate_suggested_line(&self, original: &str, violation: &RuleViolation) -> String {
        match violation.rule_name.as_str() {
            "unused-state-variable" | "soroban-unused-state-variables" => {
                if original.trim().starts_with("//") {
                    original.to_string()
                } else {
                    format!("// [GasGuard Auto-Fix] {}", original)
                }
            }
            "redundant-external" => {
                original.replace("@external", "@internal")
            }
            _ => {
                // Use the suggestion from the violation if available
                if !violation.suggestion.is_empty() {
                    violation.suggestion.clone()
                } else {
                    format!("// TODO: {}", violation.description)
                }
            }
        }
    }

    fn apply_single_fix(&self, lines: &mut Vec<String>, violation: &RuleViolation) -> Result<(), String> {
        let line_idx = violation.line_number.saturating_sub(1);
        if line_idx >= lines.len() {
            return Err(format!("Line {} out of bounds", violation.line_number));
        }

        match violation.rule_name.as_str() {
            "unused-state-variable" | "soroban-unused-state-variables" => {
                // Comment out the line to be safe
                if !lines[line_idx].trim().starts_with("//") {
                    lines[line_idx] = format!("// [GasGuard Auto-Fix] {}", lines[line_idx]);
                }
            }
            "redundant-external" => {
                // Change @external to @internal in Vyper
                lines[line_idx] = lines[line_idx].replace("@external", "@internal");
            }
            _ => {}
        }

        Ok(())
    }

    /// Validates fixes using conflict detection and returns safe transformations only
    pub fn validate_and_filter_fixes(&self, violations: &[RuleViolation]) -> Vec<RuleViolation> {
        let mut safe_violations = Vec::new();
        let mut line_map: HashMap<usize, Vec<&RuleViolation>> = HashMap::new();

        // Group violations by line
        for violation in violations {
            line_map.entry(violation.line_number)
                .or_insert_with(Vec::new)
                .push(violation);
        }

        // Check for conflicts on each line
        for (line, line_violations) in &line_map {
            if line_violations.len() == 1 {
                // Single violation on line - safe if the fix itself is safe
                let violation = line_violations[0].clone();
                if self.is_safe_fix(&violation) {
                    safe_violations.push(violation.clone());
                }
            } else {
                // Multiple violations on same line - check for conflicts
                let mut has_conflicting_rules = false;
                let rule_names: Vec<&str> = line_violations.iter()
                    .map(|v| v.rule_name.as_str())
                    .collect();

                // Check for known conflicting rule combinations
                for (i, rule1) in rule_names.iter().enumerate() {
                    for rule2 in rule_names.iter().skip(i + 1) {
                        if self.rules_conflict(rule1, rule2) {
                            has_conflicting_rules = true;
                            break;
                        }
                    }
                    if has_conflicting_rules {
                        break;
                    }
                }

                if !has_conflicting_rules {
                    // No conflicts - include all safe fixes
                    for violation in line_violations {
                        if self.is_safe_fix(violation) {
                            safe_violations.push((*violation).clone());
                        }
                    }
                }
            }
        }

        safe_violations
    }

    /// Checks if two rules are known to conflict
    fn rules_conflict(&self, rule1: &str, rule2: &str) -> bool {
        // Known conflicting rule pairs
        let conflicts = [
            ("unused-state-variable", "redundant-external"),
            ("soroban-unused-state-variables", "redundant-external"),
        ];

        for (r1, r2) in &conflicts {
            if (rule1 == *r1 && rule2 == *r2) || (rule1 == *r2 && rule2 == *r1) {
                return true;
            }
        }

        false
    }

    /// Applies fixes with comprehensive safety checks
    pub fn apply_safe_fixes<P: AsRef<Path>>(&self, path: P, violations: &[RuleViolation]) -> Result<(String, FixReport), String> {
        // First, generate preview
        let preview_report = self.preview_fixes(&path, violations)?;
        
        // Filter to only safe fixes
        let safe_violations = self.validate_and_filter_fixes(violations);
        
        // Apply the safe fixes
        let result = self.apply_fixes(&path, &safe_violations)?;
        
        Ok((result, preview_report))
    }
}
