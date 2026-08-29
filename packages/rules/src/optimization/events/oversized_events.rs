//! Oversized Event Emission Detection Rule
//!
//! Detects events with large payloads that increase transaction costs.
//! Event data is stored on-chain permanently, so oversized events waste gas
//! and increase storage costs.
//!
//! ## Size Estimation Rules
//! - Non-indexed parameters: ABI-encoded size
//! - Indexed parameters: 32 bytes each (keccak256 hash)
//! - Dynamic types (string, bytes): estimated 64 bytes + length prefix
//!
//! ## Severity Thresholds
//! - Critical: > 256 bytes
//! - High: > 192 bytes
//! - Medium: > 128 bytes (default threshold)
//! - Low: > 64 bytes

use crate::rule_engine::{Rule, RuleViolation, ViolationSeverity};
use quote::ToTokens;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use syn::{Attribute, Item, Stmt};

/// Default threshold in bytes for flagging oversized events
pub const DEFAULT_SIZE_THRESHOLD: usize = 128;

/// Represents a parameter in an event definition
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EventParameter {
    pub name: String,
    pub type_name: String,
    pub indexed: bool,
    pub estimated_size: usize,
}

/// Represents an event definition found in the code
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EventInfo {
    pub name: String,
    pub parameters: Vec<EventParameter>,
    pub total_size: usize,
    pub indexed_count: usize,
    pub line_number: usize,
}

/// Represents a compact alternative suggestion for an oversized event
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Suggestion {
    pub original: String,
    pub alternative: String,
    pub estimated_savings: usize,
    pub reason: String,
}

/// Represents an oversized event violation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OversizedEvent {
    pub event: EventInfo,
    pub severity: ViolationSeverity,
    pub suggestions: Vec<Suggestion>,
}

/// Estimates the size of a Solidity type in bytes for event encoding
pub fn estimate_type_size(type_name: &str) -> usize {
    let base_type = type_name.trim().to_lowercase();

    match base_type.as_str() {
        "bool" => 1,
        "address" => 20,
        "address payable" => 20,
        "bytes1" => 1,
        "bytes2" => 2,
        "bytes3" => 3,
        "bytes4" => 4,
        "bytes5" => 5,
        "bytes6" => 6,
        "bytes7" => 7,
        "bytes8" => 8,
        "bytes9" => 9,
        "bytes10" => 10,
        "bytes11" => 11,
        "bytes12" => 12,
        "bytes13" => 13,
        "bytes14" => 14,
        "bytes15" => 15,
        "bytes16" => 16,
        "bytes17" => 17,
        "bytes18" => 18,
        "bytes19" => 19,
        "bytes20" => 20,
        "bytes21" => 21,
        "bytes22" => 22,
        "bytes23" => 23,
        "bytes24" => 24,
        "bytes25" => 25,
        "bytes26" => 26,
        "bytes27" => 27,
        "bytes28" => 28,
        "bytes29" => 29,
        "bytes30" => 30,
        "bytes31" => 31,
        "bytes32" => 32,
        "uint8" | "int8" => 1,
        "uint16" | "int16" => 2,
        "uint32" | "int32" => 4,
        "uint64" | "int64" => 8,
        "uint128" | "int128" => 16,
        "uint256" | "int256" | "uint" | "int" => 32,
        "string" => 64,
        "bytes" => 64,
        _ => {
            if base_type.starts_with("uint") || base_type.starts_with("int") {
                if let Some(bits_str) = base_type
                    .strip_prefix("uint")
                    .or_else(|| base_type.strip_prefix("int"))
                {
                    if let Ok(bits) = bits_str.parse::<usize>() {
                        return (bits + 7) / 8;
                    }
                }
                32
            } else if base_type.starts_with("bytes") {
                if let Some(n_str) = base_type.strip_prefix("bytes") {
                    if let Ok(n) = n_str.parse::<usize>() {
                        return n.min(32);
                    }
                }
                32
            } else if base_type.ends_with("[]") || base_type.contains("mapping") {
                64
            } else {
                32
            }
        }
    }
}

/// Calculates the total estimated size of an event
pub fn estimate_event_size(parameters: &[EventParameter]) -> usize {
    let mut total = 0;
    for param in parameters {
        if param.indexed {
            total += 32;
        } else {
            total += estimate_type_size(&param.type_name);
        }
    }
    total
}

