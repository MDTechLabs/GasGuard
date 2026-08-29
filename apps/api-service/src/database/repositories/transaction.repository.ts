import { EntityRepository, Repository } from "typeorm";
import { Transaction } from "../entities/transaction.entity";

@EntityRepository(Transaction)
export class TransactionRepository extends Repository<Transaction> {
  /**
   * Get gas usage aggregation per merchant
   */
  async getGasUsageByMerchant(
    merchantId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<any[]> {
    return this.createQueryBuilder("transaction")
      .select("DATE(transaction.createdAt)", "date")
      .addSelect("SUM(transaction.gasUsed)", "totalGasUsed")
      .addSelect("AVG(transaction.gasUsed)", "avgGasUsed")
      .addSelect("COUNT(transaction.id)", "transactionCount")
      .where("transaction.merchantId = :merchantId", { merchantId })
      .andWhere("transaction.createdAt BETWEEN :startDate AND :endDate", {
        startDate,
        endDate,
      })
      .andWhere("transaction.status = 'success'")
      .groupBy("DATE(transaction.createdAt)")
      .orderBy("date", "ASC")
      .getRawMany();
  }

  /**
   * Get transaction success metrics
   */
  async getTransactionSuccessMetrics(
    merchantId?: string,
    chainId?: string,
    startDate?: Date,
    endDate?: Date,
  ): Promise<any> {
    const query = this.createQueryBuilder("transaction")
      .select("COUNT(transaction.id)", "totalTransactions")
      .addSelect(
        "COUNT(CASE WHEN transaction.status = 'success' THEN 1 END)",
        "successfulTransactions",
      )
      .addSelect(
        "COUNT(CASE WHEN transaction.status = 'failed' THEN 1 END)",
        "failedTransactions",
      )
      .addSelect("AVG(transaction.gasUsed)", "avgGasUsed")
      .addSelect("SUM(transaction.transactionFee)", "totalFees");

    if (merchantId) {
      query.andWhere("transaction.merchantId = :merchantId", { merchantId });
    }

    if (chainId) {
      query.andWhere("transaction.chainId = :chainId", { chainId });
    }

    if (startDate && endDate) {
      query.andWhere("transaction.createdAt BETWEEN :startDate AND :endDate", {
        startDate,
        endDate,
      });
    }

    return query.getRawOne();
  }

  /**
   * Get recent high-gas transactions
   */
  async getHighGasTransactions(
    limit: number = 10,
    threshold: number = 1000000,
  ): Promise<Transaction[]> {
    return this.createQueryBuilder("transaction")
      .where("transaction.gasUsed > :threshold", { threshold })
      .andWhere("transaction.status = 'success'")
      .orderBy("transaction.gasUsed", "DESC")
      .limit(limit)
      .getMany();
  }

  /**
   * Get transaction volume by chain
   */
  async getTransactionVolumeByChain(
    startDate: Date,
    endDate: Date,
  ): Promise<any[]> {
    return this.createQueryBuilder("transaction")
      .select("transaction.chainId", "chainId")
      .addSelect("COUNT(transaction.id)", "transactionCount")
      .addSelect("SUM(transaction.gasUsed)", "totalGasUsed")
      .addSelect("AVG(transaction.gasUsed)", "avgGasUsed")
      .addSelect("SUM(transaction.transactionFee)", "totalFees")
      .where("transaction.createdAt BETWEEN :startDate AND :endDate", {
        startDate,
        endDate,
      })
      .groupBy("transaction.chainId")
      .orderBy("transactionCount", "DESC")
      .getRawMany();
  }

  /**
   * Get failed transaction analysis
   */
  async getFailedTransactionAnalysis(
    startDate: Date,
    endDate: Date,
  ): Promise<any[]> {
    return this.createQueryBuilder("transaction")
      .select("transaction.chainId", "chainId")
      .addSelect("transaction.errorMessage", "errorMessage")
      .addSelect("COUNT(transaction.id)", "count")
      .addSelect("AVG(transaction.gasUsed)", "avgGasUsed")
      .where("transaction.status = 'failed'")
      .andWhere("transaction.createdAt BETWEEN :startDate AND :endDate", {
        startDate,
        endDate,
      })
      .andWhere("transaction.errorMessage IS NOT NULL")
      .groupBy("transaction.chainId, transaction.errorMessage")
      .orderBy("count", "DESC")
      .limit(20)
      .getRawMany();
  }
}
