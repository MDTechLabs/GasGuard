  /**
   * Simulate the effects of upgrading a user to a new tier
   */
  @Post("simulate-upgrade")
  async simulateUpgrade(@Body() body: { userUsage: UserUsage; targetTier: UsageTier }) {
    try {
      const result = await this.tieredPricingService.simulateUpgrade(body.userUsage, body.targetTier);
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to simulate upgrade",
        HttpStatus.BAD_REQUEST,
      );
    }
  }
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { TieredPricingService } from "../services/tiered-pricing.service";
import { DynamicPricingService } from "../services/dynamic-pricing.service";
import { UsageTier, UserUsage } from "../interfaces/tiered-pricing.interface";

/**
 * TieredPricingController
 * Exposes tiered pricing endpoints for GasGuard
 */
@Controller("tiered-pricing")
export class TieredPricingController {
  constructor(
    private readonly tieredPricingService: TieredPricingService,
    private readonly dynamicPricingService: DynamicPricingService,
  ) {}

  /**
   * Get all available pricing tiers
   */
  @Get("tiers")
  getAllTiers() {
    return {
      success: true,
      data: this.tieredPricingService.getAllTiers(),
    };
  }

  /**
   * Get tier comparison with value analysis
   */
  @Get("tiers/comparison")
  getTierComparison() {
    const comparison = this.tieredPricingService.getTierComparison();

    return {
      success: true,
      data: {
        comparison,
        summary: {
          totalTiers: comparison.length,
          bestValue: comparison[0]?.tier || null,
          mostAffordable: comparison[comparison.length - 1]?.tier || null,
        },
      },
    };
  }

  /**
   * Get tier details by tier type
   */
  @Get("tiers/:tier")
  getTierDetails(@Param("tier") tier: string) {
    const tierEnum = tier.toUpperCase() as UsageTier;

    if (!Object.values(UsageTier).includes(tierEnum)) {
      throw new HttpException("Invalid tier specified", HttpStatus.BAD_REQUEST);
    }

    const tierConfig = this.tieredPricingService.getTierConfig(tierEnum);

    if (!tierConfig) {
      throw new HttpException(
        "Tier configuration not found",
        HttpStatus.NOT_FOUND,
      );
    }

    return {
      success: true,
      data: tierConfig,
    };
  }

