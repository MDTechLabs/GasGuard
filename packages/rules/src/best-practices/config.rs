use crate::ViolationSeverity;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BestPracticeRuleConfig {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub severity: ViolationSeverity,
    pub category: String,
}

impl BestPracticeRuleConfig {
    pub fn new(id: &str, name: &str, enabled: bool, severity: ViolationSeverity) -> Self {
        Self {
            id: id.to_string(),
            name: name.to_string(),
            enabled,
            severity,
            category: "best-practices".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BestPracticesConfig {
    pub rules: Vec<BestPracticeRuleConfig>,
}

impl Default for BestPracticesConfig {
    fn default() -> Self {
        Self {
            rules: vec![
                BestPracticeRuleConfig::new("use-safe-int-types", "Use Safe Integer Types", true, ViolationSeverity::Medium),
                BestPracticeRuleConfig::new("use-immutable-storage", "Use Immutable Storage for Read-Only Data", true, ViolationSeverity::Medium),
                BestPracticeRuleConfig::new("use-checked-arithmetic", "Use Checked Arithmetic", true, ViolationSeverity::High),
                BestPracticeRuleConfig::new("use-result-types", "Use Result Return Types", true, ViolationSeverity::Medium),
                BestPracticeRuleConfig::new("use-initialization-functions", "Use Initialization Functions", true, ViolationSeverity::High),
            ],
        }
    }
}

pub fn default_best_practices_config() -> BestPracticesConfig {
    BestPracticesConfig::default()
}
