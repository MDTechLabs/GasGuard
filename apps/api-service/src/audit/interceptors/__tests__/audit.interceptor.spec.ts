import { Test, TestingModule } from "@nestjs/testing";
// import { INestApplication } from '@nestjs/common';
import { AuditInterceptor } from "../../interceptors/audit.interceptor";
import { AuditLogService } from "../../services/audit-log.service";

describe("AuditInterceptor", () => {
  let interceptor: AuditInterceptor;
  let auditLogService: AuditLogService;

  beforeEach(() => {
    auditLogService = {
      emitApiRequest: jest.fn(),
    } as any;

    interceptor = new AuditInterceptor(auditLogService);
  });

  it("should be defined", () => {
    if (!interceptor) throw new Error("Interceptor not defined");
  });

  describe("API Key Extraction", () => {
    it("should extract API key from Bearer token", () => {
      const mockRequest = {
        headers: {
          authorization: "Bearer sk_prod_abcdef123456",
        },
        query: {},
      };

      const result = (interceptor as any).extractApiKey(mockRequest);
      if (result !== "sk_prod_abcdef123456")
        throw new Error("API key mismatch");
    });

    it("should extract API key from X-API-Key header", () => {
      const mockRequest = {
        headers: {
          "x-api-key": "sk_prod_xyz789",
        },
        query: {},
      };

      const result = (interceptor as any).extractApiKey(mockRequest);
      if (result !== "sk_prod_xyz789") throw new Error("X-API-Key mismatch");
    });

    it("should extract API key from query parameter", () => {
      const mockRequest = {
        headers: {},
        query: {
          apiKey: "sk_prod_query123",
        },
      };

      const result = (interceptor as any).extractApiKey(mockRequest);
      if (result !== "sk_prod_query123")
        throw new Error("Query param mismatch");
    });

    it("should return null if no API key found", () => {
      const mockRequest = {
        headers: {},
        query: {},
      };

      const result = (interceptor as any).extractApiKey(mockRequest);
      if (result !== null) throw new Error("Should be null");
    });

    it("should prioritize Authorization header over others", () => {
      const mockRequest = {
        headers: {
          authorization: "Bearer header_key",
          "x-api-key": "header_api_key",
        },
        query: {
          apiKey: "query_key",
        },
      };

      const result = (interceptor as any).extractApiKey(mockRequest);
      if (result !== "header_key") throw new Error("Header key mismatch");
    });
  });

  describe("URL Skip Patterns", () => {
    it("should skip health check endpoints", () => {
      if (!(interceptor as any).shouldSkipAudit("/health"))
        throw new Error("Should skip health");
      if (!(interceptor as any).shouldSkipAudit("/health/ready"))
        throw new Error("Should skip health/ready");
      if (!(interceptor as any).shouldSkipAudit("/health/live"))
        throw new Error("Should skip health/live");
    });

    it("should skip metrics endpoints", () => {
      if (!(interceptor as any).shouldSkipAudit("/metrics"))
        throw new Error("Should skip metrics");
    });

    it("should skip swagger endpoints", () => {
      if (!(interceptor as any).shouldSkipAudit("/swagger"))
        throw new Error("Should skip swagger");
      if (!(interceptor as any).shouldSkipAudit("/api-docs"))
        throw new Error("Should skip api-docs");
    });

    it("should not skip regular API endpoints", () => {
      if ((interceptor as any).shouldSkipAudit("/scanner/scan"))
        throw new Error("Should not skip scanner");
      if ((interceptor as any).shouldSkipAudit("/analyzer/analyze"))
        throw new Error("Should not skip analyzer");
      if ((interceptor as any).shouldSkipAudit("/api/endpoint"))
        throw new Error("Should not skip api/endpoint");
    });
  });
});