/// Determines severity based on event size
fn get_severity(size: usize) -> ViolationSeverity {
    match size {
        s if s > 256 => ViolationSeverity::Critical,
        s if s > 192 => ViolationSeverity::High,
        s if s > 128 => ViolationSeverity::Medium,
        _ => ViolationSeverity::Low,
    }
}

/// Generates compact alternative suggestions for oversized events
fn generate_suggestions(event: &EventInfo) -> Vec<Suggestion> {
    let mut suggestions = Vec::new();

    for param in &event.parameters {
        let base_type = param.type_name.to_lowercase();

        if base_type == "string" && !param.indexed {
            suggestions.push(Suggestion {
                original: format!("string {}", param.name),
                alternative: format!("bytes32 {}", param.name),
                estimated_savings: 32,
                reason: format!(
                    "Replace string '{}' with bytes32 hash (keccak256) to save ~32 bytes",
                    param.name
                ),
            });
        }

        if base_type == "bytes" && !param.indexed {
            suggestions.push(Suggestion {
                original: format!("bytes {}", param.name),
                alternative: format!("bytes32 {}", param.name),
                estimated_savings: 32,
                reason: format!(
                    "Replace dynamic bytes '{}' with fixed bytes32 to save ~32 bytes",
                    param.name
                ),
            });
        }

        if param.indexed && base_type != "address" && base_type != "bytes32" {
            suggestions.push(Suggestion {
                original: format!("indexed {} {}", param.type_name, param.name),
                alternative: format!("{} {}", param.type_name, param.name),
                estimated_savings: 32,
                reason: format!(
                    "Remove 'indexed' from '{}' - indexed parameters cost 32 bytes each. \
                     Only index fields needed for filtering.",
                    param.name
                ),
            });
        }

        if base_type.contains("[]") {
            suggestions.push(Suggestion {
                original: format!("{} {}", param.type_name, param.name),
                alternative: format!("bytes32 {}_hash", param.name),
                estimated_savings: 32,
                reason: format!(
                    "Replace array '{}' with bytes32 hash of contents to save significant bytes",
                    param.name
                ),
            });
        }
    }

    if event.parameters.len() > 4 {
        suggestions.push(Suggestion {
            original: format!(
                "Event '{}' with {} parameters",
                event.name,
                event.parameters.len()
            ),
            alternative: format!("Split '{}' into multiple focused events", event.name),
            estimated_savings: event.total_size / 3,
            reason: format!(
                "Consider splitting event '{}' into 2-3 smaller events. \
                 Large events with many parameters are costly and harder to index.",
                event.name
            ),
        });
    }

    suggestions
}

/// The main rule for detecting oversized event emissions
pub struct OversizedEventsRule {
    pub size_threshold: usize,
}

impl Default for OversizedEventsRule {
    fn default() -> Self {
        Self {
            size_threshold: DEFAULT_SIZE_THRESHOLD,
        }
    }
}

impl OversizedEventsRule {
    /// Creates a new rule with a custom size threshold
    pub fn with_threshold(threshold: usize) -> Self {
        Self {
            size_threshold: threshold,
        }
    }

    /// Parses an event definition from an attribute
    fn parse_event_from_attr(&self, attr: &Attribute, item_name: &str) -> Option<EventInfo> {
        let attr_name = attr.path().to_token_stream().to_string();
        if attr_name != "event" {
            return None;
        }

        let tokens = match &attr.meta {
            syn::Meta::List(list) => list.tokens.to_string(),
            _ => return None,
        };
        let params = self.parse_event_params(&tokens);
        if params.is_empty() {
            return None;
        }

        let total_size = estimate_event_size(&params);
        let indexed_count = params.iter().filter(|p| p.indexed).count();

        Some(EventInfo {
            name: item_name.to_string(),
            parameters: params,
            total_size,
            indexed_count,
            line_number: 0,
        })
    }

