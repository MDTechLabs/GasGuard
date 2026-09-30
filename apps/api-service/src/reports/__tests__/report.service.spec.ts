import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ReportService } from "../services/report.service";
import { DataAggregationService } from "../services/data-aggregation.service";
import { ReportGenerationService } from "../services/report-generation.service";
import { EmailNotificationService } from "../services/email-notification.service";
import { Report } from "../entities/report.entity";
import { Merchant } from "../../database/entities/merchant.entity";
import { v4 as uuidv4 } from "uuid";

describe("ReportService", () => {
  let service: ReportService;
  let reportRepository: Repository<Report>;
  let merchantRepository: Repository<Merchant>;
  let dataAggregationService: DataAggregationService;
  let reportGenerationService: ReportGenerationService;
  let emailNotificationService: EmailNotificationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportService,
        {
          provide: getRepositoryToken(Report),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(Merchant),
          useClass: Repository,
        },
        {
          provide: DataAggregationService,
          useValue: {
            getWeeklyGasUsage: jest.fn(),
            getMonthlyGasUsage: jest.fn(),
            detectAbnormalUsage: jest.fn(),
          },
        },
        {
          provide: ReportGenerationService,
          useValue: {
            generateCsvReport: jest.fn(),
            generateHtmlReport: jest.fn(),
            generateTextReport: jest.fn(),
          },
        },
        {
          provide: EmailNotificationService,
          useValue: {
            sendGasReportEmail: jest.fn(),
            sendFailureNotification: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ReportService>(ReportService);
    reportRepository = module.get<Repository<Report>>(
      getRepositoryToken(Report),
    );
    merchantRepository = module.get<Repository<Merchant>>(
      getRepositoryToken(Merchant),
    );
    dataAggregationService = module.get<DataAggregationService>(
      DataAggregationService,
    );
    reportGenerationService = module.get<ReportGenerationService>(
      ReportGenerationService,
    );
    emailNotificationService = module.get<EmailNotificationService>(
      EmailNotificationService,
    );
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("generateAdhocReport", () => {
    it("should create a new ad-hoc report", async () => {
      const merchantId = "test-merchant-id";
      const period: "weekly" | "monthly" = "weekly";

      // Mock merchant repository to return a merchant
      jest.spyOnMerchantRepository().mockResolvedValue({
        id: merchantId,
        name: "Test Merchant",
        email: "test@example.com",
      } as Merchant);

      // Mock report repository save method
      const savedReport = {
        id: uuidv4(),
        type: "adhoc",
        period: "weekly",
        merchantId,
        status: "pending",
        startDate: new Date(),
        endDate: new Date(),
        scheduledAt: new Date(),
      };
      jest
        .spyOnReportRepository("save")
        .mockResolvedValue(savedReport as any);

      const result = await service.generateAdhocReport(merchantId, period);

      expect(result).toBeDefined();
      expect(typeof result).toBe("string"); // Should return report ID
      expect(jest.spyOnMerchantRepository()).toHaveBeenCalledWith({
        where: { id: merchantId },
      });
    });

    it("should persist the creator of the report for audit trailing", async () => {
      const merchantId = "test-merchant-id";
      const createdBy = "user-42";

      jest.spyOnMerchantRepository().mockResolvedValue({
        id: merchantId,
        name: "Test Merchant",
        email: "test@example.com",
      } as Merchant);

      const saveSpy = jest
        .spyOnReportRepository("save")
        .mockImplementation(async (report: Report) => report);

      await service.generateAdhocReport(merchantId, "weekly", createdBy);

      expect(saveSpy).toHaveBeenCalled();
      const persisted = saveSpy.mock.calls[0][0] as Report;
      expect(persisted.createdBy).toBe(createdBy);
    });

    it("should throw when the merchant does not exist", async () => {
      jest.spyOnMerchantRepository().mockResolvedValue(null);

      await expect(
        service.generateAdhocReport("missing-merchant", "weekly"),
      ).rejects.toThrow(/not found/);
    });
  });

  describe("getReportById", () => {
    it("should return a report by ID", async () => {
      const reportId = "test-report-id";
      const expectedReport = {
        id: reportId,
        type: "weekly",
        period: "weekly",
        merchantId: "test-merchant-id",
        status: "completed",
        startDate: new Date(),
        endDate: new Date(),
      } as Report;

      jest.spyOnReportRepository("findOne").mockResolvedValue(expectedReport);

      const result = await service.getReportById(reportId);

      expect(result).toEqual(expectedReport);
      expect(jest.spyOnReportRepository("findOne")).toHaveBeenCalledWith({
        where: { id: reportId },
      });
    });

    it("should return null when the report does not exist", async () => {
      jest.spyOnReportRepository("findOne").mockResolvedValue(null);

      const result = await service.getReportById("missing");

      expect(result).toBeNull();
    });
  });

  describe("getReportHistory", () => {
    it("should return report history for a merchant", async () => {
      const merchantId = "test-merchant-id";
      const expectedReports = [
        {
          id: "report-1",
          type: "weekly",
          period: "weekly",
          merchantId,
          status: "completed",
          startDate: new Date(),
          endDate: new Date(),
        },
      ] as Report[];

      const queryBuilderMock = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(expectedReports),
      };

      jest
        .spyOnReportRepository("createQueryBuilder")
        .mockReturnValue(queryBuilderMock as any);

      const result = await service.getReportHistory(merchantId);

      expect(result).toEqual(expectedReports);
      expect(queryBuilderMock.where).toHaveBeenCalledWith(
        "report.merchantId = :merchantId",
        { merchantId },
      );
    });
  });
});
