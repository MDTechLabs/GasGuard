use crate::scanner::{ContractScanner, ScanResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum UsageTier {
    Starter,
    Developer,
    Professional,
    Enterprise,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TierConfig {
    pub tier: UsageTier,
    pub name: String,
    pub description: String,
    pub request_limit: i64,
    pub base_price_per_request: f64, // in XLM
    pub discount_percentage: f64,
    pub features: Vec<String>,
    pub rate_limit_per_minute: i32,
    pub priority_support: bool,
    pub custom_pricing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserUsage {
    pub user_id: String,
    pub current_tier: UsageTier,
    pub current_month_requests: i64,
    pub monthly_usage: Vec<MonthlyUsage>,
    pub average_requests_per_month: f64,
    pub peak_requests_per_month: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonthlyUsage {
    pub month: String, // YYYY-MM format
    pub requests: i64,
    pub tier: UsageTier,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TieredScanResult {
    pub base_result: ScanResult,
    pub applied_tier: UsageTier,
    pub tier_discount: f64,
    pub final_price_per_request: f64,
    pub total_cost_with_tier: f64,
    pub current_usage: i64,
    pub remaining_requests: i64,
    pub usage_percentage: f64,
    pub recommended_tier: Option<UsageTier>,
    pub upgrade_savings: Option<f64>,
    pub downgrade_warning: Option<String>,
}

pub struct TieredScanner {
    base_scanner: ContractScanner,
    tier_configs: HashMap<UsageTier, TierConfig>,
}

impl TieredScanner {
    pub fn new() -> Self {
        let mut tier_configs = HashMap::new();

        // Initialize default tier configurations
        tier_configs.insert(
            UsageTier::Starter,
            TierConfig {
                tier: UsageTier::Starter,
                name: "Starter".to_string(),
                description: "Perfect for individual developers and small projects".to_string(),
                request_limit: 1000,
                base_price_per_request: 0.00001,
                discount_percentage: 0.0,
                features: vec![
                    "Basic gas estimation".to_string(),
                    "Standard priority support".to_string(),
                    "Monthly usage reports".to_string(),
                    "API access (1000 requests/month)".to_string(),
                ],
                rate_limit_per_minute: 10,
                priority_support: false,
                custom_pricing: false,
            },
        );

        tier_configs.insert(
            UsageTier::Developer,
            TierConfig {
                tier: UsageTier::Developer,
                name: "Developer".to_string(),
                description: "Ideal for active developers and growing projects".to_string(),
                request_limit: 10000,
                base_price_per_request: 0.000008, // 20% discount
                discount_percentage: 20.0,
                features: vec![
                    "Advanced gas estimation".to_string(),
                    "Priority support".to_string(),
                    "Real-time analytics".to_string(),
                    "API access (10,000 requests/month)".to_string(),
                    "Custom alerts".to_string(),
                    "Historical data access (6 months)".to_string(),
                ],
                rate_limit_per_minute: 30,
                priority_support: true,
                custom_pricing: false,
            },
        );

        tier_configs.insert(
            UsageTier::Professional,
            TierConfig {
                tier: UsageTier::Professional,
                name: "Professional".to_string(),
                description: "For professional teams and production applications".to_string(),
                request_limit: 100000,
                base_price_per_request: 0.000006, // 40% discount
                discount_percentage: 40.0,
                features: vec![
                    "Premium gas estimation".to_string(),
                    "24/7 priority support".to_string(),
                    "Advanced analytics dashboard".to_string(),
                    "API access (100,000 requests/month)".to_string(),
                    "Custom integrations".to_string(),
                    "Historical data access (2 years)".to_string(),
                    "Custom alerts and notifications".to_string(),
                    "SLA guarantees".to_string(),
                ],
                rate_limit_per_minute: 100,
                priority_support: true,
                custom_pricing: true,
            },
        );

        tier_configs.insert(
            UsageTier::Enterprise,
            TierConfig {
                tier: UsageTier::Enterprise,
                name: "Enterprise".to_string(),
                description: "Custom solutions for large-scale operations".to_string(),
                request_limit: -1,                // unlimited
                base_price_per_request: 0.000004, // 60% discount
                discount_percentage: 60.0,
                features: vec![
                    "Enterprise-grade gas estimation".to_string(),
                    "Dedicated support team".to_string(),
                    "Custom analytics and reporting".to_string(),
                    "Unlimited API access".to_string(),
                    "White-label solutions".to_string(),
                    "Unlimited historical data".to_string(),
                    "Custom integrations and workflows".to_string(),
                    "99.9% SLA guarantee".to_string(),
                    "Custom contracts and pricing".to_string(),
                ],
                rate_limit_per_minute: 1000,
                priority_support: true,
                custom_pricing: true,
            },
        );

        Self {
            base_scanner: ContractScanner::new(),
            tier_configs,
        }
    }

    pub fn scan_with_tier(
        &self,
        content: &str,
        source: String,
        user_usage: &UserUsage,
    ) -> anyhow::Result<TieredScanResult> {
        // First get the base scan result
        let base_result = self.base_scanner.scan_content(content, source)?;

        // Get tier configuration
        let tier_config = self
            .tier_configs
            .get(&user_usage.current_tier)
            .ok_or_else(|| anyhow::anyhow!("Invalid tier: {:?}", user_usage.current_tier))?;

        // Calculate tier discount
        let tier_discount = tier_config.discount_percentage / 100.0;

        // Simulate base cost (in a real implementation, this would come from the scan)
        let base_cost = 0.00001; // Base cost per scan
        let discounted_price = base_cost * (1.0 - tier_discount);

        // Calculate usage metrics
        let usage_percentage = if tier_config.request_limit == -1 {
            0.0 // Unlimited tier
        } else {
            (user_usage.current_month_requests as f64 / tier_config.request_limit as f64) * 100.0
        };

        let remaining_requests = if tier_config.request_limit == -1 {
            i64::MAX // Unlimited
        } else {
            tier_config.request_limit - user_usage.current_month_requests
        };

        // Determine recommended tier
        let recommended_tier = self.get_recommended_tier(user_usage.current_month_requests);
        let upgrade_savings = if recommended_tier != user_usage.current_tier {
            Some(self.calculate_upgrade_savings(
                &user_usage.current_tier,
                &recommended_tier,
                base_cost,
            ))
        } else {
            None
        };

        // Check for downgrade warning
        let downgrade_warning = if usage_percentage < 20.0
            && user_usage.current_tier != UsageTier::Starter
        {
            let lower_tier = self.get_lower_tier(&user_usage.current_tier);
            Some(format!(
                "Consider downgrading to {:?} to save costs - you're only using {:.1}% of your current tier limit.",
                lower_tier, usage_percentage
            ))
        } else {
            None
        };

        Ok(TieredScanResult {
            base_result,
            applied_tier: user_usage.current_tier.clone(),
            tier_discount: tier_config.discount_percentage,
            final_price_per_request: discounted_price,
            total_cost_with_tier: discounted_price,
            current_usage: user_usage.current_month_requests,
            remaining_requests,
            usage_percentage,
            recommended_tier: if recommended_tier != user_usage.current_tier {
                Some(recommended_tier)
            } else {
                None
            },
            upgrade_savings,
            downgrade_warning,
        })
    }

    pub fn get_tier_config(&self, tier: &UsageTier) -> Option<&TierConfig> {
        self.tier_configs.get(tier)
    }

    pub fn get_all_tiers(&self) -> Vec<&TierConfig> {
        self.tier_configs.values().collect()
    }

    pub fn validate_tier_access(&self, user_usage: &UserUsage) -> TierValidationResult {
        let tier_config = match self.tier_configs.get(&user_usage.current_tier) {
            Some(config) => config,
            None => {
                return TierValidationResult {
                    is_valid: false,
                    current_tier: user_usage.current_tier.clone(),
                    can_proceed: false,
                    message: "Invalid user tier configuration".to_string(),
                    suggested_action: SuggestedAction::ContactSupport,
                    next_available_tier: None,
                };
            }
        };

        // Check if user has exceeded their limit
        if user_usage.current_month_requests >= tier_config.request_limit
            && tier_config.request_limit != -1
        {
            let next_tier = self.get_higher_tier(&user_usage.current_tier);
            return TierValidationResult {
                is_valid: false,
                current_tier: user_usage.current_tier.clone(),
                can_proceed: false,
                message: format!(
                    "Monthly request limit exceeded ({}). Please upgrade to {:?} tier.",
                    tier_config.request_limit, next_tier
                ),
                suggested_action: SuggestedAction::Upgrade,
                next_available_tier: Some(next_tier),
            };
        }

        // Check if user is approaching their limit
        let usage_percentage =
            (user_usage.current_month_requests as f64 / tier_config.request_limit as f64) * 100.0;
        if usage_percentage > 90.0 {
            let next_tier = self.get_higher_tier(&user_usage.current_tier);
            return TierValidationResult {
                is_valid: true,
                current_tier: user_usage.current_tier.clone(),
                can_proceed: true,
                message: format!(
                    "Warning: You've used {:.1}% of your monthly limit. Consider upgrading soon.",
                    usage_percentage
                ),
                suggested_action: SuggestedAction::Upgrade,
                next_available_tier: Some(next_tier),
            };
        }

        TierValidationResult {
            is_valid: true,
            current_tier: user_usage.current_tier.clone(),
            can_proceed: true,
            message: "Request authorized within current tier limits".to_string(),
            suggested_action: SuggestedAction::Continue,
            next_available_tier: None,
        }
    }

    fn get_recommended_tier(&self, monthly_requests: i64) -> UsageTier {
        if monthly_requests <= 1000 {
            UsageTier::Starter
        } else if monthly_requests <= 10000 {
            UsageTier::Developer
        } else if monthly_requests <= 100000 {
            UsageTier::Professional
        } else {
            UsageTier::Enterprise
        }
    }

    fn calculate_upgrade_savings(
        &self,
        current_tier: &UsageTier,
        recommended_tier: &UsageTier,
        base_cost: f64,
    ) -> f64 {
        if current_tier == recommended_tier {
            return 0.0;
        }

        let current_config = match self.tier_configs.get(current_tier) {
            Some(config) => config,
            None => return 0.0,
        };

        let recommended_config = match self.tier_configs.get(recommended_tier) {
            Some(config) => config,
            None => return 0.0,
        };

        let current_price = base_cost * (1.0 - current_config.discount_percentage / 100.0);
        let recommended_price = base_cost * (1.0 - recommended_config.discount_percentage / 100.0);

        current_price - recommended_price
    }

    fn get_higher_tier(&self, current_tier: &UsageTier) -> UsageTier {
        match current_tier {
            UsageTier::Starter => UsageTier::Developer,
            UsageTier::Developer => UsageTier::Professional,
            UsageTier::Professional => UsageTier::Enterprise,
            UsageTier::Enterprise => UsageTier::Enterprise, // Already highest
        }
    }

    fn get_lower_tier(&self, current_tier: &UsageTier) -> UsageTier {
        match current_tier {
            UsageTier::Starter => UsageTier::Starter, // Already lowest
            UsageTier::Developer => UsageTier::Starter,
            UsageTier::Professional => UsageTier::Developer,
            UsageTier::Enterprise => UsageTier::Professional,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TierValidationResult {
    pub is_valid: bool,
    pub current_tier: UsageTier,
    pub can_proceed: bool,
    pub message: String,
    pub suggested_action: SuggestedAction,
    pub next_available_tier: Option<UsageTier>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SuggestedAction {
    Upgrade,
    Downgrade,
    Continue,
    ContactSupport,
}