    /// Parses event parameters from attribute tokens
    fn parse_event_params(&self, tokens: &str) -> Vec<EventParameter> {
        let mut params = Vec::new();

        let clean = tokens.trim().trim_start_matches('(').trim_end_matches(')');

        if clean.is_empty() {
            return params;
        }

        let mut depth = 0;
        let mut current = String::new();
        let mut parts = Vec::new();

        for ch in clean.chars() {
            match ch {
                '(' | '<' => {
                    depth += 1;
                    current.push(ch);
                }
                ')' | '>' => {
                    depth -= 1;
                    current.push(ch);
                }
                ',' if depth == 0 => {
                    parts.push(current.clone());
                    current.clear();
                }
                _ => current.push(ch),
            }
        }
        if !current.is_empty() {
            parts.push(current);
        }

        for part in parts {
            let part = part.trim();
            if part.is_empty() {
                continue;
            }

            let mut indexed = false;
            let mut type_name = String::new();
            let mut name = String::new();

            let tokens: Vec<&str> = part.split_whitespace().collect();
            let mut i = 0;

            if i < tokens.len() && tokens[i] == "indexed" {
                indexed = true;
                i += 1;
            }

            if i < tokens.len() {
                type_name = tokens[i].to_string();
                i += 1;
            }

            if i < tokens.len() {
                name = tokens[i].trim_end_matches(',').to_string();
            }

            if !type_name.is_empty() && !name.is_empty() {
                let est_size = if indexed {
                    32
                } else {
                    estimate_type_size(&type_name)
                };

                params.push(EventParameter {
                    name,
                    type_name,
                    indexed,
                    estimated_size: est_size,
                });
            }
        }

        params
    }

    /// Checks a list of statements for emit calls with oversized data
    fn check_emit_statements(&self, stmts: &[Stmt], violations: &mut Vec<RuleViolation>) {
        for stmt in stmts {
            if let Some((event_name, args)) = self.extract_emit_call(stmt) {
                let estimated_size = self.estimate_emit_args_size(&args);
                if estimated_size > self.size_threshold {
                    let severity = get_severity(estimated_size);
                    violations.push(RuleViolation {
                        rule_name: self.name().to_string(),
                        description: format!(
                            "Event '{}' emission estimated at {} bytes (threshold: {} bytes). \
                             Large events increase transaction costs and storage usage.",
                            event_name, estimated_size, self.size_threshold
                        ),
                        severity,
                        line_number: 0,
                        column_number: 0,
                        variable_name: event_name.clone(),
                        suggestion: format!(
                            "Consider reducing the payload size of event '{}' by: \
                             using bytes32 hashes for strings/arrays, removing unnecessary indexed parameters, \
                             or splitting into multiple smaller events.",
                            event_name
                        ),
                    });
                }
            }
        }
    }

    /// Extracts event name and arguments from an emit statement
    fn extract_emit_call(&self, stmt: &Stmt) -> Option<(String, Vec<String>)> {
        let expr = match stmt {
            Stmt::Expr(e, _) => e,
            _ => return None,
        };

        if let syn::Expr::Macro(mac) = expr {
            let name = mac.mac.path.to_token_stream().to_string();
            if name == "emit" || name == "emit!" {
                let tokens = mac.mac.tokens.to_string();
                if let Some((event_name, args)) = self.parse_emit_tokens(&tokens) {
                    return Some((event_name, args));
                }
            }
        }

        None
    }

    /// Parses emit macro tokens into event name and arguments
    fn parse_emit_tokens(&self, tokens: &str) -> Option<(String, Vec<String>)> {
        let clean = tokens.trim();
        if let Some(paren_start) = clean.find('(') {
            let event_name = clean[..paren_start].trim().to_string();
            let args_str = clean[paren_start..].to_string();
            let args = self.split_args(&args_str);
            Some((event_name, args))
        } else {
            None
        }
    }

    /// Splits argument string respecting nested parentheses and brackets
    fn split_args(&self, s: &str) -> Vec<String> {
        let mut args = Vec::new();
        let mut current = String::new();
        let mut depth = 0;

        for ch in s.chars() {
            match ch {
                '(' | '[' | '<' => {
                    depth += 1;
                    current.push(ch);
                }
                ')' | ']' | '>' => {
                    depth -= 1;
                    current.push(ch);
                }
                ',' if depth == 0 => {
                    if !current.trim().is_empty() {
                        args.push(current.trim().to_string());
                    }
                    current.clear();
                }
                _ => current.push(ch),
            }
        }
        if !current.trim().is_empty() {
            args.push(current.trim().to_string());
        }

        args
    }

    /// Estimates the size of emit arguments
    fn estimate_emit_args_size(&self, args: &[String]) -> usize {
        let mut total = 0;
        for arg in args {
            let arg = arg.trim();
            if arg.starts_with('"') || arg.starts_with("String::") {
                total += 64;
            } else if arg.starts_with("b\"") || arg.starts_with("Bytes::") {
                total += 64;
            } else if arg.starts_with('[') || arg.contains("vec!") {
                total += 64;
            } else if arg.starts_with("Address::") || arg.contains("address") {
                total += 20;
            } else {
                total += 32;
            }
        }
        total
    }
}

impl Rule for OversizedEventsRule {
    fn name(&self) -> &str {
        "oversized-events"
    }

