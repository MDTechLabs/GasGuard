//! Serialization upgrade compatibility rules
//!
//! Rules that detect unsafe serialization changes during contract upgrades

use crate::{RuleViolation, ViolationSeverity};
use super::schema_analyzer::{SchemaAnalyzer, SerializationIssue, SerializationIssueType};

/// Rule to detect incompatible serialization changes during upgrades
pub struct SerializationUpgradeCompatibilityRule {
    old_code: String,
}

impl SerializationUpgradeCompatibilityRule {
    pub fn new(old_code: String) -> Self {
        Self { old_code }
    }

    pub fn check_upgrade(&self, new_code: &str, file_path: &str) -> Vec<RuleViolation> {
        let mut violations = Vec::new();

        // Extract schemas from both old and new code
        let old_schemas = SchemaAnalyzer::extract_schemas(&self.old_code);
        let new_schemas = SchemaAnalyzer::extract_schemas(new_code);

        // Create a map of schemas for easier lookup
        let new_schema_map: std::collections::HashMap<&str, _> =
            new_schemas.iter().map(|s| (s.struct_name.as_str(), s)).collect();

        // Check each old schema for compatibility with new version
        for old_schema in old_schemas {
            if let Some(new_schema) = new_schema_map.get(old_schema.struct_name.as_str()) {
                let issues = SchemaAnalyzer::detect_incompatibilities(old_schema, new_schema);

                for issue in issues {
                    let violation = self.issue_to_violation(&issue, file_path);
                    violations.push(violation);
                }
            }
        }

        violations
    }

    fn issue_to_violation(&self, issue: &SerializationIssue, file_path: &str) -> RuleViolation {
        let (severity, recommendation) = self.get_severity_and_recommendation(issue);

        let variable_name = issue
            .field_name
            .clone()
            .unwrap_or_else(|| issue.struct_name.clone());

        RuleViolation {
            rule_name: "soroban-serialization-compatibility".to_string(),
            description: issue.description.clone(),
            severity,
            line_number: 1, // Could be improved with actual line tracking
            column_number: 0,
            variable_name,
            suggestion: recommendation,
        }
    }

    fn get_severity_and_recommendation(
        &self,
        issue: &SerializationIssue,
    ) -> (ViolationSeverity, String) {
        match issue.issue_type {
            SerializationIssueType::FieldRemoved => (
                ViolationSeverity::Critical,
                format!(
                    "Cannot remove required field '{}'. Use #[serde(skip_serializing_if = \"Option::is_none\", default)] to make it optional first.",
                    issue.field_name.as_ref().unwrap_or(&"field".to_string())
                ),
            ),
            SerializationIssueType::TypeChanged => (
                ViolationSeverity::Critical,
                format!(
                    "Field '{}' type changed from '{}' to '{}'. Implement custom deserialization or use version markers for safe upgrades.",
                    issue.field_name.as_ref().unwrap_or(&"field".to_string()),
                    issue.old_type.as_ref().unwrap_or(&"unknown".to_string()),
                    issue.new_type.as_ref().unwrap_or(&"unknown".to_string())
                ),
            ),
            SerializationIssueType::FieldMadeRequired => (
                ViolationSeverity::High,
                format!(
                    "Field '{}' changed from Optional to Required. Add default value or handle migration for existing instances.",
                    issue.field_name.as_ref().unwrap_or(&"field".to_string())
                ),
            ),
            SerializationIssueType::NewRequiredField => (
                ViolationSeverity::High,
                format!(
                    "New required field '{}' added. Provide default value, use Option<T>, or implement contract state migration.",
                    issue.field_name.as_ref().unwrap_or(&"field".to_string())
                ),
            ),
            SerializationIssueType::FieldMadeOptional => (
                ViolationSeverity::Low,
                "Field made optional - safe to upgrade. Existing data will be preserved.".to_string(),
            ),
            SerializationIssueType::FieldReordered => (
                ViolationSeverity::Medium,
                "Field order changed. This may affect binary serialization. Use serde(rename) if needed.".to_string(),
            ),
            SerializationIssueType::DeriveMacroChanged => (
                ViolationSeverity::High,
                "Serde derive macros changed. Verify serialization format compatibility with existing persisted state.".to_string(),
            ),
            SerializationIssueType::SerdeAttributeChanged => (
                ViolationSeverity::Medium,
                "Serde attributes changed. Verify compatibility with existing serialized data.".to_string(),
            ),
        }
    }
}

