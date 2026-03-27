// import { Injectable, Logger } from "@nestjs/common";
// import {
//   UsageTier,
//   TierConfig,
//   TieredPricingConfig,
//   UserUsage,
//   TieredPriceEstimate,
// } from "../interfaces/tiered-pricing.interface";
// import { DynamicGasEstimate } from "../interfaces/gas-price.interface";
// import { FeeConfigurationService } from "./fee-configuration.service";
// import {
//   FeeConfiguration,
//   TierValidationResult,
//   TierTransition,
// } from "../interfaces/fee-config.interface";

// /**
//  * TieredPricingService
//  * Implements usage-based pricing tiers for GasGuard
//  * Handles tier calculations, transitions, and validation
//  */
// @Injectable()
// export class TieredPricingService {
//   private readonly logger = new Logger(TieredPricingService.name);

//   constructor(private feeConfigurationService: FeeConfigurationService) {}

//   /**
//    * Initialize default tier configurations from fee configuration
//    */
//   private async initializeTierConfigs() {
//     const feeConfig =
//       await this.feeConfigurationService.getCurrentConfiguration();

//     const tiers = new Map([
//       [
//         UsageTier.STARTER,
//         {
//           tier: UsageTier.STARTER,
//           name: "Starter",
//           description: "Perfect for individual developers and small projects",
//           requestLimit: feeConfig.requestLimits.starter,
//           basePricePerRequest:
//             feeConfig.basePricePerRequest * feeConfig.tierMultipliers.starter,
//           discountPercentage: feeConfig.discountPercentages.starter,
//           features: [
//             "Basic gas estimation",
//             "Standard priority support",
//             "Monthly usage reports",
//             "API access (1000 requests/month)",
//           ],
//           rateLimitPerMinute: feeConfig.rateLimits.starter,
//           prioritySupport: false,
//           customPricing: false,
//         },
//       ],
//       [
//         UsageTier.DEVELOPER,
//         {
//           tier: UsageTier.DEVELOPER,
//           name: "Developer",
//           description: "Ideal for active developers and growing projects",
//           requestLimit: feeConfig.requestLimits.developer,
//           basePricePerRequest:
//             feeConfig.basePricePerRequest * feeConfig.tierMultipliers.developer,
//           discountPercentage: feeConfig.discountPercentages.developer,
//           features: [
//             "Advanced gas estimation",
//             "Priority support",
//             "Real-time analytics",
//             "API access (10,000 requests/month)",
//             "Custom alerts",
//             "Historical data access (6 months)",
//           ],
//           rateLimitPerMinute: feeConfig.rateLimits.developer,
//           prioritySupport: true,
//           customPricing: false,
//         },
//       ],
//       [
//         UsageTier.PROFESSIONAL,
//         {
//           tier: UsageTier.PROFESSIONAL,
//           name: "Professional",
//           description: "For professional teams and production applications",
//           requestLimit: feeConfig.requestLimits.professional,
//           basePricePerRequest:
//             feeConfig.basePricePerRequest *
//             feeConfig.tierMultipliers.professional,
//           discountPercentage: feeConfig.discountPercentages.professional,
//           features: [
//             "Premium gas estimation",
//             "24/7 priority support",
//             "Advanced analytics dashboard",
//             "API access (100,000 requests/month)",
//             "Custom integrations",
//             "Historical data access (2 years)",
//             "Custom alerts and notifications",
//             "SLA guarantees",
//           ],
//           rateLimitPerMinute: feeConfig.rateLimits.professional,
//           prioritySupport: true,
//           customPricing: true,
//         },
//       ],
//       [
//         UsageTier.ENTERPRISE,
//         {
//           tier: UsageTier.ENTERPRISE,
//           name: "Enterprise",
//           description: "Custom solutions for large-scale operations",
//           requestLimit: feeConfig.requestLimits.enterprise,
//           basePricePerRequest:
//             feeConfig.basePricePerRequest *
//             feeConfig.tierMultipliers.enterprise,
//           discountPercentage: feeConfig.discountPercentages.enterprise,
//           features: [
//             "Enterprise-grade gas estimation",
//             "Dedicated support team",
//             "Custom analytics and reporting",
//             "Unlimited API access",
//             "White-label solutions",
//             "Unlimited historical data",
//             "Custom integrations and workflows",
//             "99.9% SLA guarantee",
//             "Custom contracts and pricing",
//           ],
//           rateLimitPerMinute: feeConfig.rateLimits.enterprise,
//           prioritySupport: true,
//           customPricing: true,
//         },
//       ],
//     ]);

