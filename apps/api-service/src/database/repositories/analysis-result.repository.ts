import { EntityRepository, Repository } from "typeorm";
import { AnalysisResult } from "../entities/analysis-result.entity";

@EntityRepository(AnalysisResult)
export class AnalysisResultRepository extends Repository<AnalysisResult> {
  /**
   * Get analysis results summary
   */
  async getAnalysisSummary(
    merchantId?: string,
    chainId?: string,
    startDate?: Date,
    endDate?: Date,
  ): Promise<any> {
    const query = this.createQueryBuilder("analysis")
      .select("COUNT(analysis.id)", "totalAnalyses")
      .addSelect("AVG(analysis.violationCount)", "avgViolations")
      .addSelect("SUM(analysis.violationCount)", "totalViolations")
      .addSelect("AVG(analysis.estimatedGasSavings)", "avgGasSavings")
      .addSelect("SUM(analysis.estimatedGasSavings)", "totalGasSavings");

    if (merchantId) {
      query.andWhere("analysis.merchantId = :merchantId", { merchantId });
    }

    if (chainId) {
      query.andWhere("analysis.chainId = :chainId", { chainId });
    }

    if (startDate && endDate) {
      query.andWhere("analysis.createdAt BETWEEN :startDate AND :endDate", {
        startDate,
        endDate,
      });
    }

    return query.getRawOne();
  }

  /**
   * Get top rule violations
   */
  async getTopRuleViolations(
    limit: number = 10,
    startDate?: Date,
    endDate?: Date,
  ): Promise<any[]> {
    const query = this.createQueryBuilder("analysis")
      .select("violation->>'ruleName'", "ruleName")
      .addSelect("COUNT(*)", "violationCount")
      .addSelect("SUM(analysis.estimatedGasSavings)", "totalGasSavings")
      .leftJoin(
        "jsonb_array_elements(analysis.findings)",
        "violation",
        "violation->>'ruleName' IS NOT NULL",
      )
      .groupBy("violation->>'ruleName'")
      .orderBy("violationCount", "DESC")
      .limit(limit);

    if (startDate && endDate) {
      query.andWhere("analysis.createdAt BETWEEN :startDate AND :endDate", {
        startDate,
        endDate,
      });
    }

    return query.getRawMany();
  }

  /**
   * Get language distribution
   */
  async getLanguageDistribution(
    startDate?: Date,
    endDate?: Date,
  ): Promise<any[]> {
    const query = this.createQueryBuilder("analysis")
      .select("analysis.language", "language")
      .addSelect("COUNT(analysis.id)", "analysisCount")
      .addSelect("AVG(analysis.violationCount)", "avgViolations")
      .addSelect("SUM(analysis.estimatedGasSavings)", "totalGasSavings")
      .groupBy("analysis.language")
      .orderBy("analysisCount", "DESC");

    if (startDate && endDate) {
      query.andWhere("analysis.createdAt BETWEEN :startDate AND :endDate", {
        startDate,
        endDate,
      });
    }

    return query.getRawMany();
  }

  /**
   * Get analysis trend over time
   */
  async getAnalysisTrend(days: number = 30): Promise<any[]> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    return this.createQueryBuilder("analysis")
      .select("DATE_TRUNC('day', analysis.createdAt)", "date")
      .addSelect("COUNT(analysis.id)", "analysisCount")
      .addSelect("AVG(analysis.violationCount)", "avgViolations")
      .addSelect("SUM(analysis.estimatedGasSavings)", "dailyGasSavings")
      .where("analysis.createdAt >= :cutoffDate", { cutoffDate })
      .groupBy("DATE_TRUNC('day', analysis.createdAt)")
      .orderBy("date", "ASC")
      .getRawMany();
  }

  /**
   * Issue #1236: tenant-scoped lookup. Always filters by merchantId so a
   * caller can never read another tenant's analysis by guessing an id.
   */
  async findOneForMerchant(
    id: string,
    merchantId: string,
  ): Promise<AnalysisResult | undefined> {
    if (!merchantId) {
      throw new Error("merchantId is required for tenant-scoped queries");
    }
    return this.findOne({ where: { id, merchantId } });
  }

  /**
   * Issue #1234: idempotent ingestion. The key is stored in
   * metadata.idempotencyKey and scoped per merchant; a repeat call with the
   * same key returns the existing row instead of inserting a duplicate.
   * A transaction-scoped advisory lock serialises concurrent first-writes.
   */
  async saveIdempotent(
    merchantId: string,
    idempotencyKey: string,
    data: Partial<AnalysisResult>,
  ): Promise<{ result: AnalysisResult; created: boolean }> {
    if (!merchantId || !idempotencyKey) {
      throw new Error("merchantId and idempotencyKey are required");
    }
    return this.manager.transaction(async (em) => {
      await em.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `${merchantId}:${idempotencyKey}`,
      ]);
      const existing = await em
        .createQueryBuilder(AnalysisResult, "analysis")
        .where("analysis.merchantId = :merchantId", { merchantId })
        .andWhere("analysis.metadata->>'idempotencyKey' = :idempotencyKey", {
          idempotencyKey,
        })
        .getOne();
      if (existing) {
        return { result: existing, created: false };
      }
      const entity = em.create(AnalysisResult, {
        ...data,
        merchantId,
        metadata: { ...(data.metadata || {}), idempotencyKey },
      });
      return { result: await em.save(entity), created: true };
    });
  }
}
