import { EntityRepository, Repository } from "typeorm";
import { Merchant } from "../entities/merchant.entity";

@EntityRepository(Merchant)
export class MerchantRepository extends Repository<Merchant> {
  /**
   * Get merchant analytics summary
   */
  async getMerchantAnalytics(startDate: Date, endDate: Date): Promise<any[]> {
    return this.createQueryBuilder("merchant")
      .select("merchant.id", "merchantId")
      .addSelect("merchant.name", "merchantName")
      .addSelect("merchant.plan", "plan")
      .addSelect("merchant.status", "status")
      .addSelect("COUNT(transaction.id)", "transactionCount")
      .addSelect("SUM(transaction.gasUsed)", "totalGasUsed")
      .addSelect("SUM(transaction.transactionFee)", "totalFees")
      .addSelect("AVG(transaction.gasUsed)", "avgGasUsed")
      .leftJoin(
        "transaction",
        "transaction",
        "transaction.merchantId = merchant.id",
      )
      .where("transaction.createdAt BETWEEN :startDate AND :endDate", {
        startDate,
        endDate,
      })
      .groupBy("merchant.id, merchant.name, merchant.plan, merchant.status")
      .orderBy("transactionCount", "DESC")
      .getRawMany();
  }

  /**
   * Get active merchants
   */
  async getActiveMerchants(days: number = 30): Promise<Merchant[]> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    return this.createQueryBuilder("merchant")
      .where("merchant.status = :status", { status: "active" })
      .andWhere("merchant.lastActiveAt >= :cutoffDate", { cutoffDate })
      .orderBy("merchant.lastActiveAt", "DESC")
      .getMany();
  }

  /**
   * Get merchant growth statistics
   */
  async getMerchantGrowthStats(startDate: Date, endDate: Date): Promise<any> {
    const totalMerchants = await this.count({
      where: {
        createdAt: new Date(startDate),
      },
    });

    const newMerchants = await this.count({
      where: {
        createdAt: new Date(endDate),
      },
    });

    const activeMerchants = await this.count({
      where: {
        status: "active",
      },
    });

    return {
      totalMerchants,
      newMerchants,
      activeMerchants,
      growthRate:
        totalMerchants > 0 ? (newMerchants / totalMerchants) * 100 : 0,
    };
  }
}
