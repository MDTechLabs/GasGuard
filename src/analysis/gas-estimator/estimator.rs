use std::collections::HashMap;
use analysis_core::gas::{GasReport, PatternGasCost};
use analysis_core::plugin::Finding;

/// Per-rule gas cost table entry.
#[derive(Debug, Clone)]
pub struct GasCostEntry {
    /// Estimated gas used by the *problematic* pattern (before fix).
    pub before_gas: u64,
    /// Estimated gas used by the *fixed* pattern (after fix).
    pub after_gas: u64,
}

/// Maps rule IDs to their associated gas costs.
///
/// Populate this with known patterns; rules not in the table fall back to
/// `default_before` / `default_after`.
pub struct GasEstimator {
    table: HashMap<String, GasCostEntry>,
    default_before: u64,
    default_after: u64,
}

impl GasEstimator {
    /// Create an estimator with built-in known patterns.
    pub fn with_defaults() -> Self {
        let mut est = Self {
            table: HashMap::new(),
            default_before: 5_000,
            default_after: 2_500,
        };

        // Solidity
        est.register("SOL-001", 20_000, 800);   // string storage vs bytes32
        est.register("SOL-002", 2_100, 100);    // SLOAD vs MLOAD (warm vs cache)

        // Rust (gas proxied as compute units)
        est.register("RUST-001", 1_500, 200);   // heap String vs &str
        est.register("RUST-002", 3_000, 300);   // clone in loop

        // Vyper
        est.register("VY-001", 50_000, 5_000);  // unbounded loop — highly variable
        est.register("VY-002", 600, 0);         // @external dispatch overhead

        est
    }

    /// Register a custom rule cost.
    pub fn register(&mut self, rule_id: &str, before_gas: u64, after_gas: u64) {
        self.table.insert(rule_id.to_string(), GasCostEntry { before_gas, after_gas });
    }

    /// Build a [`GasReport`] from a slice of [`Finding`]s.
    pub fn estimate(&self, findings: &[Finding]) -> GasReport {
        let mut report = GasReport::default();
        for f in findings {
            let entry = self.table.get(&f.rule_id).cloned().unwrap_or(GasCostEntry {
                before_gas: self.default_before,
                after_gas: self.default_after,
            });
            report.push(PatternGasCost::new(
                &f.rule_id,
                &f.file,
                f.line,
                entry.before_gas,
                entry.after_gas,
            ));
        }
        report
    }

    /// Estimate from findings and print a formatted summary to stdout.
    pub fn estimate_and_print(&self, findings: &[Finding]) -> GasReport {
        let report = self.estimate(findings);

        println!("\n╔══════════════════════════════════════════════════════╗");
        println!("║              GasGuard — Gas Savings Report            ║");
        println!("╠══════════════════════════════════════════════════════╣");
        println!("  {:>10}  {:>10}  {:>10}  {}", "Before", "After", "Savings", "Rule / Location");
        println!("  {:->10}  {:->10}  {:->10}  {}", "", "", "", "────────────────────");

        for e in &report.entries {
            println!(
                "  {:>10}  {:>10}  {:>9}  {} @ {}:{}",
                e.before_gas, e.after_gas, e.savings(),
                e.rule_id, e.file, e.line
            );
        }

        println!("╠══════════════════════════════════════════════════════╣");
        println!(
            "  TOTAL  before={} after={} savings={} ({:.1}%)",
            report.total_before(),
            report.total_after(),
            report.total_savings(),
            report.overall_savings_pct()
        );
        println!("╚══════════════════════════════════════════════════════╝\n");

        report
    }
}