//     return tiers;
//   }

//   /**
//    * Get tier configuration by tier type
//    */
//   async getTierConfig(tier: UsageTier): Promise<TierConfig | undefined> {
//     const tiers = await this.initializeTierConfigs();
//     return tiers.get(tier);
//   }

//   /**
//    * Get all available tiers
//    */
//   async getAllTiers(): Promise<TierConfig[]> {
//     const tiers = await this.initializeTierConfigs();
//     return Array.from(tiers.values());
//   }

//   /**
//    * Get recommended tier based on usage
//    */
//   async getRecommendedTier(monthlyRequests: number): Promise<UsageTier> {
//     if (monthlyRequests <= 1000) {
//       return UsageTier.STARTER;
//     } else if (monthlyRequests <= 10000) {
//       return UsageTier.DEVELOPER;
//     } else if (monthlyRequests <= 100000) {
//       return UsageTier.PROFESSIONAL;
//     } else {
//       return UsageTier.ENTERPRISE;
//     }
//   }

//   /**
//    * Calculate upgrade savings between tiers
//    */
//   async calculateUpgradeSavings(
	/**
	 * Simulate the effects of upgrading a user to a new tier
	 */
	async simulateUpgrade(
		userUsage: UserUsage,
		targetTier: UsageTier
	): Promise<{
		fromTier: UsageTier;
		toTier: UsageTier;
		currentConfig: TierConfig | undefined;
		targetConfig: TierConfig | undefined;
		currentMonthlyCost: number;
		newMonthlyCost: number;
		monthlySavings: number;
		annualSavings: number;
		featureDifferences: string[];
		usage: number;
		requestLimit: number;
		usagePercentage: number;
	}> {
		const currentConfig = await this.getTierConfig(userUsage.currentTier);
		const targetConfig = await this.getTierConfig(targetTier);
		if (!currentConfig || !targetConfig) {
			throw new Error("Invalid tier configuration");
		}
		// Estimate current and new monthly costs
		const currentMonthlyCost = userUsage.currentMonthRequests * currentConfig.basePricePerRequest * (1 - currentConfig.discountPercentage / 100);
		const newMonthlyCost = userUsage.currentMonthRequests * targetConfig.basePricePerRequest * (1 - targetConfig.discountPercentage / 100);
		const monthlySavings = currentMonthlyCost - newMonthlyCost;
		const annualSavings = monthlySavings * 12;
		// Feature differences
		const featureDifferences = targetConfig.features.filter(f => !currentConfig.features.includes(f));
		const usage = userUsage.currentMonthRequests;
		const requestLimit = targetConfig.requestLimit;
		const usagePercentage = (usage / requestLimit) * 100;
		return {
			fromTier: userUsage.currentTier,
			toTier: targetTier,
			currentConfig,
			targetConfig,
			currentMonthlyCost,
			newMonthlyCost,
			monthlySavings,
			annualSavings,
			featureDifferences,
			usage,
			requestLimit,
			usagePercentage,
		};
	}
//     currentTier: UsageTier,
//     newTier: UsageTier,
//     monthlyCost: number,
//   ): Promise<{
//     currentTierCost: number;
//     newTierCost: number;
//     monthlySavings: number;
//     yearlySavings: number;
//   }> {
//     const currentConfig = await this.getTierConfig(currentTier);
//     const newConfig = await this.getTierConfig(newTier);

//     if (!currentConfig || !newConfig) {
//       throw new Error("Invalid tier configuration");
//     }

//     return {
//       currentTierCost: monthlyCost,
//       newTierCost: monthlyCost * (1 - newConfig.discountPercentage / 100),
//       monthlySavings: monthlyCost - (monthlyCost * (1 - newConfig.discountPercentage / 100)),
//       yearlySavings: (monthlyCost - (monthlyCost * (1 - newConfig.discountPercentage / 100))) * 12,
//     };
//   }

