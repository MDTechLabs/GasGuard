import { EntityRepository, Repository } from "typeorm";
import { Report } from "../entities/report.entity";

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
  ): Promise<Report[]> {
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

    return query.orderBy("report.createdAt", "DESC").getMany();
  }

  /**
   * Find reports by status
   */
  async findByStatus(status: string): Promise<Report[]> {
    return this.createQueryBuilder("report")
      .where("report.status = :status", { status })
      .orderBy("report.createdAt", "ASC")
      .getMany();
  }

  /**
   * Find pending scheduled reports
   */
  async findPendingScheduledReports(): Promise<Report[]> {
    return this.createQueryBuilder("report")
      .where("report.type = :type", { type: "scheduled" })
      .andWhere("report.status = :status", { status: "pending" })
      .andWhere("(report.scheduledAt IS NULL OR report.scheduledAt <= :now)", {
        now: new Date(),
      })
      .getMany();
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
