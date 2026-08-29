import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { AuditLog, EventType, OutcomeStatus } from "../entities";
import { AuditLogService } from "../services/audit-log.service";

describe("AuditController (e2e)", () => {
  let auditLogService: AuditLogService;

  beforeEach(async () => {
    const mockRepository = {
      save: () => Promise.resolve({}),
      find: () => Promise.resolve([]),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogService,
        {
          provide: getRepositoryToken(AuditLog),
          useValue: mockRepository,
        },
      ],
    }).compile();

    auditLogService = moduleFixture.get<AuditLogService>(AuditLogService);
  });

  it("should be able to instantiate service", () => {
    if (!auditLogService) throw new Error("Service not defined");
  });

  it("should have queryLogs method", () => {
    if (typeof auditLogService.queryLogs !== "function")
      throw new Error("No queryLogs");
  });

  it("should support event types", () => {
    if (
      !EventType.API_REQUEST ||
      !EventType.API_KEY_CREATED ||
      !OutcomeStatus.SUCCESS
    ) {
      throw new Error("Missing types");
    }
  });
});
