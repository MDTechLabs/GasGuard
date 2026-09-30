import { EntityRepository, Repository } from "typeorm";
import { Report } from "../entities/report.entity";

export interface PaginationParams {
  /** Maximum number of row to return. Defaults to 50. */
  limit?: number;
  /** Number of rows to skip. Defaults to 0. */
  offset?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

function normalizePagination(params?: PaginationParams): {
  limit: number;
  offset: number;
} {
  const rawLimit = params?.limit;
  const rawOffset = params?.offset;

  const limit =
    typeof rawLimit === "number" && Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
      : DEFAULT_LIMIT;

  const offset =
    typeof rawOffset === "number" && Number.isFinite(rawOffset) && rawOffset > 0
      ? Math.floor(rawOffset)
      : 0;

  return { limit, offset };
}

@EntityRepository(Report)
export class ReportRepository extends Repository<Report> {
  /**
   * Find reports by merchant ID and period
   */
  async findByMerchantAndPeriod(
    merchantId: string,
    period: string,
    startDate?: Date,
    endDate?: Date,
    pagination?: PaginationParams,
  ): Promise<PaginatedResult<Report>> {
    const { limit, offset } = normalizePagination(pagination);

    const query = this.createQueryBuilder("report")
      .where("report.merchantId = :merchantId", { merchantId })
      .andWhere("report.period = :period", { period });

    if (startDate && endDate) {
      query.andWhere(
        "report.startDate >= :startDate AND report.endDate <= :endDate",
        {
          startDate,
          endDate,
        },
      );
    }

    const [data, total] = await query
      .orderBy("report.createdAt", "DESC")
      .skip(offset)
      .take(limit)
      .getManyAndCount();

    return {
      data,
      total,
      limit,
      offset,
      hasMore: offset + data.length < total,
    };
  }

  /**
   * Find reports by status
   */
  async findByStatus(
    status: string,
    pagination?: PaginationParams,
  ): Promise<PaginatedResult<Report>> {
    const { limit, offset } = normalizePagination(pagination);

    const [data, total] = await this.createQueryBuilder("report")
      .where("report.status = :status", { status })
      .orderBy("report.createdAt", "ASC")
      .skip(offset)
      .take(limit)
      .getManyAndCount();

    return {
      data,
      total,
      limit,
      offset,
      hasMore: offset + data.length < total,
    };
  }

  /**
   * Find pending scheduled reports
   */
  async findPendingScheduledReports(
    pagination?: PaginationParams,
  ): Promise<PaginatedResult<Report>> {
    const { limit, offset } = normalizePagination(pagination);

    const [data, total] = await this.createQueryBuilder("report")
      .where("report.type = :type", { type: "scheduled" })
      .andWhere("report.status = :status", { status: "pending" })
      .andWhere("(report.scheduledAt IS NULL or report.scheduledAt <= :now)", {
        now: new Date(),
      })
      .orderBy("report.createdAt", "ASC")
      .skip(offset)
      .take(limit)
      .getManyAndCount();

    return {
      data,
      total,
      limit,
      offset,
      hasMore: offset + data.length < total,
    };
  }

  /**
   * Update report status
   */
  async updateReportStatus(
    reportId: string,
    status: string,
    sentAt?: Date,
  ): Promise<void> {
    const updateData: any = { status };
    if (sentAt) {
      updateData.sentAt = sentAt;
    }
    await this.update(reportId, updateData);
  }
}
