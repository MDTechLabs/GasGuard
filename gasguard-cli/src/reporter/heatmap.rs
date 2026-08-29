//! Terminal Color-Coded Gas Consumption Heatmap Output

pub struct GasHeatmapReporter {
    pub no_color: bool,
}

/// A single function's estimated gas cost, or `None` when no gas estimate
/// could be produced (e.g. the function was skipped by the analyzer, or
/// gas estimation failed for it).
pub struct GasEntry {
    pub function_name: String,
    pub gas_cost: Option<u64>,
}

impl GasHeatmapReporter {
    pub fn new(no_color: bool) -> Self {
        Self { no_color }
    }

    /// Formats a single function's gas tier line. `gas_cost` of `None`
    /// represents a function with no gas data available (e.g. it could not
    /// be estimated), which is rendered as a distinct "N/A" tier instead of
    /// being silently coerced into the lowest bucket.
    pub fn format_gas_tier(&self, function_name: &str, gas_cost: Option<u64>) -> String {
        let label = self.get_tier_label(gas_cost);
        let bar = self.get_bar(gas_cost);
        let gas_display = match gas_cost {
            Some(g) => format!("{} gas", g),
            None => "no gas data".to_string(),
        };

        if self.no_color {
            return format!("[{}] {} {} - {}", label, bar, function_name, gas_display);
        }

        let color_code = self.get_color_code(gas_cost);
        let reset = "\x1b[0m";
        format!(
            "{}[{}] {} {} - {}{}",
            color_code, label, bar, function_name, gas_display, reset
        )
    }

    /// Formats a full report for a set of functions, including a legend of
    /// what each tier/color means so standalone output remains readable
    /// without prior context.
    pub fn format_report(&self, entries: &[GasEntry]) -> String {
        let mut lines = Vec::with_capacity(entries.len() + 2);
        lines.push(self.format_legend());
        for entry in entries {
            lines.push(self.format_gas_tier(&entry.function_name, entry.gas_cost));
        }
        lines.join("\n")
    }

    /// A short legend explaining the tier thresholds and (when color is
    /// enabled) the color each tier maps to, so CI logs and terminal
    /// output are self-describing.
    pub fn format_legend(&self) -> String {
        if self.no_color {
            "Legend: LOW < 5,000 gas | MEDIUM 5,000-25,000 gas | HIGH > 25,000 gas | N/A no data"
                .to_string()
        } else {
            format!(
                "Legend: {}LOW{} < 5,000 gas | {}MEDIUM{} 5,000-25,000 gas | {}HIGH{} > 25,000 gas | N/A no data",
                "\x1b[32m", "\x1b[0m", "\x1b[33m", "\x1b[0m", "\x1b[31m", "\x1b[0m"
            )
        }
    }

    fn get_color_code(&self, gas_cost: Option<u64>) -> &'static str {
        match gas_cost {
            None => "\x1b[90m",             // Grey (no data)
            Some(0..=4999) => "\x1b[32m",    // Green (Low)
            Some(5000..=25000) => "\x1b[33m", // Yellow (Medium)
            Some(_) => "\x1b[31m",           // Red (High)
        }
    }

    fn get_tier_label(&self, gas_cost: Option<u64>) -> &'static str {
        match gas_cost {
            None => "N/A",
            Some(0..=4999) => "LOW",
            Some(5000..=25000) => "MEDIUM",
            Some(_) => "HIGH",
        }
    }

    /// A short visual severity bar summarizing the tier at a glance,
    /// satisfying the "summary visual bars" requirement alongside the
    /// per-tier color coding.
    fn get_bar(&self, gas_cost: Option<u64>) -> &'static str {
        match gas_cost {
            None => "----",
            Some(0..=4999) => "#",
            Some(5000..=25000) => "##",
            Some(_) => "###",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn low_tier_has_correct_label_and_bar() {
        let reporter = GasHeatmapReporter::new(true);
        let line = reporter.format_gas_tier("foo", Some(1000));
        assert!(line.contains("[LOW]"));
        assert!(line.contains("1000 gas"));
    }

    #[test]
    fn medium_tier_boundary_is_inclusive() {
        let reporter = GasHeatmapReporter::new(true);
        assert!(reporter.format_gas_tier("f", Some(5000)).contains("[MEDIUM]"));
        assert!(reporter.format_gas_tier("f", Some(25000)).contains("[MEDIUM]"));
        assert!(reporter.format_gas_tier("f", Some(25001)).contains("[HIGH]"));
    }

    #[test]
    fn zero_gas_function_is_low_tier_not_a_crash() {
        let reporter = GasHeatmapReporter::new(true);
        let line = reporter.format_gas_tier("noop", Some(0));
        assert!(line.contains("[LOW]"));
        assert!(line.contains("0 gas"));
    }

    #[test]
    fn missing_gas_data_renders_as_na_tier() {
        let reporter = GasHeatmapReporter::new(true);
        let line = reporter.format_gas_tier("unestimated", None);
        assert!(line.contains("[N/A]"));
        assert!(line.contains("no gas data"));
    }

    #[test]
    fn no_color_mode_emits_no_ansi_escapes() {
        let reporter = GasHeatmapReporter::new(true);
        let line = reporter.format_gas_tier("f", Some(100000));
        assert!(!line.contains('\u{1b}'));
    }

    #[test]
    fn color_mode_emits_ansi_escapes() {
        let reporter = GasHeatmapReporter::new(false);
        let line = reporter.format_gas_tier("f", Some(100000));
        assert!(line.contains('\u{1b}'));
    }

    #[test]
    fn report_includes_legend_and_all_entries() {
        let reporter = GasHeatmapReporter::new(true);
        let entries = vec![
            GasEntry { function_name: "a".to_string(), gas_cost: Some(100) },
            GasEntry { function_name: "b".to_string(), gas_cost: None },
        ];
        let report = reporter.format_report(&entries);
        assert!(report.starts_with("Legend:"));
        assert!(report.contains("a"));
        assert!(report.contains("[N/A]"));
    }
}