  /**
   * Get tiered gas estimate
   */
  @Post("estimate")
  async getTieredEstimate(
    @Body()
    body: {
      chainId: string;
      gasUnits: number;
      userUsage: UserUsage;
      priority?: "low" | "normal" | "high" | "critical";
    },
  ) {
    try {
      const estimate =
        await this.dynamicPricingService.estimateGasPriceWithTier(
          body.chainId,
          body.gasUnits,
          body.userUsage,
          body.priority || "normal",
        );

      return {
        success: true,
        data: estimate,
      };
    } catch (error) {
      throw new HttpException(
        "Failed to generate tiered estimate",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get multiple tiered price options
   */
  @Post("estimate/multiple")
  async getMultipleTieredEstimates(
    @Body() body: { chainId: string; gasUnits: number; userUsage: UserUsage },
  ) {
    try {
      const estimates =
        await this.dynamicPricingService.getMultipleTieredPriceOptions(
          body.chainId,
          body.gasUnits,
          body.userUsage,
        );

      return {
        success: true,
        data: estimates,
      };
    } catch (error) {
      throw new HttpException(
        "Failed to generate multiple tiered estimates",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Validate user tier access
   */
  @Post("validate")
  async validateUserAccess(@Body() body: { userUsage: UserUsage }) {
    try {
      const validation =
        await this.dynamicPricingService.validateUserTierAccess(body.userUsage);

      return {
        success: true,
        data: validation,
      };
    } catch (error) {
      throw new HttpException(
        "Failed to validate user access",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get recommended tier based on usage
   */
  @Get("recommend/:monthlyRequests")
  getRecommendedTier(@Param("monthlyRequests") monthlyRequests: string) {
    const requests = parseInt(monthlyRequests, 10);

    if (isNaN(requests) || requests < 0) {
      throw new HttpException(
        "Invalid monthly requests value",
        HttpStatus.BAD_REQUEST,
      );
    }

    const recommendedTier =
      this.tieredPricingService.getRecommendedTier(requests);
    const tierConfig = this.tieredPricingService.getTierConfig(recommendedTier);

    return {
      success: true,
      data: {
        monthlyRequests: requests,
        recommendedTier,
        tierConfig,
        savings: this.tieredPricingService.calculateUpgradeSavings(
          UsageTier.STARTER,
          recommendedTier,
          0.00001, // Base cost example
        ),
      },
    };
  }

  /**
   * Calculate potential savings from tier upgrade
   */
  @Post("savings")
  calculateSavings(
    @Body()
    body: {
      currentTier: UsageTier;
      targetTier: UsageTier;
      baseCost: number;
    },
  ) {
    const savings = this.tieredPricingService.calculateUpgradeSavings(
      body.currentTier,
      body.targetTier,
      body.baseCost,
    );

    const currentConfig = this.tieredPricingService.getTierConfig(
      body.currentTier,
    );
    const targetConfig = this.tieredPricingService.getTierConfig(
      body.targetTier,
    );

    return {
      success: true,
      data: {
        currentTier: body.currentTier,
        targetTier: body.targetTier,
        baseCost: body.baseCost,
        monthlySavings: savings,
        annualSavings: savings * 12,
        savingsPercentage:
          currentConfig && targetConfig
            ? ((currentConfig.discountPercentage -
                targetConfig.discountPercentage) /
                currentConfig.discountPercentage) *
              100
            : 0,
        currentConfig,
        targetConfig,
      },
    };
  }

  /**
   * Check auto-upgrade eligibility
   */
  @Post("auto-upgrade-check")
  checkAutoUpgradeEligibility(@Body() body: { userUsage: UserUsage }) {
    const isEligible = this.tieredPricingService.shouldAutoUpgrade(
      body.userUsage,
    );
    const recommendedTier = this.tieredPricingService.getRecommendedTier(
      body.userUsage.currentMonthRequests,
    );

    return {
      success: true,
      data: {
        isEligible,
        currentTier: body.userUsage.currentTier,
        recommendedTier,
        shouldUpgrade: recommendedTier !== body.userUsage.currentTier,
        usageMetrics: {
          currentUsage: body.userUsage.currentMonthRequests,
          averageUsage: body.userUsage.averageRequestsPerMonth,
          peakUsage: body.userUsage.peakRequestsPerMonth,
        },
      },
    };
  }

  /**
   * Get tier transition preview
   */
  @Post("transition-preview")
  previewTierTransition(
    @Body()
    body: {
      userUsage: UserUsage;
      targetTier: UsageTier;
      reason:
        | "usage_upgrade"
        | "usage_downgrade"
        | "manual_upgrade"
        | "manual_downgrade";
    },
  ) {
    const currentConfig = this.tieredPricingService.getTierConfig(
      body.userUsage.currentTier,
    );
    const targetConfig = this.tieredPricingService.getTierConfig(
      body.targetTier,
    );

    if (!currentConfig || !targetConfig) {
      throw new HttpException(
        "Invalid tier configuration",
        HttpStatus.BAD_REQUEST,
      );
    }

    // Calculate proration (simplified example)
    const daysInMonth = 30;
    const remainingDays = 15; // Example: half month remaining
    const prorationFactor = remainingDays / daysInMonth;

    const preview = {
      fromTier: body.userUsage.currentTier,
      toTier: body.targetTier,
      reason: body.reason,
      effectiveDate: new Date(),
      prorationRequired: true,
      estimatedProrationCost:
        (targetConfig.basePricePerRequest - currentConfig.basePricePerRequest) *
        prorationFactor,
      benefits: {
        newRequestLimit: targetConfig.requestLimit,
        additionalRequests:
          targetConfig.requestLimit === -1
            ? "Unlimited"
            : targetConfig.requestLimit - currentConfig.requestLimit,
        newFeatures: targetConfig.features.filter(
          (f) => !currentConfig.features.includes(f),
        ),
        increasedRateLimit:
          targetConfig.rateLimitPerMinute - currentConfig.rateLimitPerMinute,
      },
      costs: {
        priceDifference:
          targetConfig.basePricePerRequest - currentConfig.basePricePerRequest,
        monthlyCostDifference:
          (targetConfig.basePricePerRequest -
            currentConfig.basePricePerRequest) *
          body.userUsage.averageRequestsPerMonth,
      },
    };

    return {
      success: true,
      data: preview,
    };
  }
}
