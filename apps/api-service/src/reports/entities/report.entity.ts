import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

export interface ReportPaginationQuery {
  page?: number;
  limit?: number;
  type?: string;
  period?: string;
  merchantId?: string;
  chainId?: string;
  status?: string;
  startDateFrom?: Date;
  startDateTo?: Date;
  endDateFrom?: Date;
  endDateTo?: Date;
  createdAtFrom?: Date;
  createdAtTo?: Date;
  sortField?: keyof Report;
  sortOrder?: "ASC" | "DESC";
}

export interface ReportPaginationResult {
  data: Report[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export const REPORT_PAGINATION_DEFAULTS = {
  page: 1,
  limit: 20,
  maxLimit: 100,
  sortField: "createdAt" as keyof Report,
  sortOrder: "DESC" as const,
};

export function normalizeReportPaginationQuery(
  query: ReportPaginationQuery = {},
): Required<Pick<ReportPaginationQuery, "page" | "limit" | "sortField" | "sortOrder">> &
  Omit<ReportPaginationQuery, "page" | "limit" | "sortField" | "sortOrder"> {
  const rawPage = Number(query.page ?? REPORT_PAGINATION_DEFAULTS.page);
  const rawLimit = Number(query.limit ?? REPORT_PAGINATION_DEFAULTS.limit);

  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : REPORT_PAGINATION_DEFAULTS.page;
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(Math.floor(rawLimit), REPORT_PAGINATION_DEFAULTS.maxLimit)
    : REPORT_PAGINATION_DEFAULTS.limit;

  const sortOrder = query.sortOrder === "ASC" ? "ASC" : "DESC";
  const sortField = query.sortField ?? REPORT_PAGINATION_DEFAULTS.sortField;

  return {
    ...query,
    page,
    limit,
    sortField,
    sortOrder,
  };
}

export function buildReportPaginationResult(
  data: Report[],
  total: number,
  page: number,
  limit: number,
): ReportPaginationResult {
  const safeTotal = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : REPORT_PAGINATION_DEFAULTS.limit;
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : REPORT_PAGINATION_DEFAULTS.page;
  const totalPages = safeTotal === 0 ? 0 : Math.ceil(safeTotal / safeLimit);

  return {
    data,
    total: safeTotal,
    page: safePage,
    limit: safeLimit,
    totalPages: totalPages,
    hasNextPage: totalPages > 0 && safePage < totalPages,
    hasPreviousPage: safePage > 1 && totalPages > 0,
  };
}

@Entity("reports")
export class Report {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 100 })
  @Index("idx_report_type")
  type: string; // 'weekly', 'monthly', 'adhoc'

  @Column({ type: "varchar", length: 100 })
  @Index("idx_report_period")
  period: string; // 'weekly', 'monthly'

  @Column({ type: "varchar", length: 100 })
  @Index("idx_report_merchant_id")
  merchantId: string;

  @Column({ type: "varchar", length: 50, nullable: true })
  @Index("idx_report_chain_id")
  chainId?: string;

  @Column({ type: "varchar", length: 50 })
  @Index("idx_report_status")
  status: string; // 'pending', 'processing', 'completed', 'failed'

  @Column({ type: "varchar", length: 500, nullable: true })
  reportUrl?: string;

  @Column({ type: "jsonb", nullable: true })
  reportData?: Record<string, any>;

  @Column({ type: "jsonb", nullable: true })
  metadata?: Record<string, any>;

  @Column({ type: "timestamp" })
  @Index("idx_report_start_date")
  startDate: Date;

  @Column({ type: "timestamp" })
  @Index("idx_report_end_date")
  endDate: Date;

  @CreateDateColumn()
  @Index("idx_report_created_at")
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: "timestamp", nullable: true })
  @Index("idx_report_scheduled_at")
  scheduledAt?: Date;

  @Column({ type: "timestamp", nullable: true })
  @Index("idx_report_sent_at")
  sentAt?: Date;
}
