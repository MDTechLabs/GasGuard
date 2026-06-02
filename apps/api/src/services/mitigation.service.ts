import { Injectable } from "@nestjs/common";
import {
  FailureCategory,
  MitigationRecommendation,
  FailedTransaction,
  FailureAnalysis,
} from "../schemas/failed-transaction.schema";

@Injectable()
export class MitigationService {
  /**
   * Generate mitigation recommendations based on failure analysis
   */
  async generateRecommendations(
    analysis: FailureAnalysis,
  ): Promise<MitigationRecommendation[]> {
    const recommendations: MitigationRecommendation[] = [];

    // Generate recommendations based on top failure category
    const topCategory = analysis.topFailureCategory;
    recommendations.push(
      ...(await this.getCategorySpecificRecommendations(topCategory, analysis)),
    );

    // Generate recommendations based on patterns
    recommendations.push(
      ...(await this.getPatternBasedRecommendations(analysis)),
    );

    // Generate chain-specific recommendations
    recommendations.push(
      ...(await this.getChainSpecificRecommendations(analysis)),
    );

    // Sort by priority and return top recommendations
    return recommendations
      .sort(
        (a, b) =>
          this.getPriorityScore(b.priority) - this.getPriorityScore(a.priority),
      )
      .slice(0, 5); // Return top 5 recommendations
  }

  /**
   * Get category-specific mitigation recommendations
   */
  private async getCategorySpecificRecommendations(
    category: FailureCategory,
    analysis: FailureAnalysis,
  ): Promise<MitigationRecommendation[]> {
    const recommendations: MitigationRecommendation[] = [];

    switch (category) {
      case "underpriced_gas":
        recommendations.push({
          id: "increase_gas_price",
          category: "underpriced_gas",
          priority: "high",
          title: "Increase Gas Price",
          description:
            "Your transactions are failing due to gas prices that are too low for network conditions.",
          action: "Increase priority fee by 25-50% during peak hours",
          estimatedImpact: "Reduces failure rate by 80-90%",
          parameters: {
            priorityFeeIncrease: "30%",
            congestionMultiplier: 1.5,
          },
        });
        recommendations.push({
          id: "use_gas_tier",
          category: "underpriced_gas",
          priority: "medium",
          title: "Use Dynamic Gas Tiers",
          description:
            "Implement adaptive gas pricing based on network congestion.",
          action:
            "Use Medium/High gas tiers during peak hours, Low during off-peak",
          estimatedImpact: "Optimizes cost while maintaining reliability",
        });
        break;

      case "out_of_gas":
        recommendations.push({
          id: "increase_gas_limit",
          category: "out_of_gas",
          priority: "high",
          title: "Increase Gas Limit",
          description:
            "Transactions are failing due to insufficient gas limits.",
          action: "Increase gas limit by 20-30% for complex operations",
          estimatedImpact: "Eliminates out-of-gas failures",
          parameters: {
            gasLimitMultiplier: 1.25,
            minIncrease: "21000",
          },
        });
        recommendations.push({
          id: "gas_limit_optimization",
          category: "out_of_gas",
          priority: "medium",
          title: "Optimize Gas Limit Estimation",
          description: "Implement better gas estimation algorithms.",
          action:
            "Use historical data to predict gas requirements more accurately",
          estimatedImpact: "Reduces wasted gas by 15-25%",
        });
        break;

      case "slippage_exceeded":
        recommendations.push({
          id: "adjust_slippage",
          category: "slippage_exceeded",
          priority: "high",
          title: "Adjust Slippage Tolerance",
          description:
            "DEX trades are failing due to price movement exceeding slippage tolerance.",
          action: "Increase slippage tolerance to 1-2% during high volatility",
          estimatedImpact: "Reduces DEX failure rate by 70%",
          parameters: {
            defaultSlippage: "1%",
            highVolatilitySlippage: "2%",
          },
        });
        recommendations.push({
          id: "timing_optimization",
          category: "slippage_exceeded",
          priority: "medium",
          title: "Optimize Trading Timing",
          description: "Avoid trading during high volatility periods.",
          action: "Use volatility indicators to time trades optimally",
          estimatedImpact: "Improves success rate and reduces slippage",
        });
        break;

      case "nonce_conflict":
        recommendations.push({
          id: "nonce_management",
          category: "nonce_conflict",
          priority: "high",
          title: "Implement Nonce Management",
          description: "Transactions are failing due to nonce conflicts.",
          action: "Replace stuck transactions with higher gas prices",
          estimatedImpact: "Resolves stuck transactions immediately",
          parameters: {
            replacementMultiplier: 1.1,
            maxRetries: 3,
          },
        });
        break;

      case "insufficient_balance":
        recommendations.push({
          id: "balance_check",
          category: "insufficient_balance",
          priority: "high",
          title: "Pre-transaction Balance Check",
          description: "Transactions are failing due to insufficient balance.",
          action: "Verify balance + gas costs before submitting transactions",
          estimatedImpact: "Eliminates balance-related failures",
        });
        break;
    }

    return recommendations;
  }

  /**
   * Get pattern-based recommendations from failure patterns
   */
  private async getPatternBasedRecommendations(
    analysis: FailureAnalysis,
  ): Promise<MitigationRecommendation[]> {
    const recommendations: MitigationRecommendation[] = [];

    // Check for repeated failures
    if (analysis.totalFailures > 10) {
      recommendations.push({
        id: "batch_optimization",
        category: "unknown",
        priority: "medium",
        title: "Implement Batch Processing",
        description:
          "High failure rate suggests systematic issues with transaction handling.",
        action: "Group similar transactions and optimize batch processing",
        estimatedImpact: "Reduces overall failure rate by 40%",
      });
    }

    // Check for chain-specific patterns
    const chainIds = Object.keys(analysis.chainBreakdown).map(Number);
    if (chainIds.length > 3) {
      recommendations.push({
        id: "chain_optimization",
        category: "unknown",
        priority: "low",
        title: "Optimize Multi-chain Strategy",
        description:
          "Failures across multiple chains suggest suboptimal chain selection.",
        action: "Use chain-specific optimization strategies",
        estimatedImpact: "Improves cross-chain success rates",
      });
    }

    return recommendations;
  }

