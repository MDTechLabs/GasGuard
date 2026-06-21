//! Schema and serialization format analyzer for upgrade compatibility
//!
//! This module provides analysis of struct definitions and their serialization
//! compatibility across contract upgrades.

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FieldDef {
    pub name: String,
    pub type_name: String,
    pub is_optional: bool,
    pub is_vector: bool,
    pub line_number: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StructSchema {
    pub struct_name: String,
    pub fields: Vec<FieldDef>,
    pub derives: Vec<String>,
    pub has_serde: bool,
    pub line_number: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SerializationIssue {
    pub issue_type: SerializationIssueType,
    pub struct_name: String,
    pub field_name: Option<String>,
    pub old_type: Option<String>,
    pub new_type: Option<String>,
    pub description: String,
    pub impact: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SerializationIssueType {
    /// A field was removed without proper versioning
    FieldRemoved,
    /// A field type changed incompatibly
    TypeChanged,
    /// A required field became optional
    FieldMadeOptional,
    /// An optional field became required
    FieldMadeRequired,
    /// Field order changed
    FieldReordered,
    /// A new required field was added
    NewRequiredField,
    /// Derive macros changed
    DeriveMacroChanged,
    /// Serde attributes changed
    SerdeAttributeChanged,
}

/// Analyzes Rust source code to extract struct schemas
pub struct SchemaAnalyzer;

impl SchemaAnalyzer {
    /// Extract all struct definitions from source code
    pub fn extract_schemas(source: &str) -> Vec<StructSchema> {
        let mut schemas = Vec::new();

        // Pattern to match struct definitions with derive macros
        let struct_pattern = Regex::new(
            r#"(?ms)(#\[derive\(([^)]*)\)]\s*)*(#\[.*?\]\s*)*pub\s+struct\s+(\w+)\s*\{([^}]*)\}"#,
        )
        .unwrap();

        for captures in struct_pattern.captures_iter(source) {
            let derives_str = captures.get(2).map(|m| m.as_str()).unwrap_or("");
            let struct_name = captures
                .get(4)
                .map(|m| m.as_str())
                .unwrap_or("")
                .to_string();
            let fields_str = captures.get(5).map(|m| m.as_str()).unwrap_or("");
            let full_match = captures.get(0).unwrap().as_str();

            let line_number = source[..captures.get(0).unwrap().start()].lines().count();

            let derives: Vec<String> = derives_str
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();

            let has_serde = derives
                .iter()
                .any(|d| d.contains("Serialize") || d.contains("Deserialize"))
                || full_match.contains("#[serde");

            let fields = Self::extract_fields(fields_str, line_number);

            schemas.push(StructSchema {
                struct_name,
                fields,
                derives,
                has_serde,
                line_number,
            });
        }

        schemas
    }

    /// Extract field definitions from a struct body
    fn extract_fields(fields_str: &str, base_line: usize) -> Vec<FieldDef> {
        let mut fields = Vec::new();
        let mut current_line = base_line;

        // Split by commas but respect nested angle brackets
        let mut current_field = String::new();
        let mut bracket_depth = 0;

        for ch in fields_str.chars() {
            match ch {
                '<' | '(' => {
                    bracket_depth += 1;
                    current_field.push(ch);
                }
                '>' | ')' => {
                    bracket_depth -= 1;
                    current_field.push(ch);
                }
                ',' if bracket_depth == 0 => {
                    if let Some(field) = Self::parse_field(&current_field, current_line) {
                        fields.push(field);
                        current_line += current_field.lines().count();
                    }
                    current_field.clear();
                }
                '\n' => {
                    current_field.push(ch);
                }
                _ => current_field.push(ch),
            }
        }

        // Don't forget the last field
        if !current_field.trim().is_empty() {
            if let Some(field) = Self::parse_field(&current_field, current_line) {
                fields.push(field);
            }
        }

        fields
    }

    /// Parse a single field definition
    fn parse_field(field_str: &str, line_number: usize) -> Option<FieldDef> {
        let trimmed = field_str.trim();
        if trimmed.is_empty() || trimmed.starts_with("//") {
            return None;
        }

        // Pattern: [pub] name: Type [= default]
        let field_pattern = Regex::new(r"pub\s+(\w+)\s*:\s*(.+?)(?:\s*=|$)").unwrap();

        if let Some(captures) = field_pattern.captures(trimmed) {
            let name = captures
                .get(1)
                .map(|m| m.as_str())
                .unwrap_or("")
                .to_string();
            let mut type_str = captures
                .get(2)
                .map(|m| m.as_str())
                .unwrap_or("")
                .trim()
                .to_string();

            // Check for Option<T> pattern
            let is_optional = type_str.starts_with("Option<");

            // Check for Vec<T> or similar vector patterns
            let is_vector = type_str.starts_with("Vec<") || type_str.contains("Vec<");

            // Clean up type string
            if type_str.ends_with(',') {
                type_str.pop();
            }

            return Some(FieldDef {
                name,
                type_name: type_str.trim().to_string(),
                is_optional,
                is_vector,
                line_number,
            });
        }

        None
    }

    /// Compare two schemas and detect compatibility issues
    pub fn detect_incompatibilities(
        old_schema: &StructSchema,
        new_schema: &StructSchema,
    ) -> Vec<SerializationIssue> {
        let mut issues = Vec::new();

        if old_schema.struct_name != new_schema.struct_name {
            return issues; // Different structs
        }

        let old_fields: HashMap<&str, &FieldDef> = old_schema
            .fields
            .iter()
            .map(|f| (f.name.as_str(), f))
            .collect();

        let new_fields: HashMap<&str, &FieldDef> = new_schema
            .fields
            .iter()
            .map(|f| (f.name.as_str(), f))
            .collect();

        // Check for removed fields
        for (name, old_field) in &old_fields {
            if !new_fields.contains_key(name) {
                // Only flag as critical if it's not optional
                if !old_field.is_optional {
                    issues.push(SerializationIssue {
                        issue_type: SerializationIssueType::FieldRemoved,
                        struct_name: old_schema.struct_name.clone(),
                        field_name: Some(name.to_string()),
                        old_type: Some(old_field.type_name.clone()),
                        new_type: None,
                        description: format!(
                            "Non-optional field '{}' was removed from struct '{}'",
                            name, old_schema.struct_name
                        ),
                        impact: "This will cause deserialization to fail for existing contract state. Data corruption risk.".to_string(),
                    });
                }
            }
        }

        // Check for new required fields
        for (name, new_field) in &new_fields {
            if !old_fields.contains_key(name) && !new_field.is_optional {
                issues.push(SerializationIssue {
                    issue_type: SerializationIssueType::NewRequiredField,
                    struct_name: new_schema.struct_name.clone(),
                    field_name: Some(name.to_string()),
                    old_type: None,
                    new_type: Some(new_field.type_name.clone()),
                    description: format!(
                        "New required field '{}' added to struct '{}'",
                        name, new_schema.struct_name
                    ),
                    impact:
                        "Existing contract instances cannot be upgraded without migration logic."
                            .to_string(),
                });
            }
        }

        // Check for type changes in existing fields
        for (name, old_field) in &old_fields {
            if let Some(new_field) = new_fields.get(name) {
                if Self::are_types_incompatible(&old_field.type_name, &new_field.type_name) {
                    issues.push(SerializationIssue {
                        issue_type: SerializationIssueType::TypeChanged,
                        struct_name: old_schema.struct_name.clone(),
                        field_name: Some(name.to_string()),
                        old_type: Some(old_field.type_name.clone()),
                        new_type: Some(new_field.type_name.clone()),
                        description: format!(
                            "Field '{}' type changed from '{}' to '{}'",
                            name, old_field.type_name, new_field.type_name
                        ),
                        impact:
                            "This will cause deserialization to fail or produce incorrect data."
                                .to_string(),
                    });
                }

                // Check optional/required changes
                if old_field.is_optional && !new_field.is_optional {
                    issues.push(SerializationIssue {
                        issue_type: SerializationIssueType::FieldMadeRequired,
                        struct_name: old_schema.struct_name.clone(),
                        field_name: Some(name.to_string()),
                        old_type: Some(old_field.type_name.clone()),
                        new_type: Some(new_field.type_name.clone()),
                        description: format!("Optional field '{}' became required", name),
                        impact: "Existing instances with missing field will fail to deserialize."
                            .to_string(),
                    });
                }
            }
        }

        // Check for derive macro changes
        if old_schema.derives != new_schema.derives {
            if old_schema.has_serde != new_schema.has_serde {
                issues.push(SerializationIssue {
                    issue_type: SerializationIssueType::DeriveMacroChanged,
                    struct_name: old_schema.struct_name.clone(),
                    field_name: None,
                    old_type: None,
                    new_type: None,
                    description: format!(
                        "Serde derive macros changed for struct '{}'",
                        old_schema.struct_name
                    ),
                    impact:
                        "Serialization format may be incompatible with existing persisted state."
                            .to_string(),
                });
            }
        }

        issues
    }

    /// Check if two types are incompatible for serialization
    fn are_types_incompatible(old_type: &str, new_type: &str) -> bool {
        // Exact match = compatible
        if old_type == new_type {
            return false;
        }

        // Extract base types (remove Option<> and Vec<>)
        let old_base = Self::extract_base_type(old_type);
        let new_base = Self::extract_base_type(new_type);

        // If base types differ, it's incompatible
        if old_base != new_base {
            return true;
        }

        // Check if one is wrapped and the other isn't
        let old_wrapped = old_type.contains("Option<") || old_type.contains("Vec<");
        let new_wrapped = new_type.contains("Option<") || new_type.contains("Vec<");

        if old_wrapped != new_wrapped {
            return true;
        }

        // Check wrapper type changes (Vec -> Option, etc.)
        let old_wrapper = Self::extract_wrapper_type(old_type);
        let new_wrapper = Self::extract_wrapper_type(new_type);

        old_wrapper != new_wrapper
    }

    /// Extract the base type (remove wrappers like Option<> and Vec<>)
    fn extract_base_type(type_str: &str) -> String {
        let re = Regex::new(r"(?:Option|Vec)<(.+?)>").unwrap();
        if let Some(caps) = re.captures(type_str) {
            caps.get(1)
                .map(|m| m.as_str())
                .unwrap_or(type_str)
                .to_string()
        } else {
            type_str.to_string()
        }
    }

    /// Extract the wrapper type (Option, Vec, etc.)
    fn extract_wrapper_type(type_str: &str) -> String {
        if type_str.starts_with("Option<") {
            "Option".to_string()
        } else if type_str.starts_with("Vec<") {
            "Vec".to_string()
        } else {
            String::new()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_schemas() {
        let source = r#"
        #[derive(Serialize, Deserialize)]
        pub struct User {
            pub id: u64,
            pub name: String,
            pub email: Option<String>,
        }
        "#;

        let schemas = SchemaAnalyzer::extract_schemas(source);
        assert_eq!(schemas.len(), 1);
        assert_eq!(schemas[0].struct_name, "User");
        assert_eq!(schemas[0].fields.len(), 3);
    }

    #[test]
    fn test_detect_field_removal() {
        let old = StructSchema {
            struct_name: "Config".to_string(),
            fields: vec![FieldDef {
                name: "value".to_string(),
                type_name: "u64".to_string(),
                is_optional: false,
                is_vector: false,
                line_number: 1,
            }],
            derives: vec!["Serialize".to_string(), "Deserialize".to_string()],
            has_serde: true,
            line_number: 1,
        };

        let new = StructSchema {
            struct_name: "Config".to_string(),
            fields: vec![],
            derives: vec!["Serialize".to_string(), "Deserialize".to_string()],
            has_serde: true,
            line_number: 1,
        };

        let issues = SchemaAnalyzer::detect_incompatibilities(&old, &new);
        assert!(!issues.is_empty());
        assert_eq!(issues[0].issue_type, SerializationIssueType::FieldRemoved);
    }
}