//   /**
//    * Get next higher tier
//    */
//   async getHigherTier(currentTier: UsageTier): Promise<UsageTier> {
//     switch (currentTier) {
//       case UsageTier.STARTER:
//         return UsageTier.DEVELOPER;
//       case UsageTier.DEVELOPER:
//         return UsageTier.PROFESSIONAL;
//       case UsageTier.PROFESSIONAL:
//         return UsageTier.ENTERPRISE;
//       default:
//         return currentTier;
//     }
//   }

//   /**
//    * Get next lower tier
//    */
//   async getLowerTier(currentTier: UsageTier): Promise<UsageTier> {
//     switch (currentTier) {
//       case UsageTier.ENTERPRISE:
//         return UsageTier.PROFESSIONAL;
//       case UsageTier.PROFESSIONAL:
//         return UsageTier.DEVELOPER;
//       case UsageTier.DEVELOPER:
//         return UsageTier.STARTER;
//       default:
//         return currentTier;
//     }
//   }

//   /**
//    * Check if user should auto-upgrade
//    */
//   async shouldAutoUpgrade(userUsage: UserUsage): Promise<boolean> {
//     const tierConfig = await this.getTierConfig(userUsage.currentTier);
//     if (!tierConfig) return false;

//     // Auto-upgrade if consistently using >90% of limit for 3 months
//     const recentMonths = userUsage.monthlyUsage.slice(-3);
//     const highUsageMonths = recentMonths.filter(
//       (month) => month.requests > tierConfig.requestLimit * 0.9
//     );

//     return highUsageMonths.length >= 3;
//   }

//   /**
//    * Compare two tiers
//    */
//   async getTierComparison(
//     fromTier: UsageTier,
//     toTier: UsageTier,
//   ): Promise<{
//     fromTier: UsageTier;
//     toTier: UsageTier;
//     priceDifference: number;
//     featureDifferences: string[];
//   }> {
//     const fromConfig = await this.getTierConfig(fromTier);
//     const toConfig = await this.getTierConfig(toTier);

//     if (!fromConfig || !toConfig) {
//       throw new Error("Invalid tier configuration");
//     }

//     const priceDifference = fromConfig.discountPercentage - toConfig.discountPercentage;
//     const featureDifferences: string[] = [];

//     // Add feature differences based on tier comparison
//     if (toTier === UsageTier.PROFESSIONAL || toTier === UsageTier.ENTERPRISE) {
//       featureDifferences.push("Priority support");
//     }
//     if (toTier === UsageTier.ENTERPRISE) {
//       featureDifferences.push("Dedicated account manager");
//       featureDifferences.push("SLA guarantee");
//     }

//     return {
//       fromTier,
//       toTier,
//       priceDifference,
//       featureDifferences,
//     };
//   }

//   /**
//    * Calculate tiered pricing for a gas estimate
//    */
//   async calculateTieredPrice(
//     baseEstimate: DynamicGasEstimate,
//     userUsage: UserUsage,
//   ): Promise<TieredPriceEstimate> {
//     const tierConfig = await this.getTierConfig(userUsage.currentTier);
//     if (!tierConfig) {
//       throw new Error(
//         `Tier configuration not found for ${userUsage.currentTier}`,
//       );
//     }

//     // Calculate tier discount
//     const tierDiscount = tierConfig.discountPercentage / 100;
//     const discountedPrice =
//       baseEstimate.totalEstimatedCostXLM * (1 - tierDiscount);

//     // Calculate usage metrics
//     const usagePercentage =
//       (userUsage.currentMonthRequests / tierConfig.requestLimit) * 100;
//     const remainingRequests = Math.max(
//       0,
//       tierConfig.requestLimit - userUsage.currentMonthRequests,
//     );

//     // Determine recommended tier based on usage
//     const recommendedTier = await this.getRecommendedTier(
//       userUsage.currentMonthRequests,
//     );
//     const upgradeSavings = await this.calculateUpgradeSavings(
//       userUsage.currentTier,
//       recommendedTier,
//       baseEstimate.totalEstimatedCostXLM,
//     );