  /**
   * Get chain-specific recommendations
   */
  private async getChainSpecificRecommendations(
    analysis: FailureAnalysis,
  ): Promise<MitigationRecommendation[]> {
    const recommendations: MitigationRecommendation[] = [];

    for (const [chainId, stats] of Object.entries(analysis.chainBreakdown)) {
      const chainNum = parseInt(chainId);

      if (stats.failures > 5) {
        switch (chainNum) {
          case 1: // Ethereum Mainnet
            recommendations.push({
              id: `ethereum_optimization_${chainId}`,
              category: stats.mostCommonCategory,
              priority: "medium",
              title: "Ethereum Mainnet Optimization",
              description:
                "Optimize transactions for Ethereum mainnet conditions.",
              action: "Use EIP-1559 with dynamic base fee tracking",
              estimatedImpact: "Reduces mainnet failure rate by 30%",
            });
            break;

          case 137: // Polygon
            recommendations.push({
              id: `polygon_optimization_${chainId}`,
              category: stats.mostCommonCategory,
              priority: "medium",
              title: "Polygon Network Optimization",
              description: "Optimize for Polygon's faster block times.",
              action: "Reduce confirmation time expectations",
              estimatedImpact: "Improves Polygon success rates",
            });
            break;

          case 42161: // Arbitrum
            recommendations.push({
              id: `arbitrum_optimization_${chainId}`,
              category: stats.mostCommonCategory,
              priority: "medium",
              title: "Arbitrum Optimization",
              description: "Optimize for Arbitrum's L2 characteristics.",
              action: "Account for Arbitrum's gas pricing model",
              estimatedImpact: "Optimizes L2 transaction costs",
            });
            break;
        }
      }
    }

    return recommendations;
  }

  /**
   * Get real-time mitigation for a specific failed transaction
   */
  async getImmediateMitigation(
    transaction: FailedTransaction,
  ): Promise<MitigationRecommendation[]> {
    const recommendations: MitigationRecommendation[] = [];

    switch (transaction.failureCategory) {
      case "underpriced_gas":
        const suggestedGasPrice = await this.calculateOptimalGasPrice(
          transaction.chainId,
        );
        recommendations.push({
          id: "immediate_gas_increase",
          category: "underpriced_gas",
          priority: "high",
          title: "Immediate Gas Price Increase",
          description: "Replace transaction with higher gas price.",
          action: `Set gas price to ${suggestedGasPrice} wei`,
          estimatedImpact: "Immediate transaction confirmation",
          parameters: {
            suggestedGasPrice,
            replacementMultiplier: 1.1,
          },
        });
        break;

      case "out_of_gas":
        const suggestedGasLimit = this.calculateOptimalGasLimit(transaction);
        recommendations.push({
          id: "immediate_gas_limit_increase",
          category: "out_of_gas",
          priority: "high",
          title: "Immediate Gas Limit Increase",
          description: "Resubmit with higher gas limit.",
          action: `Set gas limit to ${suggestedGasLimit}`,
          estimatedImpact: "Transaction will execute successfully",
          parameters: {
            suggestedGasLimit,
          },
        });
        break;

      case "nonce_conflict":
        recommendations.push({
          id: "immediate_nonce_fix",
          category: "nonce_conflict",
          priority: "high",
          title: "Replace Stuck Transaction",
          description: "Cancel and replace the stuck transaction.",
          action: "Send 0 ETH transaction with same nonce and higher gas",
          estimatedImpact: "Clears nonce conflict immediately",
        });
        break;
    }

    return recommendations;
  }

  /**
   * Helper methods
   */
  private getPriorityScore(priority: string): number {
    const scores = { high: 3, medium: 2, low: 1 };
    return scores[priority as keyof typeof scores] || 0;
  }

  private async calculateOptimalGasPrice(chainId: number): Promise<string> {
    // Mock implementation - in real scenario, this would call gas price oracle
    const baseGasPrices: Record<number, string> = {
      1: "30000000000", // Ethereum mainnet
      137: "50000000000", // Polygon
      56: "10000000000", // BSC
      42161: "200000000", // Arbitrum
      10: "200000000", // Optimism
    };

    const basePrice = baseGasPrices[chainId] || "20000000000";
    const multiplier = 1.2; // 20% above base for reliability

    return (
      (BigInt(basePrice) * BigInt(Math.floor(multiplier * 100))) /
      BigInt(100)
    ).toString();
  }

  private calculateOptimalGasLimit(transaction: FailedTransaction): string {
    const currentLimit = BigInt(transaction.metadata.gasLimit);
    const used = BigInt(transaction.gasUsed);

    // Calculate utilization
    const utilization = Number((used * BigInt(100)) / currentLimit);

    if (utilization >= 99.5) {
      // Out of gas - increase by 30%
      return ((currentLimit * BigInt(130)) / BigInt(100)).toString();
    } else if (utilization >= 95) {
      // Near limit - increase by 20%
      return ((currentLimit * BigInt(120)) / BigInt(100)).toString();
    } else {
      // Moderate utilization - increase by 10%
      return ((currentLimit * BigInt(110)) / BigInt(100)).toString();
    }
  }
}
