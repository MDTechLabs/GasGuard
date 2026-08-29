import {
  Controller,
  Get,
  Post,
  Query,
  Param,
  HttpCode,
  HttpStatus,
  Logger,
  UseGuards,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiParam,
} from "@nestjs/swagger";
import { ReportService } from "../services/report.service";
import { Report } from "../entities/report.entity";
import { Roles, ViewerAndAbove, OperatorAndAbove } from "../../rbac/decorators";
import { RolesGuard } from "../../rbac/guards";
import { UserRole } from "../../rbac/enums";

@ApiTags("Reports")
@Controller("reports")
@UseGuards(RolesGuard)
export class ReportController {
  private readonly logger = new Logger(ReportController.name);

  constructor(private readonly reportService: ReportService) {}

  @Post("gas")
  @OperatorAndAbove()
  @ApiOperation({ summary: "Trigger ad-hoc gas report generation" })
  @ApiQuery({
    name: "merchantId",
    description: "ID of the merchant to generate report for",
    required: true,
  })
  @ApiQuery({
    name: "period",
    description: "Report period (weekly or monthly)",
    enum: ["weekly", "monthly"],
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: "Report generation triggered successfully",
  })
  @ApiResponse({ status: 400, description: "Invalid parameters" })
  @ApiResponse({
    status: 403,
    description: "Forbidden - requires operator or admin role",
  })
  @HttpCode(HttpStatus.OK)
  async generateGasReport(
    @Query("merchantId") merchantId: string,
    @Query("period") period: "weekly" | "monthly",
  ): Promise<{ reportId: string; message: string }> {
    try {
      this.logger.log(
        `Request to generate ${period} gas report for merchant ${merchantId}`,
      );

      const reportId = await this.reportService.generateAdhocReport(
        merchantId,
        period,
      );

      return {
        reportId,
        message: `Ad-hoc ${period} gas report generation initiated for merchant ${merchantId}`,
      };
    } catch (error) {
      this.logger.error(
        `Error generating ad-hoc gas report for merchant ${merchantId}`,
        error,
      );
      throw error;
    }
  }

  @Get("gas/status/:reportId")
  @ViewerAndAbove()
  @ApiOperation({ summary: "Check status of a gas report" })
  @ApiParam({
    name: "reportId",
    description: "ID of the report to check status for",
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: "Report status retrieved successfully",
    type: Report,
  })
  @ApiResponse({ status: 404, description: "Report not found" })
  @ApiResponse({
    status: 403,
    description: "Forbidden - requires authentication",
  })
  async getReportStatus(@Param("reportId") reportId: string): Promise<Report> {
    try {
      this.logger.log(`Request to check status of report ${reportId}`);

      const report = await this.reportService.getReportById(reportId);

      if (!report) {
        throw new Error(`Report with ID ${reportId} not found`);
      }

      return report;
    } catch (error) {
      this.logger.error(
        `Error getting report status for report ${reportId}`,
        error,
      );
      throw error;
    }
  }

  @Get("gas/history")
  @ViewerAndAbove()
  @ApiOperation({ summary: "Get report history for a merchant" })
  @ApiQuery({
    name: "merchantId",
    description: "ID of the merchant",
    required: true,
  })
  @ApiQuery({
    name: "period",
    description: "Report period (weekly or monthly)",
    enum: ["weekly", "monthly"],
    required: false,
  })
  @ApiQuery({
    name: "limit",
    description: "Number of reports to return",
    required: false,
    type: Number,
  })
  @ApiResponse({
    status: 200,
    description: "Report history retrieved successfully",
    type: [Report],
  })
  @ApiResponse({
    status: 403,
    description: "Forbidden - requires authentication",
  })
  async getReportHistory(
    @Query("merchantId") merchantId: string,
    @Query("period") period?: "weekly" | "monthly",
    @Query("limit") limit?: number,
  ): Promise<Report[]> {
    try {
      this.logger.log(
        `Request to get report history for merchant ${merchantId}`,
      );

      return await this.reportService.getReportHistory(
        merchantId,
        period,
        limit ? parseInt(limit.toString()) : 10,
      );
    } catch (error) {
      this.logger.error(
        `Error getting report history for merchant ${merchantId}`,
        error,
      );
      throw error;
    }
  }

  @Get("gas/download/:reportId")
  @ViewerAndAbove()
  @ApiOperation({ summary: "Download a generated gas report" })
  @ApiParam({
    name: "reportId",
    description: "ID of the report to download",
    required: true,
  })
  @ApiResponse({ status: 200, description: "Report downloaded successfully" })
  @ApiResponse({ status: 404, description: "Report not found or not ready" })
  @ApiResponse({
    status: 403,
    description: "Forbidden - requires authentication",
  })
  async downloadReport(@Param("reportId") reportId: string): Promise<any> {
    try {
      this.logger.log(`Request to download report ${reportId}`);

      const report = await this.reportService.getReportById(reportId);

      if (!report) {
        throw new Error(`Report with ID ${reportId} not found`);
      }

      if (report.status !== "completed") {
        throw new Error(
          `Report with ID ${reportId} is not ready for download. Current status: ${report.status}`,
        );
      }

      if (!report.reportUrl) {
        throw new Error(
          `Report with ID ${reportId} does not have a downloadable file`,
        );
      }

      // Return the report file
      return {
        reportId: report.id,
        downloadUrl: report.reportUrl,
        fileName: `gas-report-${report.period}-${report.merchantId}-${report.startDate.toISOString().split("T")[0]}.csv`,
        status: report.status,
      };
    } catch (error) {
      this.logger.error(`Error downloading report ${reportId}`, error);
      throw error;
    }
  }
}
