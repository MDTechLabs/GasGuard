//! Stellar Contract Upgradeability Analysis
//!
//! This module provides rules and analysis for detecting unsafe patterns during
//! contract upgrades, particularly serialization incompatibilities that could
//! corrupt contract state.

pub mod schema_analyzer;
pub mod serialization_rules;

#[cfg(test)]
pub mod tests;

pub use schema_analyzer::{
    FieldDef, SchemaAnalyzer, SerializationIssue, SerializationIssueType, StructSchema,
};
pub use serialization_rules::{
    SerializationUpgradeCompatibilityRule, UnsafeSerializationPatternRule,
};

/// Trait for upgrade compatibility checking
pub trait UpgradeCompatibilityChecker {
    /// Check if an upgrade from old code to new code is safe
    fn is_upgrade_safe(&self, old_code: &str, new_code: &str) -> bool;

    /// Get detailed incompatibilities
    fn get_incompatibilities(&self, old_code: &str, new_code: &str) -> Vec<SerializationIssue>;
}

/// Default implementation of upgrade compatibility checker
pub struct DefaultUpgradeChecker;

impl UpgradeCompatibilityChecker for DefaultUpgradeChecker {
    fn is_upgrade_safe(&self, old_code: &str, new_code: &str) -> bool {
        let incompatibilities = self.get_incompatibilities(old_code, new_code);

        // An upgrade is safe if there are no critical or high-severity incompatibilities
        incompatibilities.is_empty()
    }

    fn get_incompatibilities(&self, old_code: &str, new_code: &str) -> Vec<SerializationIssue> {
        let old_schemas = SchemaAnalyzer::extract_schemas(old_code);
        let new_schemas = SchemaAnalyzer::extract_schemas(new_code);

        let new_schema_map: std::collections::HashMap<&str, _> = new_schemas
            .iter()
            .map(|s| (s.struct_name.as_str(), s))
            .collect();

        let mut all_issues = Vec::new();

        for old_schema in old_schemas {
            if let Some(new_schema) = new_schema_map.get(old_schema.struct_name.as_str()) {
                let issues = SchemaAnalyzer::detect_incompatibilities(&old_schema, new_schema);
                all_issues.extend(issues);
            }
        }

        all_issues
    }
}
