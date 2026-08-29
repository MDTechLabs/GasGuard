import { EntityRepository, Repository } from "typeorm";
import { Chain } from "../entities/chain.entity";

@EntityRepository(Chain)
export class ChainRepository extends Repository<Chain> {
  /**
   * Get chain reliability metrics
   */
  async getChainReliabilityMetrics(
    startDate: Date,
    endDate: Date,
  ): Promise<any[]> {
    return this.createQueryBuilder("chain")
      .select("chain.id", "chainId")
      .addSelect("chain.name", "chainName")
      .addSelect("chain.type", "chainType")
      .addSelect("chain.reliabilityScore", "reliabilityScore")
      .addSelect("chain.averageGasPrice", "averageGasPrice")
      .addSelect("chain.gasVolatility", "gasVolatility")
      .addSelect("chain.transactionCount", "totalTransactions")
      .addSelect("COUNT(transaction.id)", "recentTransactions")
      .addSelect(
        "COUNT(CASE WHEN transaction.status = 'success' THEN 1 END) * 100.0 / COUNT(transaction.id)",
        "successRate",
      )
      .leftJoin(
        "transaction",
        "transaction",
        "transaction.chainId = chain.chainId",
      )
      .where("transaction.createdAt BETWEEN :startDate AND :endDate", {
        startDate,
        endDate,
      })
      .groupBy(
        "chain.id, chain.name, chain.type, chain.reliabilityScore, chain.averageGasPrice, chain.gasVolatility, chain.transactionCount",
      )
      .orderBy("chain.reliabilityScore", "DESC")
      .getRawMany();
  }

  /**
   * Get gas volatility metrics
   */
  async getGasVolatilityMetrics(days: number = 30): Promise<any[]> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    return this.createQueryBuilder("chain")
      .select("chain.chainId", "chainId")
      .addSelect("chain.name", "chainName")
      .addSelect("STDDEV(transaction.gasUsed)", "gasVolatility")
      .addSelect("AVG(transaction.gasUsed)", "avgGasUsed")
      .addSelect("MIN(transaction.gasUsed)", "minGasUsed")
      .addSelect("MAX(transaction.gasUsed)", "maxGasUsed")
      .addSelect("COUNT(transaction.id)", "transactionCount")
      .leftJoin(
        "transaction",
        "transaction",
        "transaction.chainId = chain.chainId",
      )
      .where("transaction.createdAt >= :cutoffDate", { cutoffDate })
      .andWhere("transaction.status = 'success'")
      .groupBy("chain.chainId, chain.name")
      .having("COUNT(transaction.id) > 100") // Only include chains with sufficient data
      .orderBy("gasVolatility", "DESC")
      .getRawMany();
  }

  /**
   * Get chain performance ranking
   */
  async getChainPerformanceRanking(): Promise<any[]> {
    return this.createQueryBuilder("chain")
      .select("chain.chainId", "chainId")
      .addSelect("chain.name", "chainName")
      .addSelect("chain.type", "chainType")
      .addSelect("chain.reliabilityScore", "reliabilityScore")
      .addSelect("chain.averageGasPrice", "averageGasPrice")
      .addSelect("chain.transactionCount", "totalTransactions")
      .addSelect("chain.gasVolatility", "gasVolatility")
      .orderBy("chain.reliabilityScore", "DESC")
      .addOrderBy("chain.transactionCount", "DESC")
      .getRawMany();
  }

  /**
   * Update chain metrics from transaction data
   */
  async updateChainMetrics(chainId: string): Promise<void> {
    const result = await this.createQueryBuilder("chain")
      .select("AVG(transaction.gasUsed)", "avgGasPrice")
      .addSelect("STDDEV(transaction.gasUsed)", "gasVolatility")
      .addSelect("COUNT(transaction.id)", "transactionCount")
      .addSelect(
        "COUNT(CASE WHEN transaction.status = 'success' THEN 1 END) * 100.0 / COUNT(transaction.id)",
        "successRate",
      )
      .leftJoin(
        "transaction",
        "transaction",
        "transaction.chainId = chain.chainId",
      )
      .where("chain.chainId = :chainId", { chainId })
      .andWhere("transaction.status IN ('success', 'failed')")
      .groupBy("chain.chainId")
      .getRawOne();

    if (result) {
      await this.createQueryBuilder("chain")
        .update()
        .set({
          averageGasPrice: parseFloat(result.avgGasPrice),
          gasVolatility: parseFloat(result.gasVolatility),
          transactionCount: parseInt(result.transactionCount),
          reliabilityScore: parseFloat(result.successRate) || 100,
        })
        .where("chain.chainId = :chainId", { chainId })
        .execute();
    }
  }
}
