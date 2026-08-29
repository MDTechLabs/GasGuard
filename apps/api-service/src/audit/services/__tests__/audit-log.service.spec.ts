import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { AuditLogService } from "../audit-log.service";
import { AuditLogRepository } from "../audit-log.repository";
import { AuditEventEmitter } from "../audit-event-emitter";
import { AuditLog, EventType, OutcomeStatus } from "../../entities";

describe("AuditLogService", () => {
  let service: AuditLogService;

  beforeEach(async () => {
    const mockRepository = {
      save: () => Promise.resolve({}),
      find: () => Promise.resolve([]),
      findOne: () => Promise.resolve(null),
      delete: () => Promise.resolve({ affected: 0 }),
      createQueryBuilder: () => ({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogService,
        AuditLogRepository,
        AuditEventEmitter,
        {
          provide: getRepositoryToken(AuditLog),
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<AuditLogService>(AuditLogService);
  });

  it("should be defined", () => {
    if (!service) throw new Error("Service not defined");
  });

  it("should have queryLogs method", () => {
    if (typeof service.queryLogs !== "function")
      throw new Error("No queryLogs method");
  });

  it("should have exportLogs method", () => {
    if (typeof service.exportLogs !== "function")
      throw new Error("No exportLogs method");
  });

  it("should support event types", () => {
    if (
      !EventType.API_REQUEST ||
      !EventType.API_KEY_CREATED ||
      !EventType.GAS_TRANSACTION
    ) {
      throw new Error("Missing event types");
    }
  });

  it("should support outcome statuses", () => {
    if (
      !OutcomeStatus.SUCCESS ||
      !OutcomeStatus.FAILURE ||
      !OutcomeStatus.WARNING
    ) {
      throw new Error("Missing outcome statuses");
    }
  });
});
