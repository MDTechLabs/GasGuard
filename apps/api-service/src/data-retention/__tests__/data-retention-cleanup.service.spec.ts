import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { DataRetentionCleanupService } from "../services/data-retention-cleanup.service";
import { AnalysisResult } from "../../database/entities/analysis-result.entity";
import { AuditLogService } from "../../audit/services/audit-log.service";
import * as retentionPolicyConfig from "../config/retention-policy.config";

describe("DataRetentionCleanupService", () => {
  let service: DataRetentionCleanupService;
  let configService: ConfigService;
  let auditLogService: AuditLogService;
  let analysisResultRepo: Repository<AnalysisResult>;

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockAuditLogService = {
    retentionCleanup: jest.fn(),
  };

  const mockQueryBuilder = {
    delete: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    execute: jest.fn(),
  };

  const mockAnalysisResultRepo = {
    createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataRetentionCleanupService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: AuditLogService, useValue: mockAuditLogService },
        {
          provide: getRepositoryToken(AnalysisResult),
          useValue: mockAnalysisResultRepo,
        },
      ],
    }).compile();

    service = module.get<DataRetentionCleanupService>(
      DataRetentionCleanupService,
    );
    configService = module.get<ConfigService>(ConfigService);
    auditLogService = module.get<AuditLogService>(AuditLogService);
    analysisResultRepo = module.get<Repository<AnalysisResult>>(
      getRepositoryToken(AnalysisResult),
    );

    jest.spyOn(retentionPolicyConfig, 'getRetentionPolicy').mockReturnValue({
      auditLogRetentionDays: 90,
      analysisResultRetentionDays: 180,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("runCleanup", () => {
    it("should perform cleanup based on retention policy", async () => {
      mockAuditLogService.retentionCleanup.mockResolvedValue(10);
      mockQueryBuilder.execute.mockResolvedValue({ affected: 5 });

      const result = await service.runCleanup();

      expect(result).toEqual({
        auditLogsDeleted: 10,
        analysisResultsDeleted: 5,
      });

      expect(mockAuditLogService.retentionCleanup).toHaveBeenCalledWith(90);
      
      expect(mockAnalysisResultRepo.createQueryBuilder).toHaveBeenCalled();
      expect(mockQueryBuilder.delete).toHaveBeenCalled();
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "createdAt < :cutoff",
        expect.any(Object),
      );
      expect(mockQueryBuilder.execute).toHaveBeenCalled();
    });

    it("should return 0 when affected is undefined", async () => {
      mockAuditLogService.retentionCleanup.mockResolvedValue(0);
      mockQueryBuilder.execute.mockResolvedValue({});

      const result = await service.runCleanup();

      expect(result).toEqual({
        auditLogsDeleted: 0,
        analysisResultsDeleted: 0,
      });
    });
  });

  describe("handleScheduledCleanup", () => {
    it("should log the result of runCleanup", async () => {
      jest.spyOn(service, "runCleanup").mockResolvedValue({
        auditLogsDeleted: 3,
        analysisResultsDeleted: 2,
      });

      await service.handleScheduledCleanup();

      expect(service.runCleanup).toHaveBeenCalled();
    });

    it("should handle errors gracefully", async () => {
      jest.spyOn(service, "runCleanup").mockRejectedValue(new Error("Test Error"));

      await expect(service.handleScheduledCleanup()).resolves.not.toThrow();

      expect(service.runCleanup).toHaveBeenCalled();
    });
  });
});
