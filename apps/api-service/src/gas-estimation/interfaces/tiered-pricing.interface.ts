/**
 * Tiered Pricing Interface
 * Defines usage-based pricing tiers for GasGuard
 */

export enum UsageTier {
  STARTER = "starter",
  DEVELOPER = "developer",
  PROFESSIONAL = "professional",
  ENTERPRISE = "enterprise",
}

export interface TierConfig {
  tier: UsageTier;
  name: string;
  description: string;
  // Usage limits (requests per month)
  requestLimit: number;
  // Pricing per request
  basePricePerRequest: number; // in XLM
  // Discount percentage from base price
  discountPercentage: number;
  // Features available at this tier
  features: string[];
  // Rate limiting (requests per minute)
  rateLimitPerMinute: number;
  // Priority support
  prioritySupport: boolean;
  // Custom pricing available
  customPricing: boolean;
}

export interface TieredPricingConfig {
  // Default tier for new users
  defaultTier: UsageTier;
  // All available tiers
  tiers: Map<UsageTier, TierConfig>;
  // Usage tracking period (days)
  usageTrackingPeriod: number;
  // Auto-upgrade enabled
  autoUpgradeEnabled: boolean;
  // Grace period for tier changes (days)
  tierChangeGracePeriod: number;
}

export interface UserUsage {
  userId: string;
  currentTier: UsageTier;
  // Current month usage
  currentMonthRequests: number;
  // Historical usage (last 12 months)
  monthlyUsage: Array<{
    month: string; // YYYY-MM format
    requests: number;
    tier: UsageTier;
  }>;
  // Usage metrics
  averageRequestsPerMonth: number;
  peakRequestsPerMonth: number;
  // Tier change history
  tierHistory: Array<{
    fromTier: UsageTier;
    toTier: UsageTier;
    changedAt: Date;
    reason: string;
  }>;
  // Current billing period
  billingPeriodStart: Date;
  billingPeriodEnd: Date;
}

export interface TieredPriceEstimate {
  // Base estimate
  baseEstimate: any; // DynamicGasEstimate from existing system
  // Tier information
  appliedTier: UsageTier;
  tierDiscount: number;
  // Final pricing
  finalPricePerRequest: number;
  totalCostWithTier: number;
  // Usage context
  currentUsage: number;
  remainingRequests: number;
  usagePercentage: number;
  // Recommendations
  recommendedTier?: UsageTier;
  upgradeSavings?: number;
  downgradeWarning?: string;
}

export interface TierTransition {
  fromTier: UsageTier;
  toTier: UsageTier;
  effectiveDate: Date;
  reason:
    | "usage_upgrade"
    | "usage_downgrade"
    | "manual_upgrade"
    | "manual_downgrade"
    | "admin_change";
  prorationRequired: boolean;
  notificationRequired: boolean;
}

export interface TierValidationResult {
  isValid: boolean;
  currentTier: UsageTier;
  canProceed: boolean;
  message: string;
  suggestedAction?: "upgrade" | "downgrade" | "continue" | "contact_support";
  nextAvailableTier?: UsageTier;
}