//     // Check for downgrade warnings
//     let downgradeWarning: string | undefined;
//     if (usagePercentage < 20 && userUsage.currentTier !== UsageTier.STARTER) {
//       const lowerTier = await this.getLowerTier(userUsage.currentTier);
//       downgradeWarning = `Consider downgrading to ${lowerTier} to save costs - you're only using ${usagePercentage.toFixed(1)}% of your current tier limit.`;
//     }

//     return {
//       baseEstimate,
//       appliedTier: userUsage.currentTier,
//       tierDiscount: tierConfig.discountPercentage,
//       finalPricePerRequest: discountedPrice,
//       totalCostWithTier: discountedPrice,
//       currentUsage: userUsage.currentMonthRequests,
//       remainingRequests,
//       usagePercentage,
//       recommendedTier:
//         recommendedTier !== userUsage.currentTier ? recommendedTier : undefined,
//       upgradeSavings: upgradeSavings.monthlySavings > 0 ? upgradeSavings.monthlySavings : undefined,
//       downgradeWarning,
//     };
//   }

//   /**
//    * Validate if user can proceed with request at current tier
//    */
//   validateTierAccess(userUsage: UserUsage): TierValidationResult {
//     const tierConfig = this.getTierConfig(userUsage.currentTier);
//     if (!tierConfig) {
//       return {
//         isValid: false,
//         errors: ["Invalid user tier configuration"],
//         warnings: [],
//         impact: {
//           affectedUsers: 1,
//           priceIncreasePercentage: 0,
//           priceDecreasePercentage: 0,
//         },
//         currentTier: userUsage.currentTier,
//         canProceed: false,
//         message: "Invalid user tier configuration",
//         suggestedAction: "contact_support",
//       };
//     }

//     // Check if user has exceeded their limit
//     return {
//       isValid: false,
//       currentTier: userUsage.currentTier,
//       canProceed: false,
//       message: "Invalid user tier configuration",
//       suggestedAction: "contact_support",
//     };
//   }

//   if (userUsage.currentMonthRequests > tierConfig.requestLimit) {
//     return {
//       isValid: false,
//       canProceed: false,
//       currentTier: userUsage.currentTier,
//       suggestedAction: 'upgrade',
//       nextAvailableTier: this.getNextTier(userUsage.currentTier),
//       message: `Monthly request limit exceeded (${tierConfig.requestLimit}). Please upgrade to ${this.getNextTier(userUsage.currentTier)} tier.`,
//       impact: {
//         affectedUsers: 30000,
//         priceIncreasePercentage: 0,
//         priceDecreasePercentage: 0,
//       },
//     };
//   }

//   const usagePercentage =
//     (userUsage.currentMonthRequests / tierConfig.requestLimit) * 100;
//   if (usagePercentage > 90) {
//         canProceed: true,
//         message: `Warning: You've used ${usagePercentage.toFixed(1)}% of your monthly limit. Consider upgrading soon.`,
//         suggestedAction: "upgrade",
//       };
//     }

//     return {
//       isValid: true,
//       currentTier: userUsage.currentTier,
//       canProceed: true,
//       message: "Request authorized within current tier limits",
//       suggestedAction: "continue",
//     };
//   }

//   /**
//    * Get recommended tier based on usage
//    */
//   getRecommendedTier(monthlyRequests: number): UsageTier {
//     if (monthlyRequests <= 1000) return UsageTier.STARTER;
//     if (monthlyRequests <= 10000) return UsageTier.DEVELOPER;
//     if (monthlyRequests <= 100000) return UsageTier.PROFESSIONAL;
//     return UsageTier.ENTERPRISE;
//   }

//   /**
//    * Calculate potential savings from tier upgrade
//    */
//   calculateUpgradeSavings(
//     currentTier: UsageTier,
//     recommendedTier: UsageTier,
//     baseCost: number,
//   ): number {
//     if (currentTier === recommendedTier) return 0;

//     const currentConfig = this.getTierConfig(currentTier);
//     const recommendedConfig = this.getTierConfig(recommendedTier);

//     if (!currentConfig || !recommendedConfig) return 0;

//     const currentPrice =
//       baseCost * (1 - currentConfig.discountPercentage / 100);
//     const recommendedPrice =
//       baseCost * (1 - recommendedConfig.discountPercentage / 100);

