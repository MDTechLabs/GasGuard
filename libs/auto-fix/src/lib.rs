use gasguard_rule_engine::RuleViolation;
use std::fs;
use std::path::Path;

pub struct FixEngine;

impl FixEngine {
    pub fn new() -> Self {
        Self
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

    /// Determines if a violation can be safely fixed automatically
    fn is_safe_fix(&self, violation: &RuleViolation) -> bool {
        matches!(
            violation.rule_name.as_str(), 
            "unused-state-variable" | "soroban-unused-state-variables" | "redundant-external"
        )
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
}
