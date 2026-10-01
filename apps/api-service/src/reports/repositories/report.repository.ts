import { EntityRepository, Repository } from "typeorm";
import { Report } from "../entities/report.entity";

/**
 * Access context used to enforce report access controls.
 * The repository must never return reports that are not visible to the
 * requesting principal.
 */
export interface ReportAccessContext {
  /** The user requesting access. */
  userId: string;
  /** Roles assigned to the user (e.g. "admin", "merchant", "auditor"). */
  roles: string[];
  /** Merchant the user belongs to, if any. */
  merchantId?: string;
  /** Optional explicit grants for specific report IDs. */
  grantedReportIds?: string[];
}

/**
 * Roles that are allowed to read any report regardless of ownership.
 */
const PRIVILEGED_ROLES = ["admin", "auditor"] as const;

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
   * Applies access control filters to a report query builder.
   *
   * The filter is fail-closed: if the context is missing or invalid,
   * the query will return no results.
   */
  private applyAccessControl(
    query: any,
    access?: ReportAccessContext,
  ): any {
    if (!access || !access.userId || !Array.isArray(access.roles)) {
      // Fail closed: no access context means no results.
      return query.andWhere("1 = 0");
    }

    const isPrivileged = access.roles.some((role) =>
      PRIVILEGED_ROLES.includes(role as (typeof PRIVILEGED_ROLES)[number]),
    );

    if (isPrivileged) {
      return query;
    }

    const grantedIds = Array.isArray(access.grantedReportIds)
      ? access.grantedReportIds.filter((id) => typeof id === "string" && id.length > 0)
      : [];

    // Non-privileged users may only see reports they own or were explicitly
    // granted access to.
    const conditions: string[] = [];
    const params: Record<string, unknown> = { userId: access.userId };

    conditions.push("report.createdBy = :userId");

    if (access.merchantId) {
      conditions.push("report.merchantId = :merchantId");
      params.merchantId = access.merchantId;
    }

    if (grantedIds.length > 0) {
      conditions.push("report.id IN (:...grantedIds)");
      params.grantedIds = grantedIds;
    }

    return query.andWhere(`(${conditions.join(" OR ")})`, params);
  }

  /**
   * Find reports by merchant ID and period
   */
  async findByMerchantAndPeriod(
    merchantId: string,
    period: string,
    startDate?: Date,
    endDate?: Date,
    pagination?: PaginationParams,
    access?: ReportAccessContext,
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

    this.applyAccessControl(query, access);

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
    access?: ReportAccessContext,
  ): Promise<PaginatedResult<Report>> {
    const { limit, offset } = normalizePagination(pagination);

    const query = this.createQueryBuilder("report")
      .where("report.status = :status", { status });

    this.applyAccessControl(query, access);

    const [data, total] = await query
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
    access?: ReportAccessContext,
  ): Promise<PaginatedResult<Report>> {
    const { limit, offset } = normalizePagination(pagination);

    const query = this.createQueryBuilder("report")
      .where("report.type = :type", { type: "scheduled" })
      .andWhere("report.status = :status", { status: "pending" })
      .andWhere("(report.scheduledAt IS NULL or report.scheduledAt <= :now)", {
        now: new Date(),
      });

    this.applyAccessControl(query, access);

    const [data, total] = await query
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
   * Find a single report by ID enforcing access controls.
   */
  async findAccessibleById(
    reportId: string,
    access?: ReportAccessContext,
  ): Promise<Report | undefined> {
    const query = this.createQueryBuilder("report").where("report.id = :reportId", {
      reportId,
    });

    this.applyAccessControl(query, access);

    return query.getOne();
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
