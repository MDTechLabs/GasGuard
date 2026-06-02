import { EntityRepository, Repository } from "typeorm";
import {
  SuspiciousGasPattern,
  SeverityLevel,
  PatternStatus,
} from "../entities/suspicious-gas-pattern.entity";

@EntityRepository(SuspiciousGasPattern)
export class SuspiciousGasPatternRepository extends Repository<SuspiciousGasPattern> {
  /**
   * Find pattern by account and chain
   */
  async findByAccountAndChain(
    accountAddress: string,
    chainId: number,
  ): Promise<SuspiciousGasPattern | null> {
    return this.findOne({
      where: { accountAddress, chainId },
      order: { createdAt: "DESC" },
    });
  }

  /**
   * Find active pattern by account, chain, and type
   */
  async findActiveByAccountChainAndType(
    accountAddress: string,
    chainId: number,
    patternType: string,
  ): Promise<SuspiciousGasPattern | null> {
    return this.findOne({
      where: {
        accountAddress,
        chainId,
        patternType,
        status: PatternStatus.ACTIVE,
      },
    });
  }

  /**
   * Find patterns by severity with pagination
   */
  async findBySeverity(
    severity: SeverityLevel,
    limit: number = 50,
    offset: number = 0,
  ): Promise<{ data: SuspiciousGasPattern[]; total: number }> {
    const query = this.createQueryBuilder("pattern")
      .where("pattern.severity = :severity", { severity })
      .orderBy("pattern.lastDetectedAt", "DESC")
      .skip(offset)
      .take(limit);

    const data = await query.getMany();
    const total = data.length;
    return { data, total };
  }

  /**
   * Find patterns by status
   */
  async findByStatus(
    status: PatternStatus,
    limit: number = 50,
    offset: number = 0,
  ): Promise<{ data: SuspiciousGasPattern[]; total: number }> {
    const query = this.createQueryBuilder("pattern")
      .where("pattern.status = :status", { status })
      .orderBy("pattern.lastDetectedAt", "DESC")
      .skip(offset)
      .take(limit);

    const data = await query.getMany();
    const total = data.length;
    return { data, total };
  }

  /**
   * Find all active flags
   */
  async findActiveFlags(
    limit: number = 100,
    offset: number = 0,
  ): Promise<{ data: SuspiciousGasPattern[]; total: number }> {
    const query = this.createQueryBuilder("pattern")
      .where("pattern.status = :status", { status: PatternStatus.ACTIVE })
      .orderBy("pattern.severity", "DESC")
      .skip(offset)
      .take(limit);

    const data = await query.getMany();
    const total = data.length;
    return { data, total };
  }

  /**
   * Find patterns by date range
   */
  async findByDateRange(
    from: Date,
    to: Date,
    limit: number = 100,
    offset: number = 0,
  ): Promise<{ data: SuspiciousGasPattern[]; total: number }> {
    const query = this.createQueryBuilder("pattern")
      .where("pattern.createdAt >= :from", { from })
      .andWhere("pattern.createdAt <= :to", { to })
      .orderBy("pattern.createdAt", "DESC")
      .skip(offset)
      .take(limit);

    const data = await query.getMany();
    const total = data.length;
    return { data, total };
  }

  /**
   * Update pattern status
   */
  async updateStatus(id: string, status: PatternStatus): Promise<void> {
    const pattern = await this.findOne({ where: { id } });
    if (pattern) {
      pattern.status = status;
      await this.save(pattern);
    }
  }

  /**
   * Get statistics for flagged accounts
   */
  async getFlaggedAccountsStats(): Promise<{
    totalFlags: number;
    bySeverity: { low: number; medium: number; high: number };
    byStatus: {
      active: number;
      reviewed: number;
      cleared: number;
      confirmed_abuse: number;
    };
    recentDetections: number;
  }> {
    const totalFlags = await this.count();

    const bySeverity = {
      low: await this.count({ where: { severity: SeverityLevel.LOW } }),
      medium: await this.count({ where: { severity: SeverityLevel.MEDIUM } }),
      high: await this.count({ where: { severity: SeverityLevel.HIGH } }),
    };

    const byStatus = {
      active: await this.count({ where: { status: PatternStatus.ACTIVE } }),
      reviewed: await this.count({ where: { status: PatternStatus.REVIEWED } }),
      cleared: await this.count({ where: { status: PatternStatus.CLEARED } }),
      confirmed_abuse: await this.count({
        where: { status: PatternStatus.CONFIRMED_ABUSE },
      }),
    };

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentPatterns = await this.createQueryBuilder("pattern")
      .where("pattern.createdAt > :twentyFourHoursAgo", { twentyFourHoursAgo })
      .getMany();
    const recentDetections = recentPatterns.length;

    return {
      totalFlags,
      bySeverity,
      byStatus,
      recentDetections,
    };
  }

  /**
   * Get patterns by chain
   */
  async getPatternsByChain(): Promise<Record<string, number>> {
    const results = await this.createQueryBuilder("pattern")
      .select("pattern.chainId", "chainId")
      .addSelect("COUNT(*)", "count")
      .groupBy("pattern.chainId")
      .getRawMany();

    const byChain: Record<string, number> = {};
    results.forEach((result) => {
      byChain[result.chainId] = parseInt(result.count, 10);
    });

    return byChain;
  }

  /**
   * Find patterns with filters
   */
  async findWithFilters(filters: {
    chainId?: number;
    severity?: SeverityLevel;
    status?: PatternStatus;
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
  }): Promise<{ data: SuspiciousGasPattern[]; total: number }> {
    const query = this.createQueryBuilder("pattern");

    if (filters.chainId !== undefined) {
      query.andWhere("pattern.chainId = :chainId", {
        chainId: filters.chainId,
      });
    }

    if (filters.severity) {
      query.andWhere("pattern.severity = :severity", {
        severity: filters.severity,
      });
    }

    if (filters.status) {
      query.andWhere("pattern.status = :status", { status: filters.status });
    }

    if (filters.from) {
      query.andWhere("pattern.createdAt >= :from", { from: filters.from });
    }

    if (filters.to) {
      query.andWhere("pattern.createdAt <= :to", { to: filters.to });
    }

    query.orderBy("pattern.lastDetectedAt", "DESC");

    const limit = filters.limit || 50;
    const offset = filters.offset || 0;
    query.skip(offset).take(limit);

    const data = await query.getMany();
    const total = data.length;

    return { data, total };
  }
}
