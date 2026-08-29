//! Closes #651: Rule G006 - suggest `payable` on admin-only functions.
//! Starter regex-based implementation; full bytecode-check verification is a follow-up.

pub struct PayableAdminFinding {
    pub function_name: String,
}

const ADMIN_MODIFIERS: [&str; 2] = ["onlyOwner", "onlyAdmin"];

/// Scans a function signature line for an admin modifier that lacks `payable`.
pub fn detect_missing_payable(function_signature: &str, function_name: &str) -> Option<PayableAdminFinding> {
    let has_admin_modifier = ADMIN_MODIFIERS.iter().any(|m| function_signature.contains(m));
    let has_payable = function_signature.contains("payable");
    if has_admin_modifier && !has_payable {
        return Some(PayableAdminFinding { function_name: function_name.to_string() });
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flags_admin_function_without_payable() {
        let sig = "function withdraw() external onlyOwner {";
        assert!(detect_missing_payable(sig, "withdraw").is_some());
    }

    #[test]
    fn ignores_already_payable_function() {
        let sig = "function withdraw() external payable onlyOwner {";
        assert!(detect_missing_payable(sig, "withdraw").is_none());
    }

    #[test]
    fn ignores_non_admin_function() {
        let sig = "function deposit() external {";
        assert!(detect_missing_payable(sig, "deposit").is_none());
    }
}
