import { EntityRepository, Repository } from "typeorm";
import { GasBaseline } from "../entities/gas-baseline.entity";

@EntityRepository(GasBaseline)
export class GasBaselineRepository extends Repository<GasBaseline> {
  /**
   * Find baseline by account and chain
   */
  async findByAccountAndChain(
    accountAddress: string,
    chainId: number,
  ): Promise<GasBaseline | null> {
    return this.findOne({
      where: { accountAddress, chainId },
    });
  }

  /**
   * Save or update baseline
   */
  async saveBaseline(baselineData: Partial<GasBaseline>): Promise<GasBaseline> {
    const existing = await this.findByAccountAndChain(
      baselineData.accountAddress!,
      baselineData.chainId!,
    );

    if (existing) {
      Object.assign(existing, baselineData);
      return this.save(existing);
    }

    const baseline = this.create(baselineData);
    return this.save(baseline);
  }

  /**
   * Update baseline
   */
  async updateBaseline(
    accountAddress: string,
    chainId: number,
    data: Partial<GasBaseline>,
  ): Promise<void> {
    const baseline = await this.findByAccountAndChain(accountAddress, chainId);
    if (baseline) {
      Object.assign(baseline, data);
      await this.save(baseline);
    }
  }

  /**
   * Delete old baselines
   */
  async deleteOldBaselines(olderThanDays: number): Promise<number> {
    const cutoffDate = new Date(
      Date.now() - olderThanDays * 24 * 60 * 60 * 1000,
    );

    const result = await this.createQueryBuilder()
      .delete()
      .where("lastUpdated < :cutoff", { cutoff: cutoffDate })
      .execute();

    return result.affected || 0;
  }

  /**
   * Get all baselines for a chain
   */
  async findByChain(chainId: number): Promise<GasBaseline[]> {
    return this.find({
      where: { chainId },
    });
  }
}
