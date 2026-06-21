use crate::soroban::{SorobanContract, SorobanRule};
use crate::{RuleViolation, ViolationSeverity};

pub struct UseCheckedArithmeticRule {
    enabled: bool,
}

impl Default for UseCheckedArithmeticRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for UseCheckedArithmeticRule {
    fn id(&self) -> &str {
        "use-checked-arithmetic"
    }

    fn name(&self) -> &str {
        "Use Checked Arithmetic"
    }

    fn description(&self) -> &str {
        "Detects unchecked arithmetic operations that could overflow"
    }

    fn severity(&self) -> ViolationSeverity {
        ViolationSeverity::High
    }

    fn is_enabled(&self) -> bool {
        self.enabled
    }

    fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }

    fn apply(&self, contract: &SorobanContract) -> Vec<RuleViolation> {
        let mut violations = Vec::new();

        for implementation in &contract.implementations {
            for function in &implementation.functions {
                let raw = &function.raw_definition;

                let uses_checked = raw.contains("checked_add")
                    || raw.contains("checked_sub")
                    || raw.contains("checked_mul")
                    || raw.contains("checked_div");

                if uses_checked {
                    continue;
                }

                for (offset, line) in raw.lines().enumerate() {
                    let t = line.trim();
                    if t.starts_with("//") || t.starts_with("for ") || t.starts_with("while ") {
                        continue;
                    }
                    for op in &[" + ", " - ", " * ", " / "] {
                        if t.contains(op) {
                            violations.push(RuleViolation {
                                rule_name: self.id().to_string(),
                                description: format!("Unchecked arithmetic '{}' in '{}'", op.trim(), function.name),
                                suggestion: format!("Use checked_{}() to prevent overflow/underflow", match op.trim() { "+" => "add", "-" => "sub", "*" => "mul", "/" => "div", _ => "add" }),
                                line_number: function.line_number + offset,
                                column_number: 0,
                                variable_name: function.name.clone(),
                                severity: self.severity(),
                            });
                        }
                    }
                }
            }
        }

        violations
    }
}
