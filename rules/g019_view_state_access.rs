//! Rule G019: Flag Redundant View Function State Access Patterns in Solidity.

pub struct RuleG019ViewStateAccess;

impl RuleG019ViewStateAccess {
    pub fn name() -> &'static str {
        "G019_view_state_access"
    }

    pub fn check(source_code: &str) -> Vec<String> {
        let mut warnings = Vec::new();
        if source_code.contains("view") || source_code.contains("pure") {
            if source_code.contains("sload") || source_code.contains("storage") {
                warnings.push("Warning: Redundant state variable access in view function".to_string());
            }
        }
        warnings
    }
}
