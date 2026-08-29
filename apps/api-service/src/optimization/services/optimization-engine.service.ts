import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { DataAnalysisService } from "./data-analysis.service";
import { OptimizationSuggestion } from "../entities/optimization-suggestion.entity";
import { v4 as uuidv4 } from "uuid";

export interface OptimizationSuggestionDto {
  type: string;
  description: string;
  estimatedSavingsUSD?: number;
  estimatedSavingsGas?: number;
  priority: number; // 1-5 scale, 5 being highest priority
  category?: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class OptimizationEngineService {
  private readonly logger = new Logger(OptimizationEngineService.name);

  constructor(
    private dataAnalysisService: DataAnalysisService,
    @InjectRepository(OptimizationSuggestion)
    private optimizationSuggestionRepository: Repository<OptimizationSuggestion>,
  ) {}

  /**
   * Generate optimization suggestions for a merchant
   */
  async generateOptimizationSuggestions(
    merchantId: string,
    daysBack: number = 30,
  ): Promise<OptimizationSuggestionDto[]> {
    try {
      // Get transaction analysis
      const analysis = await this.dataAnalysisService.getTransactionAnalysis(
        merchantId,
        daysBack,
      );

      const suggestions: OptimizationSuggestionDto[] = [];

      // 1. Chain Switch Recommendations
      suggestions.push(
        ...(await this.generateChainSwitchSuggestions(analysis)),
      );

      // 2. Timing Adjustment Recommendations
      suggestions.push(...this.generateTimingAdjustmentSuggestions(analysis));

      // 3. Batch Optimization Recommendations
      suggestions.push(...this.generateBatchOptimizationSuggestions(analysis));

      // 4. Failed Transaction Reduction Recommendations
      suggestions.push(
        ...this.generateFailedTransactionReductionSuggestions(analysis),
      );

      // 5. Gas Price Optimization Recommendations
      suggestions.push(
        ...this.generateGasPriceOptimizationSuggestions(analysis),
      );

      return suggestions;
    } catch (error) {
      this.logger.error(
        `Failed to generate optimization suggestions for merchant ${merchantId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Generate chain switch suggestions based on cost comparison
   */
  private async generateChainSwitchSuggestions(
    analysis: any,
  ): Promise<OptimizationSuggestionDto[]> {
    const suggestions: OptimizationSuggestionDto[] = [];

    // Find the most expensive chain and suggest switching to a cheaper alternative
    const expensiveChains = analysis.chainBreakdown
      .filter((chain: any) => chain.avgCostPerTransaction > 0)
      .sort(
        (a: any, b: any) => b.avgCostPerTransaction - a.avgCostPerTransaction,
      );

    if (expensiveChains.length > 1) {
      const mostExpensive = expensiveChains[0];
      const cheapest = expensiveChains[expensiveChains.length - 1];

      if (
        mostExpensive.avgCostPerTransaction >
        cheapest.avgCostPerTransaction * 1.5
      ) {
        // Calculate potential savings
        const transactionCount = mostExpensive.transactionCount;
        const costDifference =
          mostExpensive.avgCostPerTransaction - cheapest.avgCostPerTransaction;
        const estimatedSavings = transactionCount * costDifference;

        suggestions.push({
          type: "ChainSwitch",
          description: `Switch ${Math.round((transactionCount / analysis.transactionStats.totalTransactions) * 100)}% of transfers from ${mostExpensive.chainName} to ${cheapest.chainName} to reduce gas costs`,
          estimatedSavingsUSD: parseFloat(estimatedSavings.toFixed(2)),
          priority: 4, // High priority
          category: "gas",
          metadata: {
            fromChain: mostExpensive.chainId,
            toChain: cheapest.chainId,
            fromChainCost: mostExpensive.avgCostPerTransaction,
            toChainCost: cheapest.avgCostPerTransaction,
            transactionCount: transactionCount,
            percentageOfTotal: parseFloat(
              (
                (transactionCount /
                  analysis.transactionStats.totalTransactions) *
                100
              ).toFixed(2),
            ),
          },
        });
      }
    }

    return suggestions;
  }

  /**
   * Generate timing adjustment suggestions based on gas price patterns
   */
  private generateTimingAdjustmentSuggestions(
    analysis: any,
  ): OptimizationSuggestionDto[] {
    const suggestions: OptimizationSuggestionDto[] = [];

    // Find hours with lowest gas prices
    const sortedHours = [...analysis.timeBasedPatterns].sort(
      (a, b) => a.avgGasPrice - b.avgGasPrice,
    );
    const lowestCostHour = sortedHours[0];
    const highestCostHour = sortedHours[sortedHours.length - 1];

    if (
      highestCostHour &&
      lowestCostHour &&
      highestCostHour.avgGasPrice > lowestCostHour.avgGasPrice * 1.5
    ) {
      // Calculate potential savings if transactions were moved to low-cost hours
      const highCostTransactions = analysis.timeBasedPatterns
        .filter((hour: any) => hour.hour === highestCostHour.hour)
        .reduce((sum: number, hour: any) => sum + hour.transactionCount, 0);

      const costDifference =
        highestCostHour.avgGasPrice - lowestCostHour.avgGasPrice;
      const estimatedSavings = highCostTransactions * costDifference;

      suggestions.push({
        type: "TimingAdjustment",
        description: `Schedule contract interactions during low gas periods (UTC ${lowestCostHour.hour}:00–${lowestCostHour.hour + 1}:00)`,
        estimatedSavingsUSD: parseFloat(estimatedSavings.toFixed(2)),
        priority: 3, // Medium-high priority
        category: "gas",
        metadata: {
          optimalHour: lowestCostHour.hour,
          worstHour: highestCostHour.hour,
          avgGasPriceLow: lowestCostHour.avgGasPrice,
          avgGasPriceHigh: highestCostHour.avgGasPrice,
          highCostTransactionCount: highCostTransactions,
        },
      });
    }

    return suggestions;
  }

  /**
   * Generate batch optimization suggestions
   */
  private generateBatchOptimizationSuggestions(
    analysis: any,
  ): OptimizationSuggestionDto[] {
    const suggestions: OptimizationSuggestionDto[] = [];

    // Look for opportunities to batch multiple transactions
    // If a merchant has many small transactions, suggest batching them
    if (analysis.transactionStats.totalTransactions > 100) {
      // Estimate savings from batching - typically 20-30% reduction in gas
      const estimatedSavings = analysis.transactionStats.totalCostUSD * 0.2; // 20% savings estimate

      suggestions.push({
        type: "BatchOptimization",
        description: `Consider batching multiple transactions to reduce overall gas costs`,
        estimatedSavingsUSD: parseFloat(estimatedSavings.toFixed(2)),
        priority: 2, // Medium priority
        category: "gas",
        metadata: {
          totalTransactions: analysis.transactionStats.totalTransactions,
          transactionDensity: "high",
          estimatedSavingsPercentage: 20,
        },
      });
    }

    return suggestions;
  }

  /**
   * Generate failed transaction reduction suggestions
   */
  private generateFailedTransactionReductionSuggestions(
    analysis: any,
  ): OptimizationSuggestionDto[] {
    const suggestions: OptimizationSuggestionDto[] = [];

    // Check for high failure rate
    if (analysis.transactionStats.failedTransactions > 0) {
      const failureRate =
        analysis.transactionStats.failedTransactions /
        analysis.transactionStats.totalTransactions;

      if (failureRate > 0.05) {
        // More than 5% failure rate
        // Estimate cost of failed transactions
        const avgGasUsed = analysis.transactionStats.avgGasUsed;
        const failedGasWasted =
          analysis.transactionStats.failedTransactions * avgGasUsed;
        const estimatedSavings = failedGasWasted * 0.00000001; // Convert gas to USD approximation

        suggestions.push({
          type: "FailedTransactionReduction",
          description: `Reduce failed transactions which currently account for ${(failureRate * 100).toFixed(2)}% of all transactions`,
          estimatedSavingsUSD: parseFloat(estimatedSavings.toFixed(2)),
          priority: 5, // Highest priority
          category: "gas",
          metadata: {
            failureRate: failureRate,
            failedTransactionCount:
              analysis.transactionStats.failedTransactions,
            totalTransactionCount: analysis.transactionStats.totalTransactions,
            estimatedGasWasted: failedGasWasted,
          },
        });
      }
    }

    return suggestions;
  }

  /**
   * Generate gas price optimization suggestions
   */
  private generateGasPriceOptimizationSuggestions(
    analysis: any,
  ): OptimizationSuggestionDto[] {
    const suggestions: OptimizationSuggestionDto[] = [];

    // Check for high gas price volatility
    if (analysis.gasPriceVolatility.volatilityIndex > 0.5) {
      // High volatility
      const avgGasPrice = analysis.gasPriceVolatility.avgGasPrice;
      const minGasPrice = analysis.gasPriceVolatility.minGasPrice;
      const potentialSavings = (avgGasPrice - minGasPrice) * 0.1; // Estimate 10% of transactions could save

      suggestions.push({
        type: "GasPriceOptimization",
        description: `Monitor gas prices more closely and submit transactions during low price periods`,
        estimatedSavingsUSD: parseFloat(potentialSavings.toFixed(2)),
        priority: 3, // Medium priority
        category: "gas",
        metadata: {
          volatilityIndex: analysis.gasPriceVolatility.volatilityIndex,
          avgGasPrice: avgGasPrice,
          minGasPrice: minGasPrice,
          maxGasPrice: analysis.gasPriceVolatility.maxGasPrice,
        },
      });
    }

    return suggestions;
  }

  /**
   * Save optimization suggestions to the database
   */
  async saveOptimizationSuggestions(
    merchantId: string,
    suggestions: OptimizationSuggestionDto[],
  ): Promise<string[]> {
    const savedSuggestionIds: string[] = [];

    for (const suggestion of suggestions) {
      const newSuggestion = new OptimizationSuggestion();
      newSuggestion.id = uuidv4();
      newSuggestion.merchantId = merchantId;
      newSuggestion.type = suggestion.type;
      newSuggestion.description = suggestion.description;
      newSuggestion.category = suggestion.category;
      newSuggestion.estimatedSavingsUSD = suggestion.estimatedSavingsUSD;
      newSuggestion.estimatedSavingsGas = suggestion.estimatedSavingsGas;
      newSuggestion.priority = suggestion.priority;
      newSuggestion.metadata = suggestion.metadata;
      newSuggestion.status = "pending";

      // Set expiration date to 30 days from now
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);
      newSuggestion.expiresAt = expiresAt;

      const savedSuggestion =
        await this.optimizationSuggestionRepository.save(newSuggestion);
      savedSuggestionIds.push(savedSuggestion.id);
    }

    return savedSuggestionIds;
  }

  /**
   * Get all optimization suggestions for a merchant
   */
  async getOptimizationSuggestions(
    merchantId: string,
    status?: string,
  ): Promise<OptimizationSuggestion[]> {
    const query = this.optimizationSuggestionRepository
      .createQueryBuilder("suggestion")
      .where("suggestion.merchantId = :merchantId", { merchantId });

    if (status) {
      query.andWhere("suggestion.status = :status", { status });
    }

    // Order by priority (descending) and then by creation date (descending)
    return query
      .orderBy("suggestion.priority", "DESC")
      .addOrderBy("suggestion.createdAt", "DESC")
      .getMany();
  }

  /**
   * Mark a suggestion as applied
   */
  async markSuggestionAsApplied(suggestionId: string): Promise<void> {
    await this.optimizationSuggestionRepository.update(suggestionId, {
      status: "applied",
      appliedAt: new Date(),
    });
  }

  /**
   * Get summary of optimization opportunities
   */
  async getOptimizationSummary(merchantId: string): Promise<{
    totalPotentialSavingsUSD: number;
    totalSuggestions: number;
    highPrioritySuggestions: number;
    appliedSuggestions: number;
  }> {
    const allSuggestions = await this.getOptimizationSuggestions(merchantId);

    const totalPotentialSavingsUSD = allSuggestions
      .filter((s) => s.status === "pending")
      .reduce((sum, s) => sum + (s.estimatedSavingsUSD || 0), 0);

    const highPrioritySuggestions = allSuggestions.filter(
      (s) => s.priority >= 4 && s.status === "pending",
    ).length;
    const appliedSuggestions = allSuggestions.filter(
      (s) => s.status === "applied",
    ).length;

    return {
      totalPotentialSavingsUSD: parseFloat(totalPotentialSavingsUSD.toFixed(2)),
      totalSuggestions: allSuggestions.length,
      highPrioritySuggestions,
      appliedSuggestions,
    };
  }
}
