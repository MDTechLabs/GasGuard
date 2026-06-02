import { Injectable } from "@nestjs/common";
import {
  FailedTransaction,
  FailureCategory,
  TransactionMetadata,
  RootCauseAnalysis,
  CostMetrics,
} from "../schemas/failed-transaction.schema";

@Injectable()
export class FailedTransactionService {
  private failedTransactions: Map<string, FailedTransaction> = new Map();
  private walletFailures: Map<string, FailedTransaction[]> = new Map();

  /**
   * Track a failed transaction
   */
  async trackFailedTransaction(
    transactionData: Partial<FailedTransaction>,
  ): Promise<FailedTransaction> {
    const category = await this.classifyFailure(transactionData);
    const rootCause = await this.analyzeRootCause(transactionData, category);

    const failedTx: FailedTransaction = {
      id: this.generateId(),
      hash: transactionData.hash!,
      wallet: transactionData.wallet!,
      chainId: transactionData.chainId!,
      blockNumber: transactionData.blockNumber,
      gasUsed: transactionData.gasUsed || "0",
      gasPrice: transactionData.gasPrice || "0",
      effectiveFee: this.calculateEffectiveFee(transactionData),
      failureCategory: category,
      revertReason:
        transactionData.revertReason || rootCause.evidence.join("; "),
      timestamp: transactionData.timestamp || new Date().toISOString(),
      metadata: transactionData.metadata!,
    };

    // Store transaction
    this.failedTransactions.set(failedTx.id, failedTx);

    // Update wallet failures
    const walletTxs = this.walletFailures.get(failedTx.wallet) || [];
    walletTxs.push(failedTx);
    this.walletFailures.set(failedTx.wallet, walletTxs);

    return failedTx;
  }

  /**
   * Get failed transactions for a wallet
   */
  async getWalletFailures(
    wallet: string,
    chainIds?: number[],
  ): Promise<FailedTransaction[]> {
    const failures = this.walletFailures.get(wallet) || [];

    if (chainIds && chainIds.length > 0) {
      return failures.filter((tx) => chainIds.includes(tx.chainId));
    }

    return failures;
  }

  /**
   * Classify the failure category based on transaction data
   */
  private async classifyFailure(
    transactionData: Partial<FailedTransaction>,
  ): Promise<FailureCategory> {
    const { revertReason, metadata, gasUsed, gasPrice } = transactionData;

    // Check for underpriced gas
    if (
      gasPrice &&
      (await this.isUnderpriced(gasPrice, transactionData.chainId!))
    ) {
      return "underpriced_gas";
    }

    // Check for out of gas
    if (gasUsed && metadata?.gasLimit) {
      const utilization =
        (parseInt(gasUsed) / parseInt(metadata.gasLimit)) * 100;
      if (utilization >= 99.5) {
        return "out_of_gas";
      }
    }

    // Check revert reason patterns
    if (revertReason) {
      const reason = revertReason.toLowerCase();

      if (reason.includes("insufficient funds") || reason.includes("balance")) {
        return "insufficient_balance";
      }

      if (reason.includes("nonce") || reason.includes("replacement")) {
        return "nonce_conflict";
      }

      if (
        reason.includes("slippage") ||
        reason.includes("too much requested")
      ) {
        return "slippage_exceeded";
      }

      if (reason.includes("revert") || reason.includes("require")) {
        return "contract_revert";
      }
    }

    // Check nonce conflicts
    if (metadata?.nonce !== undefined) {
      const walletTxs = this.walletFailures.get(transactionData.wallet!) || [];
      const hasSameNonce = walletTxs.some(
        (tx) =>
          tx.metadata.nonce === metadata.nonce &&
          tx.timestamp > new Date(Date.now() - 300000).toISOString(), // Last 5 minutes
      );

      if (hasSameNonce) {
        return "nonce_conflict";
      }
    }

    return "unknown";
  }

  /**
   * Analyze root cause with detailed evidence
   */
  private async analyzeRootCause(
    transactionData: Partial<FailedTransaction>,
    category: FailureCategory,
  ): Promise<RootCauseAnalysis> {
    const evidence: string[] = [];
    const patterns: any = {};

    switch (category) {
      case "underpriced_gas":
        evidence.push(`Gas price: ${transactionData.gasPrice} wei`);
        evidence.push(`Chain ID: ${transactionData.chainId}`);
        patterns.pricing = {
          gasPrice: transactionData.gasPrice!,
          networkGasPrice: await this.getNetworkGasPrice(
            transactionData.chainId!,
          ),
          deviation: await this.calculateGasPriceDeviation(
            transactionData.gasPrice!,
            transactionData.chainId!,
          ),
        };
        break;

      case "out_of_gas":
        evidence.push(`Gas used: ${transactionData.gasUsed}`);
        evidence.push(`Gas limit: ${transactionData.metadata?.gasLimit}`);
        if (transactionData.gasUsed && transactionData.metadata?.gasLimit) {
          const utilization =
            (parseInt(transactionData.gasUsed) /
              parseInt(transactionData.metadata.gasLimit)) *
            100;
          evidence.push(`Utilization: ${utilization.toFixed(2)}%`);
          patterns.gasUsage = {
            used: transactionData.gasUsed,
            limit: transactionData.metadata.gasLimit,
            utilization,
          };
        }
        break;

      case "slippage_exceeded":
        evidence.push(`Revert reason: ${transactionData.revertReason}`);
        evidence.push("DEX transaction detected");
        break;

      case "nonce_conflict":
        evidence.push(`Nonce: ${transactionData.metadata?.nonce}`);
        evidence.push("Duplicate nonce detected in recent transactions");
        break;

      case "insufficient_balance":
        evidence.push(`Value: ${transactionData.metadata?.value}`);
        evidence.push(`Gas cost: ${transactionData.effectiveFee}`);
        evidence.push(`Revert reason: ${transactionData.revertReason}`);
        break;
    }

    return {
      category,
      confidence: this.calculateConfidence(category, evidence),
      evidence,
      patterns,
    };
  }

