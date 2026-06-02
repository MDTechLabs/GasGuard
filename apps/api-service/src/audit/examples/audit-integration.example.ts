import { Injectable } from "@nestjs/common";
import { AuditLogService } from "../../audit/services/audit-log.service";
import { EventType } from "../../audit/entities";

/**
 * EXAMPLE: Integration of Audit Logging in API Key Management Service
 * This demonstrates how to use the audit logging system in your services
 */
@Injectable()
export class ApiKeyManagementExample {
  constructor(
    private readonly auditLogService: AuditLogService,
    // ... other dependencies
  ) {}

  async createApiKeyExample(merchantId: string, keyDetails: any) {
    // Business logic to create API key
    const newKey = {
      id: "key_" + Date.now(),
      name: keyDetails.name,
      status: "active",
      role: keyDetails.role || "user",
      createdAt: new Date(),
    };

    // ✅ Emit audit event for key creation
    this.auditLogService.emitApiKeyEvent(
      EventType.API_KEY_CREATED,
      merchantId,
      {
        keyId: newKey.id,
        keyName: newKey.name,
        role: newKey.role,
        expiresAt: keyDetails.expiresAt || null,
      },
    );

    return newKey;
  }

  async rotateApiKeyExample(merchantId: string, oldKeyId: string) {
    const newKeyId = "key_" + Date.now();

    // Business logic to rotate key

    // ✅ Emit audit event for key rotation
    this.auditLogService.emitApiKeyEvent(
      EventType.API_KEY_ROTATED,
      merchantId,
      {
        oldKeyId,
        newKeyId,
        reason: "scheduled rotation",
        timestamp: new Date(),
      },
    );

    return newKeyId;
  }

  async revokeApiKeyExample(merchantId: string, keyId: string, reason: string) {
    // Business logic to revoke key

    // ✅ Emit audit event for key revocation
    this.auditLogService.emitApiKeyEvent(
      EventType.API_KEY_REVOKED,
      merchantId,
      {
        revokedKeyId: keyId,
        reason: reason || "user-initiated",
        revokedAt: new Date(),
      },
    );
  }
}

/**
 * EXAMPLE: Integration of Audit Logging in Gas Transaction Service
 */
@Injectable()
export class GasTransactionServiceExample {
  constructor(
    private readonly auditLogService: AuditLogService,
    // ... other dependencies
  ) {}

  async submitGasTransactionExample(
    merchantId: string,
    chainId: number,
    txData: any,
  ) {
    // Business logic to submit gas transaction
    const result = {
      transactionHash:
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      gasUsed: 21000,
      gasPrice: "45 gwei",
      senderAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      method: "transfer",
      value: "1.5",
    };

    // ✅ Emit audit event for gas transaction
    this.auditLogService.emitGasTransaction(
      merchantId,
      chainId,
      result.transactionHash,
      result.gasUsed,
      result.gasPrice,
      result.senderAddress,
      {
        method: result.method,
        value: result.value,
        status: "confirmed",
        submittedAt: new Date(),
      },
    );

    return result;
  }

  async submitGasSubsidyExample(
    merchantId: string,
    chainId: number,
    amount: number,
  ) {
    // Business logic for subsidy submission
    const submissionId = "subsidy_" + Date.now();

    // ✅ Emit audit event for gas submission
    this.auditLogService.emitApiRequest(
      "test-key",
      "/api/test",
      "POST",
      200,
      undefined,
      undefined,
    );

    return submissionId;
  }
}

/**
 * EXAMPLE: Querying and Reporting from Audit Logs
 */
@Injectable()
export class AuditReportingExample {
  constructor(private readonly auditLogService: AuditLogService) {}

  async getMerchantActivitySummary(merchantId: string) {
    // Get all events for a merchant in the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const logs = await this.auditLogService.queryLogs({
      user: merchantId,
      from: thirtyDaysAgo.toISOString(),
      to: new Date().toISOString(),
      limit: 1000,
      offset: 0,
    });

    return {
      merchantId,
      period: "last_30_days",
      totalEvents: logs.total,
      events: logs.data,
      summary: {
        apiRequests: logs.data.filter((e) => e.eventType === "APIRequest")
          .length,
        keyEvents: logs.data.filter((e) =>
          ["KeyCreated", "KeyRotated", "KeyRevoked"].includes(e.eventType),
        ).length,
        gasTransactions: logs.data.filter(
          (e) => e.eventType === "GasTransaction",
        ).length,
      },
    };
  }

  async generateComplianceReport(fromDate: string, toDate: string) {
    // Get all key lifecycle events for compliance audit
    const keyCreations = await this.auditLogService.queryLogs({
      eventType: "KeyCreated" as any,
      from: fromDate,
      to: toDate,
      limit: 10000,
      offset: 0,
    });

    const keyRotations = await this.auditLogService.queryLogs({
      eventType: "KeyRotated" as any,
      from: fromDate,
      to: toDate,
      limit: 10000,
      offset: 0,
    });

    const keyRevocations = await this.auditLogService.queryLogs({
      eventType: "KeyRevoked" as any,
      from: fromDate,
      to: toDate,
      limit: 10000,
      offset: 0,
    });

    return {
      period: { from: fromDate, to: toDate },
      keyManagement: {
        created: keyCreations.total,
        rotated: keyRotations.total,
        revoked: keyRevocations.total,
      },
      details: {
        creations: keyCreations.data,
        rotations: keyRotations.data,
        revocations: keyRevocations.data,
      },
    };
  }

  async getFailedRequestsReport(merchantId?: string) {
    const filters: any = {
      eventType: "APIRequest" as any,
      outcome: "failure" as any,
      limit: 10000,
      offset: 0,
    };

    if (merchantId) {
      const logs = await this.auditLogService.queryLogs({
        ...filters,
        user: merchantId,
      });
      return logs;
    }

    return this.auditLogService.queryLogs(filters);
  }

  async exportAuditTrail(format: "csv" | "json", filters?: any) {
    return this.auditLogService.exportLogs(format, filters);
  }
}