    fn description(&self) -> &str {
        "Detects events with large payloads that increase transaction costs. \
         Event data is stored on-chain permanently, so oversized events waste gas. \
         Suggests compact alternatives like using bytes32 hashes or removing indexed parameters."
    }

    fn check(&self, ast: &[Item]) -> Vec<RuleViolation> {
        let mut violations = Vec::new();
        let mut event_defs: HashMap<String, EventInfo> = HashMap::new();

        for item in ast {
            match item {
                Item::Struct(s) => {
                    for attr in &s.attrs {
                        if let Some(event_info) =
                            self.parse_event_from_attr(attr, &s.ident.to_string())
                        {
                            event_defs.insert(event_info.name.clone(), event_info);
                        }
                    }
                }
                Item::Fn(func) => {
                    self.check_emit_statements(&func.block.stmts, &mut violations);
                }
                Item::Impl(impl_block) => {
                    for impl_item in &impl_block.items {
                        if let syn::ImplItem::Fn(method) = impl_item {
                            self.check_emit_statements(&method.block.stmts, &mut violations);
                        }
                    }
                }
                _ => {}
            }
        }

        for (_, event) in event_defs {
            if event.total_size > self.size_threshold {
                let severity = get_severity(event.total_size);
                let suggestions = generate_suggestions(&event);

                let suggestion_text = if suggestions.is_empty() {
                    format!(
                        "Consider reducing the payload size of event '{}' by using \
                         compact types or splitting into smaller events.",
                        event.name
                    )
                } else {
                    let top = &suggestions[0];
                    format!(
                        "Suggestion: {} (saves ~{} bytes)",
                        top.reason, top.estimated_savings
                    )
                };

                violations.push(RuleViolation {
                    rule_name: self.name().to_string(),
                    description: format!(
                        "Event '{}' has estimated payload size of {} bytes (threshold: {} bytes). \
                         Large events increase transaction costs and storage usage.",
                        event.name, event.total_size, self.size_threshold
                    ),
                    severity,
                    line_number: event.line_number,
                    column_number: 0,
                    variable_name: event.name.clone(),
                    suggestion: suggestion_text,
                });
            }
        }

        violations
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use syn::parse_file;

    fn check(code: &str) -> Vec<RuleViolation> {
        let ast = parse_file(code).expect("parse failed");
        let rule = OversizedEventsRule::default();
        rule.check(&ast.items)
    }

    fn check_with_threshold(code: &str, threshold: usize) -> Vec<RuleViolation> {
        let ast = parse_file(code).expect("parse failed");
        let rule = OversizedEventsRule::with_threshold(threshold);
        rule.check(&ast.items)
    }

    #[test]
    fn test_estimate_type_size() {
        assert_eq!(estimate_type_size("bool"), 1);
        assert_eq!(estimate_type_size("address"), 20);
        assert_eq!(estimate_type_size("uint8"), 1);
        assert_eq!(estimate_type_size("uint256"), 32);
        assert_eq!(estimate_type_size("bytes32"), 32);
        assert_eq!(estimate_type_size("string"), 64);
        assert_eq!(estimate_type_size("bytes"), 64);
    }

    #[test]
    fn test_estimate_event_size() {
        let params = vec![
            EventParameter {
                name: "from".to_string(),
                type_name: "address".to_string(),
                indexed: true,
                estimated_size: 32,
            },
            EventParameter {
                name: "to".to_string(),
                type_name: "address".to_string(),
                indexed: true,
                estimated_size: 32,
            },
            EventParameter {
                name: "value".to_string(),
                type_name: "uint256".to_string(),
                indexed: false,
                estimated_size: 32,
            },
        ];
        assert_eq!(estimate_event_size(&params), 96);
    }

    #[test]
    fn test_estimate_event_size_with_string() {
        let params = vec![
            EventParameter {
                name: "user".to_string(),
                type_name: "address".to_string(),
                indexed: false,
                estimated_size: 20,
            },
            EventParameter {
                name: "data".to_string(),
                type_name: "string".to_string(),
                indexed: false,
                estimated_size: 64,
            },
        ];
        assert_eq!(estimate_event_size(&params), 84);
    }

    #[test]
    fn flags_oversized_event_definition() {
        let code = r#"
            #[event(indexed address from, indexed address to, string memo, bytes data, uint256 amount)]
            struct TransferWithMemo {}
        "#;
        let violations = check(code);
        assert!(!violations.is_empty());
        assert!(violations[0].description.contains("bytes"));
    }

    #[test]
    fn no_violation_for_small_events() {
        let code = r#"
            #[event(indexed address from, uint256 amount)]
            struct SimpleTransfer {}
        "#;
        let violations = check(code);
        assert!(violations.is_empty());
    }

    #[test]
    fn flags_oversized_emit_call() {
        let code = r#"
            fn transfer() {
                emit!(TransferWithMemo(
                    sender,
                    recipient,
                    String::from("This is a very long memo string that increases event size significantly"),
                    Bytes::from(large_data),
                    amount
                ));
            }
        "#;
        let violations = check_with_threshold(code, 64);
        assert!(!violations.is_empty());
    }

    #[test]
    fn generates_suggestions_for_string_params() {
        let code = r#"
            #[event(indexed address user, string description, bytes payload, uint256 value)]
            struct LargeEvent {}
        "#;
        let violations = check(code);
        assert!(!violations.is_empty());

        let event = EventInfo {
            name: "LargeEvent".to_string(),
            parameters: vec![
                EventParameter {
                    name: "user".to_string(),
                    type_name: "address".to_string(),
                    indexed: true,
                    estimated_size: 32,
                },
                EventParameter {
                    name: "description".to_string(),
                    type_name: "string".to_string(),
                    indexed: false,
                    estimated_size: 64,
                },
                EventParameter {
                    name: "payload".to_string(),
                    type_name: "bytes".to_string(),
                    indexed: false,
                    estimated_size: 64,
                },
                EventParameter {
                    name: "value".to_string(),
                    type_name: "uint256".to_string(),
                    indexed: false,
                    estimated_size: 32,
                },
            ],
            total_size: 192,
            indexed_count: 1,
            line_number: 0,
        };
        let suggestions = generate_suggestions(&event);
        assert!(!suggestions.is_empty());
        assert!(suggestions
            .iter()
            .any(|s| s.alternative.contains("bytes32")));
    }

    #[test]
    fn suggests_removing_unnecessary_indexed() {
        let event = EventInfo {
            name: "TestEvent".to_string(),
            parameters: vec![
                EventParameter {
                    name: "user".to_string(),
                    type_name: "uint256".to_string(),
                    indexed: true,
                    estimated_size: 32,
                },
                EventParameter {
                    name: "amount".to_string(),
                    type_name: "uint256".to_string(),
                    indexed: true,
                    estimated_size: 32,
                },
            ],
            total_size: 64,
            indexed_count: 2,
            line_number: 0,
        };
        let suggestions = generate_suggestions(&event);
        assert!(suggestions.iter().any(|s| s.reason.contains("indexed")));
    }

    #[test]
    fn suggests_splitting_large_events() {
        let event = EventInfo {
            name: "MassiveEvent".to_string(),
            parameters: vec![
                EventParameter {
                    name: "a".to_string(),
                    type_name: "uint256".to_string(),
                    indexed: false,
                    estimated_size: 32,
                },
                EventParameter {
                    name: "b".to_string(),
                    type_name: "uint256".to_string(),
                    indexed: false,
                    estimated_size: 32,
                },
                EventParameter {
                    name: "c".to_string(),
                    type_name: "uint256".to_string(),
                    indexed: false,
                    estimated_size: 32,
                },
                EventParameter {
                    name: "d".to_string(),
                    type_name: "uint256".to_string(),
                    indexed: false,
                    estimated_size: 32,
                },
                EventParameter {
                    name: "e".to_string(),
                    type_name: "uint256".to_string(),
                    indexed: false,
                    estimated_size: 32,
                },
            ],
            total_size: 160,
            indexed_count: 0,
            line_number: 0,
        };
        let suggestions = generate_suggestions(&event);
        assert!(suggestions.iter().any(|s| s.reason.contains("split")));
    }

    #[test]
    fn severity_scaling() {
        assert!(matches!(get_severity(50), ViolationSeverity::Low));
        assert!(matches!(get_severity(130), ViolationSeverity::Medium));
        assert!(matches!(get_severity(200), ViolationSeverity::High));
        assert!(matches!(get_severity(300), ViolationSeverity::Critical));
    }

    #[test]
    fn custom_threshold() {
        let code = r#"
            #[event(indexed address from, uint256 amount)]
            struct SimpleTransfer {}
        "#;
        let violations_default = check(code);
        assert!(violations_default.is_empty());

        let violations_custom = check_with_threshold(code, 10);
        assert!(!violations_custom.is_empty());
    }
}
