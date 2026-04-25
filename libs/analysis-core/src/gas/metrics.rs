/// Gas cost associated with a single pattern/finding.
#[derive(Debug, Clone, PartialEq)]
pub struct PatternGasCost {
    /// The rule that detected the pattern.
    pub rule_id: String,
    /// Estimated gas used *before* applying the fix.
    pub before_gas: u64,
    /// Estimated gas used *after* applying the fix.
    pub after_gas: u64,
    /// File the pattern was found in.
    pub file: String,
    /// Line number of the pattern.
    pub line: u32,
}

impl PatternGasCost {
    pub fn new(
        rule_id: impl Into<String>,
        file: impl Into<String>,
        line: u32,
        before_gas: u64,
        after_gas: u64,
    ) -> Self {
        Self {
            rule_id: rule_id.into(),
            file: file.into(),
            line,
            before_gas,
            after_gas,
        }
    }

    /// Gas saved by applying the fix (saturating — never negative).
    pub fn savings(&self) -> u64 {
        self.before_gas.saturating_sub(self.after_gas)
    }

    /// Percentage improvement (0 – 100).
    pub fn savings_pct(&self) -> f64 {
        if self.before_gas == 0 {
            return 0.0;
        }
        (self.savings() as f64 / self.before_gas as f64) * 100.0
    }
}

/// Aggregated gas metrics for an entire analysis session.
#[derive(Debug, Default, Clone)]
pub struct GasReport {
    pub entries: Vec<PatternGasCost>,
}

impl GasReport {
    pub fn push(&mut self, entry: PatternGasCost) {
        self.entries.push(entry);
    }

    /// Total estimated gas *before* fixes.
    pub fn total_before(&self) -> u64 {
        self.entries.iter().map(|e| e.before_gas).sum()
    }

    /// Total estimated gas *after* fixes.
    pub fn total_after(&self) -> u64 {
        self.entries.iter().map(|e| e.after_gas).sum()
    }

    /// Total gas saved.
    pub fn total_savings(&self) -> u64 {
        self.entries.iter().map(|e| e.savings()).sum()
    }

    /// Overall percentage improvement.
    pub fn overall_savings_pct(&self) -> f64 {
        let before = self.total_before();
        if before == 0 {
            return 0.0;
        }
        (self.total_savings() as f64 / before as f64) * 100.0
    }
}