/// Simplified rule to detect unsafe serialization patterns
pub struct UnsafeSerializationPatternRule;

impl UnsafeSerializationPatternRule {
    /// Check for dangerous serialization patterns in source code
    pub fn check(source: &str, file_path: &str) -> Vec<RuleViolation> {
        let mut violations = Vec::new();

        // Check for removing derive macros without migration path
        if Self::has_removed_serde_derive(source) {
            violations.push(RuleViolation {
                rule_name: "unsafe-serde-removal".to_string(),
                description: "Serde derive macros were removed from a persisted struct".to_string(),
                severity: ViolationSeverity::Critical,
                line_number: 1,
                column_number: 0,
                variable_name: file_path.to_string(),
                suggestion: "Keep Serde derives on any struct that persists state. Use version markers or custom de/serialization for upgrades.".to_string(),
            });
        }

        // Check for manual field removal without comment
        if Self::has_uncommented_field_removal(source) {
            violations.push(RuleViolation {
                rule_name: "uncommented-field-removal".to_string(),
                description: "Field appears to have been removed without documentation".to_string(),
                severity: ViolationSeverity::High,
                line_number: 1,
                column_number: 0,
                variable_name: file_path.to_string(),
                suggestion: "Document why fields are being removed. Consider keeping them as deprecated/unused or using serde attributes for compatibility.".to_string(),
            });
        }

        // Check for missing migration functions when upgrading
        if Self::has_struct_modifications(source) && !Self::has_migration_function(source) {
            violations.push(RuleViolation {
                rule_name: "missing-upgrade-migration".to_string(),
                description: "Serialized struct modified but no migration function found".to_string(),
                severity: ViolationSeverity::Medium,
                line_number: 1,
                column_number: 0,
                variable_name: file_path.to_string(),
                suggestion: "Add a migration function to safely upgrade contract state between versions.".to_string(),
            });
        }

        violations
    }

    fn has_removed_serde_derive(source: &str) -> bool {
        // This is a heuristic - in practice, would need to compare old and new code
        let has_struct = source.contains("pub struct") && source.contains("Serialize") == false;
        has_struct && source.contains("#[contracttype]")
    }

    fn has_uncommented_field_removal(source: &str) -> bool {
        // Look for commented out fields without nearby explanation
        let lines: Vec<&str> = source.lines().collect();
        for i in 0..lines.len() {
            let line = lines[i];
            if line.trim().starts_with("//") && line.contains("pub ") {
                // Check if there's a doc comment nearby explaining the change
                let has_explanation = if i > 0 {
                    lines[i - 1].contains("DEPRECATED") || lines[i - 1].contains("deprecated")
                        || lines[i - 1].contains("removed") || lines[i - 1].contains("migration")
                } else {
                    false
                };

                if !has_explanation {
                    return true;
                }
            }
        }
        false
    }

    fn has_struct_modifications(source: &str) -> bool {
        let version_mentions = source.matches("version").count();
        let struct_mentions = source.matches("pub struct").count();
        version_mentions < struct_mentions / 2 // Rough heuristic
    }

    fn has_migration_function(source: &str) -> bool {
        source.contains("migrate")
            || source.contains("upgrade")
            || source.contains("from_old")
            || source.contains("migration")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_serialization_compatibility_check() {
        let old_code = r#"
        #[derive(Serialize, Deserialize)]
        pub struct State {
            pub balance: u64,
        }
        "#;

        let new_code = r#"
        #[derive(Serialize, Deserialize)]
        pub struct State {
            pub balance: u64,
            pub owner: String,
        }
        "#;

        let rule = SerializationUpgradeCompatibilityRule::new(old_code.to_string());
        let violations = rule.check_upgrade(new_code, "contract.rs");

        assert!(!violations.is_empty());
        assert!(violations[0]
            .description
            .contains("New required field"));
    }

    #[test]
    fn test_unsafe_serde_removal() {
        let source = r#"
        pub struct State {
            pub balance: u64,
        }
        "#;

        let violations = UnsafeSerializationPatternRule::check(source, "contract.rs");
        assert!(!violations.is_empty());
    }
}
