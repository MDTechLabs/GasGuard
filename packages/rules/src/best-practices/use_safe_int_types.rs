use crate::soroban::{SorobanContract, SorobanRule};
use crate::{RuleViolation, ViolationSeverity};

pub struct UseSafeIntTypesRule {
    enabled: bool,
}

impl Default for UseSafeIntTypesRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for UseSafeIntTypesRule {
    fn id(&self) -> &str {
        "use-safe-int-types"
    }

    fn name(&self) -> &str {
        "Use Safe Integer Types"
    }

    fn description(&self) -> &str {
        "Detects use of i128/u128 where smaller integer types may suffice"
    }

    fn severity(&self) -> ViolationSeverity {
        ViolationSeverity::Medium
    }

    fn is_enabled(&self) -> bool {
        self.enabled
    }

    fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }

    fn apply(&self, contract: &SorobanContract) -> Vec<RuleViolation> {
        let mut violations = Vec::new();

        for contract_type in &contract.contract_types {
            for field in &contract_type.fields {
                let skip_names = ["amount", "balance", "total_supply"];
                if skip_names.contains(&field.name.as_str()) {
                    continue;
                }
                match field.type_name.as_str() {
                    "i128" => violations.push(self.make_violation(&field.name, &field.type_name, "i64", field.line_number)),
                    "u128" => violations.push(self.make_violation(&field.name, &field.type_name, "u64", field.line_number)),
                    _ => {}
                }
            }
        }

        for implementation in &contract.implementations {
            for function in &implementation.functions {
                let raw = &function.raw_definition;
                let line_offset = function.line_number;

                for (idx, line) in raw.lines().enumerate() {
                    self.check_param_or_return(line, idx + line_offset, &mut violations);
                }
            }
        }

        violations
    }
}

impl UseSafeIntTypesRule {
    fn make_violation(&self, name: &str, found: &str, suggested: &str, line: usize) -> RuleViolation {
        RuleViolation {
            rule_name: self.id().to_string(),
            description: format!("Use of {} for '{}' may be unnecessarily large", found, name),
            suggestion: format!("Consider using {} instead of {} for '{}'", suggested, found, name),
            line_number: line,
            column_number: 0,
            variable_name: name.to_string(),
            severity: self.severity(),
        }
    }

    fn check_param_or_return(&self, line: &str, line_number: usize, violations: &mut Vec<RuleViolation>) {
        let skip_names = ["amount", "balance", "total_supply"];

        let param_re = regex::Regex::new(r"(\w+)\s*:\s*(i128|u128)\b").unwrap();
        for cap in param_re.captures_iter(line) {
            let name = cap.get(1).unwrap().as_str();
            if !skip_names.contains(&name) {
                let found = cap.get(2).unwrap().as_str();
                let suggested = if found == "i128" { "i64" } else { "u64" };
                violations.push(self.make_violation(name, found, suggested, line_number));
            }
        }

        let return_re = regex::Regex::new(r"->\s*(i128|u128)\b").unwrap();
        for cap in return_re.captures_iter(line) {
            let found = cap.get(1).unwrap().as_str();
            let suggested = if found == "i128" { "i64" } else { "u64" };
            violations.push(self.make_violation("return type", found, suggested, line_number));
        }
    }
}
