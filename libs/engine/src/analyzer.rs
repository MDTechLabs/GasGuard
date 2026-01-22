use colored::*;
use gasguard_rules::{RuleViolation, ViolationSeverity};
use std::fmt;

pub struct ScanAnalyzer;

impl ScanAnalyzer {
    pub fn format_violations(violations: &[RuleViolation]) -> String {
        if violations.is_empty() {
            return "✅ No violations found! Your contract is optimized."
                .green()
                .to_string();
        }

        let mut output = String::new();
        let (errors, warnings, info) = Self::categorize_violations(violations);

        if !errors.is_empty() {
            output.push_str(&format!("🚨 {} Errors:\n", errors.len()).red().bold());
            for violation in errors {
                output.push_str(&Self::format_single_violation(violation, "ERROR"));
            }
            output.push('\n');
        }

        if !warnings.is_empty() {
            output.push_str(
                &format!("⚠️  {} Warnings:\n", warnings.len())
                    .yellow()
                    .bold(),
            );
            for violation in warnings {
                output.push_str(&Self::format_single_violation(violation, "WARNING"));
            }
            output.push('\n');
        }

        if !info.is_empty() {
            output.push_str(&format!("ℹ️  {} Info:\n", info.len()).blue().bold());
            for violation in info {
                output.push_str(&Self::format_single_violation(violation, "INFO"));
            }
        }

        output
    }

    pub fn generate_summary(violations: &[RuleViolation]) -> String {
        let total = violations.len();
        let (errors, warnings, info) = Self::categorize_violations(violations);

        format!(
            "Scan Summary: {} total violations ({} errors, {} warnings, {} info)",
            total,
            errors.len(),
            warnings.len(),
            info.len()
        )
    }

    pub fn calculate_storage_savings(violations: &[RuleViolation]) -> StorageSavings {
        let mut unused_vars = 0;
        let mut estimated_savings_kb = 0.0;

        for violation in violations {
            if violation.rule_name == "unused-state-variables" {
                unused_vars += 1;
                // Estimate average storage cost per unused variable
                // This is a rough estimate - actual costs vary by type
                estimated_savings_kb += 2.5; // Average variable size in KB
            }
        }

        StorageSavings {
            unused_variables: unused_vars,
            estimated_savings_kb,
            monthly_ledger_rent_savings: estimated_savings_kb * 0.001, // Rough estimate
        }
    }

    fn categorize_violations(
        violations: &[RuleViolation],
    ) -> (
        Vec<&RuleViolation>,
        Vec<&RuleViolation>,
        Vec<&RuleViolation>,
    ) {
        let mut errors = Vec::new();
        let mut warnings = Vec::new();
        let mut info = Vec::new();

        for violation in violations {
            match violation.severity {
                ViolationSeverity::Error => errors.push(violation),
                ViolationSeverity::Warning => warnings.push(violation),
                ViolationSeverity::Info => info.push(violation),
            }
        }

        (errors, warnings, info)
    }

    fn format_single_violation(violation: &RuleViolation, severity: &str) -> String {
        let severity_color = match severity {
            "ERROR" => colored::Color::Red,
            "WARNING" => colored::Color::Yellow,
            "INFO" => colored::Color::Blue,
            _ => colored::Color::White,
        };

        format!(
            "{}\n  📍 Line {}: {}\n  📝 {}\n  💡 {}\n\n",
            format!("  [{}]", severity).color(severity_color).bold(),
            violation.line_number,
            violation.variable_name.bold(),
            violation.description,
            violation.suggestion.italic()
        )
    }
}

#[derive(Debug)]
pub struct StorageSavings {
    pub unused_variables: usize,
    pub estimated_savings_kb: f64,
    pub monthly_ledger_rent_savings: f64,
}

impl fmt::Display for StorageSavings {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "💰 Storage Optimization Potential:\n   • {} unused state variables\n   • {:.1} KB storage savings\n   • {:.4} XLM/month ledger rent savings",
            self.unused_variables,
            self.estimated_savings_kb,
            self.monthly_ledger_rent_savings
        )
    }
}