//     return currentPrice - recommendedPrice;
//   }

//   /**
//    * Process tier transition
//    */
//   async processTierTransition(
//     userId: string,
//     fromTier: UsageTier,
//     toTier: UsageTier,
//     reason: TierTransition["reason"],
//   ): Promise<TierTransition> {
//     const effectiveDate = new Date();
//     effectiveDate.setDate(
//       effectiveDate.getDate() + this.defaultTierConfig.tierChangeGracePeriod,
//     );

//     const transition: TierTransition = {
//       fromTier,
//       toTier,
//       effectiveDate,
//       reason,
//       prorationRequired: reason !== "admin_change",
//       notificationRequired: true,
//     };

//     this.logger.log(
//       `Processing tier transition for user ${userId}: ${fromTier} -> ${toTier}`,
//     );

//     // In a real implementation, this would:
//     // 1. Update user record in database
//     // 2. Process billing proration if required
//     // 3. Send notification to user
//     // 4. Update rate limiting rules
//     // 5. Log the transition for audit

//     return transition;
//   }

//   /**
//    * Check if auto-upgrade should be triggered
//    */
//   shouldAutoUpgrade(userUsage: UserUsage): boolean {
//     if (!this.defaultTierConfig.autoUpgradeEnabled) return false;

//     const currentConfig = this.getTierConfig(userUsage.currentTier);
//     if (!currentConfig) return false;

//     // Auto-upgrade if consistently using >90% of limit for 3 months
//     const recentMonths = userUsage.monthlyUsage.slice(-3);
//     if (recentMonths.length < 3) return false;

//     const highUsageMonths = recentMonths.filter((month) => {
//       const monthConfig = this.getTierConfig(month.tier);
//       if (!monthConfig) return false;
//       return month.requests / monthConfig.requestLimit > 0.9;
//     });

//     return highUsageMonths.length >= 3;
//   }

//   /**
//    * Get next higher tier
//    */
//   private getHigherTier(currentTier: UsageTier): UsageTier {
//     switch (currentTier) {
//       case UsageTier.STARTER:
//         return UsageTier.DEVELOPER;
//       case UsageTier.DEVELOPER:
//         return UsageTier.PROFESSIONAL;
//       case UsageTier.PROFESSIONAL:
//         return UsageTier.ENTERPRISE;
//       case UsageTier.ENTERPRISE:
//         return UsageTier.ENTERPRISE; // Already highest
//       default:
//         return UsageTier.DEVELOPER;
//     }
//   }

//   /**
//    * Get next lower tier
//    */
//   private getLowerTier(currentTier: UsageTier): UsageTier {
//     switch (currentTier) {
//       case UsageTier.STARTER:
//         return UsageTier.STARTER; // Already lowest
//       case UsageTier.DEVELOPER:
//         return UsageTier.STARTER;
//       case UsageTier.PROFESSIONAL:
//         return UsageTier.DEVELOPER;
//       case UsageTier.ENTERPRISE:
//         return UsageTier.PROFESSIONAL;
//       default:
//         return UsageTier.STARTER;
//     }
//   }

//   /**
//    * Get tier comparison for user decision making
//    */
//   getTierComparison(): Array<{
//     tier: UsageTier;
//     config: TierConfig;
//     monthlyCost: number; // Estimated at 50% usage
//     valueScore: number; // Features vs price ratio
//   }> {
//     return Array.from(this.defaultTierConfig.tiers.values())
//       .map((config) => {
//         const estimatedMonthlyRequests =
//           config.requestLimit === -1 ? 50000 : config.requestLimit * 0.5;
//         const monthlyCost =
//           estimatedMonthlyRequests * config.basePricePerRequest;

//         // Simple value score based on features and price
//         const featureScore = config.features.length;
//         const priceScore = monthlyCost > 0 ? 1000 / monthlyCost : 1000; // Inverse price relationship
//         const valueScore = featureScore * priceScore;

//         return {
//           tier: config.tier,
//           config,
//           monthlyCost,
//           valueScore,
//         };
//       })
//       .sort((a, b) => b.valueScore - a.valueScore);
//   }
// }
