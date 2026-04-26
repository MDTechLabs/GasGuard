use analysis_core::plugin::Finding;
use std::io::{self, Write};

pub struct SummaryPrinter {
    use_colors: bool,
}

impl SummaryPrinter {
    pub fn new() -> Self {
        Self { use_colors: true }
    }

    pub fn with_colors(use_colors: bool) -> Self {
        Self { use_colors }
    }

    pub fn print_summary(&self, findings: &[Finding], scan_path: &str) {
        self.print_header();
        self.print_metadata(scan_path, findings.len());
        self.print_statistics(findings);
        self.print_findings(findings);
        self.print_footer();
    }

    pub fn print_compact(&self, findings: &[Finding]) {
        let critical = findings.iter()
            .filter(|f| matches!(f.severity, analysis_core::plugin::Severity::Critical))
            .count();
        let high = findings.iter()
            .filter(|f| matches!(f.severity, analysis_core::plugin::Severity::Error))
            .count();
        let medium = findings.iter()
            .filter(|f| matches!(f.severity, analysis_core::plugin::Severity::Warning))
            .count();
        let low = findings.iter()
            .filter(|f| matches!(f.severity, analysis_core::plugin::Severity::Info))
            .count();

        let status = if critical > 0 {
            self.color("✗ FAIL", "red")
        } else if high > 0 {
            self.color("⚠ WARN", "yellow")
        } else {
            self.color("✓ PASS", "green")
        };

        println!(
            "{} {} issues found ({} critical, {} high, {} medium, {} low)",
            status,
            findings.len(),
            critical,
            high,
            medium,
            low
        );
    }

    fn print_header(&self) {
        println!("{}", self.color("═══════════════════════════════════════════════════════════", "blue"));
        println!("{}", self.color("                    GasGuard Scan Report", "blue"));
        println!("{}\n", self.color("═══════════════════════════════════════════════════════════", "blue"));
    }

    fn print_metadata(&self, scan_path: &str, count: usize) {
        println!("Scan Path: {}", self.color(scan_path, "gray"));
        println!("Files Scanned: {}\n", self.color(&count.to_string(), "gray"));
    }

    fn print_statistics(&self, findings: &[Finding]) {
        println!("{}", self.color("Summary Statistics:", "bold"));
        println!("  Total Violations: {}", self.color(&findings.len().to_string(), "yellow"));
        
        let critical = findings.iter()
            .filter(|f| matches!(f.severity, analysis_core::plugin::Severity::Critical))
            .count();
        let high = findings.iter()
            .filter(|f| matches!(f.severity, analysis_core::plugin::Severity::Error))
            .count();
        let medium = findings.iter()
            .filter(|f| matches!(f.severity, analysis_core::plugin::Severity::Warning))
            .count();
        let low = findings.iter()
            .filter(|f| matches!(f.severity, analysis_core::plugin::Severity::Info))
            .count();

        println!("\n{}", self.color("Violations by Severity:", "bold"));
        self.print_severity_count("Critical", critical, "red");
        self.print_severity_count("High", high, "yellow");
        self.print_severity_count("Medium", medium, "yellow");
        self.print_severity_count("Low", low, "blue");
        println!();
    }

    fn print_severity_count(&self, label: &str, count: usize, color: &str) {
        let colored_count = if count > 0 {
            self.color(&count.to_string(), color)
        } else {
            self.color("0", "gray")
        };
        println!("  {:10}: {}", label, colored_count);
    }

    fn print_findings(&self, findings: &[Finding]) {
        if findings.is_empty() {
            return;
        }

        println!("{}", self.color("Findings Details:", "bold"));
        println!("{}", self.color("─".repeat(60), "gray"));

        for finding in findings.iter().take(20) {
            self.print_finding(finding);
        }

        if findings.len() > 20 {
            println!("\n... and {} more findings", findings.len() - 20);
        }
        println!();
    }

    fn print_finding(&self, finding: &Finding) {
        let severity_str = format!("{:?}", finding.severity);
        let severity_color = match finding.severity {
            analysis_core::plugin::Severity::Critical => "red",
            analysis_core::plugin::Severity::Error => "yellow",
            analysis_core::plugin::Severity::Warning => "yellow",
            analysis_core::plugin::Severity::Info => "blue",
        };

        println!("\n[{}] {} - {}",
            self.color(&severity_str, severity_color),
            finding.rule_id,
            finding.rule_id
        );
        println!("  File: {}:{}", finding.file, finding.line);
        println!("  Message: {}", self.color(&finding.message, "gray"));
        
        if let Some(ref suggestion) = finding.suggestion {
            println!("  Suggestion: {}", self.color(suggestion, "cyan"));
        }
    }

    fn print_footer(&self) {
        println!("{}\n", self.color("═══════════════════════════════════════════════════════════", "blue"));
    }

    fn color(&self, text: &str, color: &str) -> String {
        if !self.use_colors {
            return text.to_string();
        }

        match color {
            "red" => format!("\x1b[31m{}\x1b[0m", text),
            "green" => format!("\x1b[32m{}\x1b[0m", text),
            "yellow" => format!("\x1b[33m{}\x1b[0m", text),
            "blue" => format!("\x1b[34m{}\x1b[0m", text),
            "cyan" => format!("\x1b[36m{}\x1b[0m", text),
            "gray" => format!("\x1b[90m{}\x1b[0m", text),
            "bold" => format!("\x1b[1m{}\x1b[0m", text),
            _ => text.to_string(),
        }
    }
}

impl Default for SummaryPrinter {
    fn default() -> Self {
        Self::new()
    }
}