  /**
   * Calculate cost metrics for a wallet
   */
  async calculateCostMetrics(
    wallet: string,
    chainIds?: number[],
  ): Promise<CostMetrics> {
    const failures = await this.getWalletFailures(wallet, chainIds);

    let totalGasWasted = BigInt(0);
    const wasteByCategory: Record<FailureCategory, string> = {} as any;
    const wasteByChain: Record<number, string> = {} as any;

    // Initialize category counters
    const categories: FailureCategory[] = [
      "underpriced_gas",
      "out_of_gas",
      "contract_revert",
      "slippage_exceeded",
      "nonce_conflict",
      "insufficient_balance",
      "network_error",
      "unknown",
    ];

    categories.forEach((cat) => {
      wasteByCategory[cat] = "0";
    });

    // Calculate totals
    failures.forEach((tx) => {
      const waste = BigInt(tx.effectiveFee);
      totalGasWasted += waste;

      // Add to category total
      wasteByCategory[tx.failureCategory] = (
        BigInt(wasteByCategory[tx.failureCategory]) + waste
      ).toString();

      // Add to chain total
      if (!wasteByChain[tx.chainId]) {
        wasteByChain[tx.chainId] = "0";
      }
      wasteByChain[tx.chainId] = (
        BigInt(wasteByChain[tx.chainId]) + waste
      ).toString();
    });

    // Calculate historical trend (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const dailyFailures = new Map<string, { waste: bigint; count: number }>();

    failures
      .filter((tx) => new Date(tx.timestamp) >= thirtyDaysAgo)
      .forEach((tx) => {
        const date = tx.timestamp.split("T")[0];
        const current = dailyFailures.get(date) || {
          waste: BigInt(0),
          count: 0,
        };
        current.waste += BigInt(tx.effectiveFee);
        current.count += 1;
        dailyFailures.set(date, current);
      });

    const historicalTrend = Array.from(dailyFailures.entries())
      .map(([date, data]) => ({
        date,
        waste: data.waste.toString(),
        failures: data.count,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      totalGasWasted: totalGasWasted.toString(),
      totalGasWastedUSD: await this.convertToUSD(totalGasWasted.toString()),
      averageWastePerFailure:
        failures.length > 0
          ? (totalGasWasted / BigInt(failures.length)).toString()
          : "0",
      wasteByCategory,
      wasteByChain,
      historicalTrend,
    };
  }

  /**
   * Helper methods
   */
  private generateId(): string {
    return `ft_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private calculateEffectiveFee(
    transactionData: Partial<FailedTransaction>,
  ): string {
    const gasUsed = BigInt(transactionData.gasUsed || "0");
    const gasPrice = BigInt(transactionData.gasPrice || "0");
    return (gasUsed * gasPrice).toString();
  }

  private async isUnderpriced(
    gasPrice: string,
    chainId: number,
  ): Promise<boolean> {
    const networkGasPrice = await this.getNetworkGasPrice(chainId);
    const deviation = await this.calculateGasPriceDeviation(gasPrice, chainId);
    return deviation < -20; // More than 20% below network gas price
  }

  private async getNetworkGasPrice(chainId: number): Promise<string> {
    // Mock implementation - in real scenario, this would call RPC
    const mockPrices: Record<number, string> = {
      1: "20000000000", // Ethereum mainnet
      137: "30000000000", // Polygon
      56: "5000000000", // BSC
      42161: "100000000", // Arbitrum
      10: "100000000", // Optimism
    };
    return mockPrices[chainId] || "20000000000";
  }

  private async calculateGasPriceDeviation(
    gasPrice: string,
    chainId: number,
  ): Promise<number> {
    const networkGasPrice = await this.getNetworkGasPrice(chainId);
    const price = BigInt(gasPrice);
    const network = BigInt(networkGasPrice);
    return Number(((price - network) * BigInt(100)) / network);
  }

  private calculateConfidence(
    category: FailureCategory,
    evidence: string[],
  ): number {
    // Base confidence by category
    const baseConfidence: Record<FailureCategory, number> = {
      underpriced_gas: 0.9,
      out_of_gas: 0.95,
      contract_revert: 0.8,
      slippage_exceeded: 0.85,
      nonce_conflict: 0.9,
      insufficient_balance: 0.95,
      network_error: 0.7,
      unknown: 0.3,
    };

    // Adjust based on evidence strength
    let confidence = baseConfidence[category];
    if (evidence.length > 2) confidence += 0.05;
    if (evidence.length > 4) confidence += 0.05;

    return Math.min(confidence, 1.0);
  }

  private async convertToUSD(weiAmount: string): Promise<number> {
    // Mock implementation - in real scenario, this would use price oracle
    const ethPriceUSD = 2000; // Mock ETH price
    const ethAmount = Number(weiAmount) / 1e18;
    return ethAmount * ethPriceUSD;
  }
}
